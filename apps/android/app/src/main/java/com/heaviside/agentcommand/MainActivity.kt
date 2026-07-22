/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.SimpleAdapter
import android.widget.TextView
import android.widget.Toast
import com.heaviside.agentcommand.data.AgentCommandApi
import com.heaviside.agentcommand.data.NavigationResult
import com.heaviside.agentcommand.data.SavedCredentials
import com.heaviside.agentcommand.data.TerminalSocket
import com.heaviside.agentcommand.data.TmuxPane
import com.heaviside.agentcommand.data.Topology
import com.heaviside.agentcommand.security.SecureStore
import com.heaviside.agentcommand.terminal.RemoteTerminalView
import java.util.concurrent.Executors
import kotlin.math.roundToInt

class MainActivity : Activity() {
    private enum class Screen { SIGN_IN, ROSTER, TERMINAL }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()

    private lateinit var secureStore: SecureStore
    private var api: AgentCommandApi? = null
    private var pendingCredentials: SavedCredentials? = null
    private var screen = Screen.SIGN_IN
    private var started = false
    private var topology: Topology? = null
    private var activePane: TmuxPane? = null
    private var terminalSocket: TerminalSocket? = null
    private var terminalView: RemoteTerminalView? = null
    private var terminalStatus: TextView? = null
    private var zoomButton: Button? = null
    private var controlButton: Button? = null
    private var ctrlButton: Button? = null
    private var resumeToken: String? = null
    private var resumeSessionId: String? = null
    private var pendingNavigationId: String? = null
    private var connectionGeneration = 0L
    private var authoritativeInput = false
    private var readOnly = false
    private var tmuxZoomed = false

    private val reconnect = Runnable {
        if (started && screen == Screen.TERMINAL && terminalSocket == null) connectTerminal()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        secureStore = SecureStore(this)
        api = secureStore.load()?.let(::AgentCommandApi)

        val restoredPane = savedInstanceState?.toPane()
        if (restoredPane != null && api != null) {
            resumeToken = savedInstanceState.getString(STATE_RESUME_TOKEN)
            resumeSessionId = restoredPane.sessionId
            tmuxZoomed = savedInstanceState.getBoolean(STATE_TMUX_ZOOMED)
            showTerminal(restoredPane)
        } else if (api != null) {
            showRoster()
            refreshRoster()
        } else {
            showSignIn()
        }
    }

    override fun onStart() {
        super.onStart()
        started = true
        if (screen == Screen.TERMINAL && terminalSocket == null) connectTerminal()
    }

    override fun onStop() {
        started = false
        mainHandler.removeCallbacks(reconnect)
        disconnectTerminal()
        super.onStop()
    }

    override fun onDestroy() {
        io.shutdownNow()
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        activePane?.writeTo(outState)
        outState.putString(STATE_RESUME_TOKEN, resumeToken)
        outState.putBoolean(STATE_TMUX_ZOOMED, tmuxZoomed)
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() {
        if (screen == Screen.TERMINAL) {
            showRoster()
        } else {
            super.onBackPressed()
        }
    }

    private fun showSignIn(error: String? = null) {
        screen = Screen.SIGN_IN
        disconnectTerminal()
        activePane = null
        val saved = secureStore.load()

        val content = verticalLayout().apply {
            setPadding(dp(24), dp(32), dp(24), dp(24))
            addView(heading("Agent Command"))
            addView(body("Connect through the public Agent Command dashboard. The access code is encrypted with Android Keystore."))
        }
        val endpoint = EditText(this).apply {
            hint = "https://agent-command.example.com"
            setText(saved?.endpoint.orEmpty())
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setTextColor(Color.WHITE)
            setHintTextColor(MUTED)
            contentDescription = "Agent Command HTTPS endpoint"
        }
        val token = EditText(this).apply {
            hint = if (saved == null) "Access code" else "Access code (leave blank to reuse saved)"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setTextColor(Color.WHITE)
            setHintTextColor(MUTED)
            contentDescription = "Agent Command access code"
        }
        content.addView(endpoint, matchWrap())
        content.addView(token, matchWrap())
        if (!error.isNullOrBlank()) content.addView(body(error, ERROR))
        content.addView(
            button("Connect") {
                val endpointValue = endpoint.text.toString().trim()
                val tokenValue = token.text.toString().trim().ifEmpty {
                    saved?.accessCode.orEmpty()
                }
                if (endpointValue.isEmpty() || tokenValue.isEmpty()) {
                    showSignIn("Endpoint and access code are required.")
                    return@button
                }
                val credentials = SavedCredentials(endpointValue, tokenValue)
                val nextApi = runCatching { AgentCommandApi(credentials) }.getOrElse {
                    showSignIn(it.message ?: "Invalid endpoint")
                    return@button
                }
                pendingCredentials = credentials
                api = nextApi
                showRoster()
                refreshRoster()
            },
            matchWrap(top = 20),
        )
        setContentView(content)
    }

    private fun showRoster() {
        screen = Screen.ROSTER
        disconnectTerminal()
        activePane = null
        authoritativeInput = false

        val root = verticalLayout()
        val header = horizontalLayout().apply {
            setPadding(dp(16), dp(12), dp(8), dp(8))
            gravity = Gravity.CENTER_VERTICAL
        }
        val title = heading("Existing tmux panes").apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        header.addView(title)
        header.addView(button("Refresh") { refreshRoster() })
        header.addView(button("Sign out") {
            secureStore.clear()
            api = null
            topology = null
            showSignIn()
        })
        root.addView(header, matchWrap())

        val status = body("Loading hosts and panes…").apply {
            tag = ROSTER_STATUS_TAG
            setPadding(dp(16), dp(4), dp(16), dp(8))
        }
        root.addView(status, matchWrap())
        root.addView(ProgressBar(this).apply { tag = ROSTER_PROGRESS_TAG }, centerWrap())
        setContentView(root)
        renderRoster(topology)
    }

    private fun refreshRoster() {
        if (screen != Screen.ROSTER) return
        findTaggedView<TextView>(ROSTER_STATUS_TAG)?.text = "Loading hosts and panes…"
        findTaggedView<ProgressBar>(ROSTER_PROGRESS_TAG)?.visibility = View.VISIBLE
        val currentApi = api ?: return showSignIn("Sign in again.")
        io.execute {
            runCatching { currentApi.loadTopology() }
                .onSuccess { loaded -> runOnUiThread {
                    if (screen != Screen.ROSTER) return@runOnUiThread
                    topology = loaded
                    pendingCredentials?.let(secureStore::save)
                    pendingCredentials = null
                    renderRoster(loaded)
                } }
                .onFailure { failure -> runOnUiThread {
                    if (screen != Screen.ROSTER) return@runOnUiThread
                    val message = failure.message ?: "Unable to load Agent Command topology"
                    if (pendingCredentials != null) {
                        pendingCredentials = null
                        api = null
                        showSignIn(message)
                    } else {
                        findTaggedView<ProgressBar>(ROSTER_PROGRESS_TAG)?.visibility = View.GONE
                        findTaggedView<TextView>(ROSTER_STATUS_TAG)?.text = message
                    }
                } }
        }
    }

    private fun renderRoster(loaded: Topology?) {
        if (screen != Screen.ROSTER || loaded == null) return
        val root = findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as? LinearLayout ?: return
        val oldList = root.findViewWithTag<View>(ROSTER_LIST_TAG)
        if (oldList != null) root.removeView(oldList)
        findTaggedView<ProgressBar>(ROSTER_PROGRESS_TAG)?.visibility = View.GONE
        findTaggedView<TextView>(ROSTER_STATUS_TAG)?.text =
            "${loaded.hosts.size} hosts · ${loaded.panes.size} existing panes\n" +
            loaded.hosts.joinToString(" · ") { it.name }

        if (loaded.panes.isEmpty()) {
            root.addView(body("No existing tmux panes are available."), matchWrap(horizontal = 16))
            return
        }
        val list = ListView(this).apply {
            tag = ROSTER_LIST_TAG
            dividerHeight = 1
            adapter = SimpleAdapter(
                this@MainActivity,
                loaded.panes.map { pane ->
                    mapOf(
                        "primary" to "${pane.hostName}  ·  ${pane.tmuxSessionName}:${pane.windowIndex}.${pane.paneIndex}",
                        "secondary" to "${pane.title}  ·  ${pane.status.lowercase()}",
                    )
                },
                android.R.layout.simple_list_item_2,
                arrayOf("primary", "secondary"),
                intArrayOf(android.R.id.text1, android.R.id.text2),
            )
            setOnItemClickListener { _, _, position, _ -> showTerminal(loaded.panes[position]) }
        }
        root.addView(list, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    }

    private fun showTerminal(pane: TmuxPane) {
        screen = Screen.TERMINAL
        activePane = pane
        disconnectTerminal()
        authoritativeInput = false
        readOnly = false
        pendingNavigationId = null

        val root = verticalLayout()
        val titleRow = horizontalLayout().apply {
            setPadding(dp(4), dp(6), dp(8), dp(2))
            gravity = Gravity.CENTER_VERTICAL
        }
        titleRow.addView(button("‹ Panes") { showRoster() })
        titleRow.addView(
            TextView(this).apply {
                text = "${pane.hostName} · ${pane.target.ifBlank { pane.paneId }}"
                setTextColor(Color.WHITE)
                textSize = 16f
                maxLines = 1
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            },
        )
        root.addView(titleRow, matchWrap())

        terminalStatus = body("Connecting…", MUTED).apply {
            setPadding(dp(12), 0, dp(12), dp(4))
        }
        root.addView(terminalStatus, matchWrap())

        val toolbar = horizontalLayout().apply { gravity = Gravity.CENTER_VERTICAL }
        toolbar.addView(button("A−") { terminalView?.decreaseTextSize() })
        toolbar.addView(button("A+") { terminalView?.increaseTextSize() })
        ctrlButton = button("Ctrl") {
            val enabled = ctrlButton?.isSelected != true
            ctrlButton?.isSelected = enabled
            terminalView?.setControlModifier(enabled)
            updateCtrlButton(enabled)
        }.also(toolbar::addView)
        toolbar.addView(button("Esc") { if (authoritativeInput) terminalView?.sendEscape() })
        toolbar.addView(button("Tab") { if (authoritativeInput) terminalView?.sendTab() })
        toolbar.addView(button("Paste") { if (authoritativeInput) terminalView?.pasteClipboard() })
        toolbar.addView(button("Copy") {
            val copied = terminalView?.copyVisibleText().orEmpty()
            Toast.makeText(this, if (copied.isEmpty()) "No visible text" else "Visible terminal text copied", Toast.LENGTH_SHORT).show()
        })
        zoomButton = button(if (tmuxZoomed) "Unzoom pane" else "Zoom pane") {
            requestPaneFocus(!tmuxZoomed)
        }.also(toolbar::addView)
        controlButton = button("Take control") {
            terminalSocket?.takeControl()
            terminalStatus?.text = "Requesting control…"
        }.apply { isEnabled = false }.also(toolbar::addView)
        root.addView(HorizontalScrollView(this).apply { addView(toolbar) }, matchWrap())

        terminalView = RemoteTerminalView(this).apply {
            onInput = { data -> if (authoritativeInput && !readOnly) terminalSocket?.sendInput(data) }
            onResize = { columns, rows -> terminalSocket?.sendResize(columns, rows) }
            onTextSizeChanged = { size -> terminalStatus?.text = "${statusPrefix()} · ${columns}×${rows} · ${size}sp" }
            onControlModifierChanged = { enabled -> updateCtrlButton(enabled) }
        }.also { terminal ->
            root.addView(terminal, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        setContentView(root)
        if (started) connectTerminal()
    }

    private fun connectTerminal() {
        val pane = activePane ?: return
        val currentApi = api ?: return showSignIn("Sign in again.")
        if (terminalSocket != null) return
        val generation = ++connectionGeneration
        val tokenForPane = resumeToken.takeIf { resumeSessionId == pane.sessionId }
        terminalStatus?.text = if (tokenForPane == null) "Connecting…" else "Resuming…"
        authoritativeInput = false
        val columns = terminalView?.columns ?: 80
        val rows = terminalView?.rows ?: 24
        io.execute {
            runCatching {
                currentApi.createTerminalSocket(
                    pane,
                    columns,
                    rows,
                    tokenForPane,
                    terminalListener(generation, pane.sessionId, tokenForPane != null),
                )
            }.onSuccess { created -> runOnUiThread {
                if (!isCurrentConnection(generation, pane.sessionId)) {
                    created.close()
                } else {
                    terminalSocket = created
                    created.connect()
                }
            } }.onFailure { failure -> runOnUiThread {
                if (isCurrentConnection(generation, pane.sessionId)) {
                    handleTerminalFailure(failure.message ?: "Unable to obtain terminal ticket")
                }
            } }
        }
    }

    private fun terminalListener(
        generation: Long,
        sessionId: String,
        attemptedResume: Boolean,
    ) = object : TerminalSocket.Listener {
        private var resumeAttemptPending = attemptedResume

        override fun onAttached(readOnly: Boolean, resumed: Boolean, resumeToken: String?) = runOnUiThread {
            if (!isCurrentConnection(generation, sessionId)) return@runOnUiThread
            resumeAttemptPending = false
            this@MainActivity.readOnly = readOnly
            if (!resumeToken.isNullOrBlank()) {
                this@MainActivity.resumeToken = resumeToken
                resumeSessionId = activePane?.sessionId
            }
            controlButton?.isEnabled = readOnly
            if (readOnly) {
                authoritativeInput = false
                terminalStatus?.text = "Read-only · take control to type"
            } else if (!authoritativeInput) {
                requestPaneFocus(tmuxZoomed)
            }
        }

        override fun onOutput(data: ByteArray) = runOnUiThread {
            if (!isCurrentConnection(generation, sessionId)) return@runOnUiThread
            terminalView?.append(data)
        }

        override fun onStatus(type: String, message: String?) = runOnUiThread {
            if (!isCurrentConnection(generation, sessionId)) return@runOnUiThread
            when (type) {
                "control" -> {
                    val needsFocusConfirmation = readOnly || !authoritativeInput
                    readOnly = false
                    controlButton?.isEnabled = false
                    if (needsFocusConfirmation) requestPaneFocus(tmuxZoomed)
                }
                "readonly" -> {
                    readOnly = true
                    authoritativeInput = false
                    controlButton?.isEnabled = true
                }
                "error" -> {
                    if (resumeAttemptPending && message.orEmpty().contains("resume token", ignoreCase = true)) {
                        resumeAttemptPending = false
                        resumeToken = null
                        resumeSessionId = null
                        disconnectTerminal()
                        terminalStatus?.text = "Saved terminal resume expired · reconnecting fresh"
                        if (started && screen == Screen.TERMINAL) connectTerminal()
                    } else {
                        handleTerminalFailure(message ?: "Terminal error")
                    }
                    return@runOnUiThread
                }
                "detached", "idle_timeout" -> {
                    handleTerminalFailure(message ?: type.replace('_', ' '))
                    return@runOnUiThread
                }
            }
            terminalStatus?.text = message ?: type.replace('_', ' ')
        }

        override fun onNavigationResult(result: NavigationResult) = runOnUiThread {
            if (!isCurrentConnection(generation, sessionId)) return@runOnUiThread
            if (result.requestId != pendingNavigationId) return@runOnUiThread
            pendingNavigationId = null
            val pane = activePane ?: return@runOnUiThread
            if (result.ok && result.paneId == pane.paneId) {
                tmuxZoomed = result.zoomed == true
                authoritativeInput = !readOnly
                terminalStatus?.text = statusPrefix()
                zoomButton?.text = if (tmuxZoomed) "Unzoom pane" else "Zoom pane"
                terminalView?.requestFocus()
            } else {
                authoritativeInput = false
                terminalStatus?.text = result.message ?: "Pane focus was not confirmed"
            }
        }

        override fun onFailure(message: String) = runOnUiThread {
            if (isCurrentConnection(generation, sessionId)) handleTerminalFailure(message)
        }
    }

    private fun isCurrentConnection(generation: Long, sessionId: String): Boolean =
        started && screen == Screen.TERMINAL && connectionGeneration == generation &&
            activePane?.sessionId == sessionId

    private fun requestPaneFocus(zoom: Boolean) {
        val pane = activePane ?: return
        val socket = terminalSocket ?: return
        if (pendingNavigationId != null) return
        authoritativeInput = false
        terminalStatus?.text = if (zoom) "Confirming pane zoom…" else "Confirming pane focus…"
        val requestId = socket.focusPane(pane.paneId, zoom)
        if (requestId == null) {
            handleTerminalFailure("Pane focus request could not be sent")
            return
        }
        pendingNavigationId = requestId
    }

    private fun handleTerminalFailure(message: String) {
        disconnectTerminal()
        terminalStatus?.text = "$message · reconnecting"
        if (started && screen == Screen.TERMINAL) mainHandler.postDelayed(reconnect, RECONNECT_DELAY_MS)
    }

    private fun disconnectTerminal() {
        connectionGeneration += 1
        mainHandler.removeCallbacks(reconnect)
        val existing = terminalSocket
        terminalSocket = null
        pendingNavigationId = null
        authoritativeInput = false
        existing?.close()
    }

    private fun statusPrefix(): String = when {
        readOnly -> "Read-only"
        authoritativeInput -> "Connected · ${activePane?.paneId}"
        else -> "Connected · confirming pane"
    }

    private fun updateCtrlButton(enabled: Boolean) {
        ctrlButton?.text = if (enabled) "Ctrl on" else "Ctrl"
        ctrlButton?.isSelected = enabled
    }

    private fun verticalLayout() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(BACKGROUND)
    }

    private fun horizontalLayout() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setBackgroundColor(BACKGROUND)
    }

    private fun heading(value: String) = TextView(this).apply {
        text = value
        textSize = 24f
        setTextColor(Color.WHITE)
        setPadding(0, 0, 0, dp(8))
    }

    private fun body(value: String, color: Int = MUTED) = TextView(this).apply {
        text = value
        textSize = 14f
        setTextColor(color)
        setPadding(0, dp(4), 0, dp(8))
    }

    private fun button(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setOnClickListener { action() }
        minHeight = dp(44)
    }

    private fun matchWrap(top: Int = 0, horizontal: Int = 0) =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            setMargins(dp(horizontal), dp(top), dp(horizontal), 0)
        }

    private fun centerWrap() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply { gravity = Gravity.CENTER_HORIZONTAL }

    private inline fun <reified T : View> findTaggedView(tag: String): T? =
        findViewById<ViewGroup>(android.R.id.content).findViewWithTag(tag)

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).roundToInt()

    private fun Bundle.toPane(): TmuxPane? {
        val sessionId = getString(STATE_SESSION_ID) ?: return null
        return TmuxPane(
            sessionId = sessionId,
            hostId = getString(STATE_HOST_ID).orEmpty(),
            hostName = getString(STATE_HOST_NAME).orEmpty(),
            title = getString(STATE_TITLE).orEmpty(),
            status = getString(STATE_STATUS).orEmpty(),
            provider = getString(STATE_PROVIDER).orEmpty(),
            paneId = getString(STATE_PANE_ID).orEmpty(),
            target = getString(STATE_TARGET).orEmpty(),
            tmuxSessionName = getString(STATE_TMUX_SESSION).orEmpty(),
            windowName = getString(STATE_WINDOW_NAME).orEmpty(),
            windowIndex = getInt(STATE_WINDOW_INDEX),
            paneIndex = getInt(STATE_PANE_INDEX),
        )
    }

    private fun TmuxPane.writeTo(state: Bundle) {
        state.putString(STATE_SESSION_ID, sessionId)
        state.putString(STATE_HOST_ID, hostId)
        state.putString(STATE_HOST_NAME, hostName)
        state.putString(STATE_TITLE, title)
        state.putString(STATE_STATUS, status)
        state.putString(STATE_PROVIDER, provider)
        state.putString(STATE_PANE_ID, paneId)
        state.putString(STATE_TARGET, target)
        state.putString(STATE_TMUX_SESSION, tmuxSessionName)
        state.putString(STATE_WINDOW_NAME, windowName)
        state.putInt(STATE_WINDOW_INDEX, windowIndex)
        state.putInt(STATE_PANE_INDEX, paneIndex)
    }

    private companion object {
        const val RECONNECT_DELAY_MS = 1_500L
        const val ROSTER_STATUS_TAG = "roster-status"
        const val ROSTER_PROGRESS_TAG = "roster-progress"
        const val ROSTER_LIST_TAG = "roster-list"
        const val STATE_SESSION_ID = "session-id"
        const val STATE_HOST_ID = "host-id"
        const val STATE_HOST_NAME = "host-name"
        const val STATE_TITLE = "title"
        const val STATE_STATUS = "status"
        const val STATE_PROVIDER = "provider"
        const val STATE_PANE_ID = "pane-id"
        const val STATE_TARGET = "target"
        const val STATE_TMUX_SESSION = "tmux-session"
        const val STATE_WINDOW_NAME = "window-name"
        const val STATE_WINDOW_INDEX = "window-index"
        const val STATE_PANE_INDEX = "pane-index"
        const val STATE_RESUME_TOKEN = "resume-token"
        const val STATE_TMUX_ZOOMED = "tmux-zoomed"
        val BACKGROUND = Color.rgb(9, 9, 11)
        val MUTED = Color.rgb(161, 161, 170)
        val ERROR = Color.rgb(248, 113, 113)
    }
}
