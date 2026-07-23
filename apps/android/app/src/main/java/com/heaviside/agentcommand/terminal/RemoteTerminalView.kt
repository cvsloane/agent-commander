/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Uses the Termux terminal emulator and canvas renderer from termux-app 0.118.3.
 */
package com.heaviside.agentcommand.terminal

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Typeface
import android.text.InputType
import android.util.AttributeSet
import android.view.GestureDetector
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import com.termux.terminal.TerminalEmulator
import com.termux.terminal.TerminalOutput
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import com.termux.view.TerminalRenderer
import kotlin.math.roundToInt

class RemoteTerminalView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : android.view.View(context, attrs) {
    var onInput: (String) -> Unit = {}
    var onResize: (columns: Int, rows: Int) -> Unit = { _, _ -> }
    var onScrollRows: (rows: Int) -> Unit = {}
    var onTextSizeChanged: (sp: Int) -> Unit = {}
    var onControlModifierChanged: (enabled: Boolean) -> Unit = {}

    private var textSizeSp = DEFAULT_TEXT_SIZE_SP
    private var renderer = createRenderer(textSizeSp)
    private var topRow = 0
    private var scrollRemainder = 0f
    private var controlModifier = false

    private val output = object : TerminalOutput() {
        override fun write(data: ByteArray, offset: Int, count: Int) {
            onInput(String(data, offset, count, Charsets.UTF_8))
        }

        override fun titleChanged(oldTitle: String?, newTitle: String?) = Unit

        override fun onCopyTextToClipboard(text: String?) {
            if (!text.isNullOrEmpty()) copyToClipboard(text)
        }

        override fun onPasteTextFromClipboard() {
            pasteClipboard()
        }

        override fun onBell() {
            performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
        }

        override fun onColorsChanged() {
            postInvalidateOnAnimation()
        }
    }

    private val terminalClient = object : TerminalSessionClient {
        override fun onTextChanged(changedSession: TerminalSession?) = Unit
        override fun onTitleChanged(changedSession: TerminalSession?) = Unit
        override fun onSessionFinished(finishedSession: TerminalSession?) = Unit
        override fun onCopyTextToClipboard(session: TerminalSession?, text: String?) {
            if (!text.isNullOrEmpty()) copyToClipboard(text)
        }

        override fun onPasteTextFromClipboard(session: TerminalSession?) = pasteClipboard()
        override fun onBell(session: TerminalSession?) = output.onBell()
        override fun onColorsChanged(session: TerminalSession?) = postInvalidateOnAnimation()
        override fun onTerminalCursorStateChange(state: Boolean) = postInvalidateOnAnimation()
        override fun getTerminalCursorStyle(): Int = TerminalEmulator.TERMINAL_CURSOR_STYLE_BLOCK
        override fun logError(tag: String?, message: String?) = Unit
        override fun logWarn(tag: String?, message: String?) = Unit
        override fun logInfo(tag: String?, message: String?) = Unit
        override fun logDebug(tag: String?, message: String?) = Unit
        override fun logVerbose(tag: String?, message: String?) = Unit
        override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) = Unit
        override fun logStackTrace(tag: String?, e: Exception?) = Unit
    }

    private val emulator = TerminalEmulator(
        output,
        DEFAULT_COLUMNS,
        DEFAULT_ROWS,
        renderer.fontWidth.roundToInt(),
        renderer.fontLineSpacing,
        TRANSCRIPT_ROWS,
        terminalClient,
    )

    private val scaleDetector = ScaleGestureDetector(
        context,
        object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                val next = (textSizeSp * detector.scaleFactor).roundToInt()
                    .coerceIn(MIN_TEXT_SIZE_SP, MAX_TEXT_SIZE_SP)
                if (next != textSizeSp) setTextSizeSp(next)
                return true
            }
        },
    )

    private val gestureDetector = GestureDetector(
        context,
        object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(event: MotionEvent): Boolean = true

            override fun onSingleTapUp(event: MotionEvent): Boolean {
                requestKeyboard()
                return true
            }

            override fun onLongPress(event: MotionEvent) {
                copyVisibleText()
                performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
            }

            override fun onScroll(
                first: MotionEvent?,
                current: MotionEvent,
                distanceX: Float,
                distanceY: Float,
            ): Boolean {
                scrollRemainder += distanceY
                val rowDelta = (scrollRemainder / renderer.fontLineSpacing).toInt()
                if (rowDelta != 0) {
                    scrollRemainder -= rowDelta * renderer.fontLineSpacing
                    onScrollRows(rowDelta)
                }
                return true
            }
        },
    )

    init {
        isFocusable = true
        isFocusableInTouchMode = true
        setBackgroundColor(Color.BLACK)
    }

    val columns: Int get() = emulator.mColumns
    val rows: Int get() = emulator.mRows

    fun append(data: ByteArray) {
        val wasAtTail = topRow == 0
        emulator.clearScrollCounter()
        emulator.append(data, data.size)
        val rowsScrolled = emulator.scrollCounter
        emulator.clearScrollCounter()
        if (wasAtTail) {
            topRow = 0
        } else {
            topRow -= rowsScrolled
        }
        topRow = topRow.coerceIn(-emulator.screen.activeTranscriptRows, 0)
        postInvalidateOnAnimation()
    }

    fun setControlModifier(enabled: Boolean) {
        controlModifier = enabled
        onControlModifierChanged(enabled)
        requestKeyboard()
    }

    fun setTextSizeSp(size: Int) {
        val normalized = size.coerceIn(MIN_TEXT_SIZE_SP, MAX_TEXT_SIZE_SP)
        if (normalized == textSizeSp) return
        textSizeSp = normalized
        renderer = createRenderer(textSizeSp)
        resizeTerminal(width, height)
        onTextSizeChanged(textSizeSp)
        postInvalidateOnAnimation()
    }

    fun increaseTextSize() = setTextSizeSp(textSizeSp + 1)
    fun decreaseTextSize() = setTextSizeSp(textSizeSp - 1)

    fun pasteClipboard() {
        val clipboard = context.getSystemService(ClipboardManager::class.java)
        val text = clipboard.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString()
        if (!text.isNullOrEmpty()) emulator.paste(text)
    }

    fun copyVisibleText(): String {
        val lastRow = (topRow + emulator.mRows - 1).coerceAtMost(emulator.mRows - 1)
        val text = emulator.screen.getSelectedText(0, topRow, emulator.mColumns, lastRow).trimEnd()
        if (text.isNotEmpty()) copyToClipboard(text)
        return text
    }

    fun sendEscape() = sendText("\u001b")
    fun sendTab() = sendText("\t")

    override fun onCheckIsTextEditor(): Boolean = true

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection {
        outAttrs.inputType = InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or
            InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
        outAttrs.imeOptions = EditorInfo.IME_FLAG_NO_FULLSCREEN
        return TerminalInputConnection()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_ENTER -> sendText("\r")
            KeyEvent.KEYCODE_DEL -> sendText("\u007f")
            KeyEvent.KEYCODE_TAB -> sendText("\t")
            KeyEvent.KEYCODE_ESCAPE -> sendText("\u001b")
            KeyEvent.KEYCODE_DPAD_UP -> sendText(if (emulator.isCursorKeysApplicationMode) "\u001bOA" else "\u001b[A")
            KeyEvent.KEYCODE_DPAD_DOWN -> sendText(if (emulator.isCursorKeysApplicationMode) "\u001bOB" else "\u001b[B")
            KeyEvent.KEYCODE_DPAD_RIGHT -> sendText(if (emulator.isCursorKeysApplicationMode) "\u001bOC" else "\u001b[C")
            KeyEvent.KEYCODE_DPAD_LEFT -> sendText(if (emulator.isCursorKeysApplicationMode) "\u001bOD" else "\u001b[D")
            else -> {
                val codePoint = event.unicodeChar
                if (codePoint == 0) return super.onKeyDown(keyCode, event)
                sendText(String(Character.toChars(codePoint)))
            }
        }
        return true
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)
        gestureDetector.onTouchEvent(event)
        if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
            scrollRemainder = 0f
        }
        return true
    }

    override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
        super.onSizeChanged(width, height, oldWidth, oldHeight)
        resizeTerminal(width, height)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.BLACK)
        renderer.render(emulator, canvas, topRow, -1, -1, -1, -1)
    }

    private fun resizeTerminal(width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        val newColumns = (width / renderer.fontWidth).toInt().coerceAtLeast(4)
        val newRows = (height / renderer.fontLineSpacing).coerceAtLeast(4)
        if (newColumns == emulator.mColumns && newRows == emulator.mRows) return
        emulator.resize(
            newColumns,
            newRows,
            renderer.fontWidth.roundToInt(),
            renderer.fontLineSpacing,
        )
        topRow = topRow.coerceIn(-emulator.screen.activeTranscriptRows, 0)
        onResize(newColumns, newRows)
    }

    private fun requestKeyboard() {
        requestFocus()
        context.getSystemService(InputMethodManager::class.java).showSoftInput(this, 0)
    }

    private fun sendText(value: String) {
        if (value.isEmpty()) return
        val outgoing = if (controlModifier && value.codePointCount(0, value.length) == 1) {
            controlCode(value.codePointAt(0))?.toString() ?: value
        } else {
            value
        }
        if (controlModifier) {
            controlModifier = false
            onControlModifierChanged(false)
        }
        onInput(outgoing)
    }

    private fun controlCode(codePoint: Int): Char? = when (codePoint) {
        in 'a'.code..'z'.code -> (codePoint - 'a'.code + 1).toChar()
        in 'A'.code..'Z'.code -> (codePoint - 'A'.code + 1).toChar()
        ' '.code, '2'.code -> 0.toChar()
        '['.code -> 27.toChar()
        '\\'.code -> 28.toChar()
        ']'.code -> 29.toChar()
        '^'.code -> 30.toChar()
        '_'.code -> 31.toChar()
        else -> null
    }

    private fun copyToClipboard(text: String) {
        context.getSystemService(ClipboardManager::class.java)
            .setPrimaryClip(ClipData.newPlainText("terminal", text))
    }

    private fun createRenderer(sizeSp: Int): TerminalRenderer {
        val pixels = (sizeSp * resources.displayMetrics.scaledDensity).roundToInt()
        return TerminalRenderer(pixels, Typeface.MONOSPACE)
    }

    private inner class TerminalInputConnection : BaseInputConnection(this@RemoteTerminalView, true) {
        override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
            super.commitText(text, newCursorPosition)
            sendEditableContent()
            return true
        }

        override fun finishComposingText(): Boolean {
            super.finishComposingText()
            sendEditableContent()
            return true
        }

        override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
            repeat(beforeLength.coerceAtLeast(0)) {
                sendText("\u007f")
            }
            return super.deleteSurroundingText(beforeLength, afterLength)
        }

        override fun sendKeyEvent(event: KeyEvent): Boolean =
            if (event.action == KeyEvent.ACTION_DOWN) onKeyDown(event.keyCode, event) else true

        override fun performEditorAction(actionCode: Int): Boolean {
            sendText("\r")
            return true
        }

        private fun sendEditableContent() {
            val content = editable ?: return
            if (content.isEmpty()) return
            sendText(content.toString().replace('\n', '\r'))
            content.clear()
        }
    }

    private companion object {
        const val DEFAULT_COLUMNS = 80
        const val DEFAULT_ROWS = 24
        const val TRANSCRIPT_ROWS = 5_000
        const val DEFAULT_TEXT_SIZE_SP = 14
        const val MIN_TEXT_SIZE_SP = 8
        const val MAX_TEXT_SIZE_SP = 28
    }
}
