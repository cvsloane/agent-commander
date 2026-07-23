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
import com.heaviside.agentcommand.terminal.ControllerOwnership
import com.heaviside.agentcommand.terminal.RemoteTerminalView
import com.heaviside.agentcommand.terminal.TerminalConnectionState
import com.heaviside.agentcommand.terminal.ViewerAuthority
import com.heaviside.agentcommand.terminal.ViewerResolution
import com.heaviside.agentcommand.terminal.ViewerTarget
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
    private val viewerAuthority = ViewerAuthority()
    private var navigationTimeout: Runnable? = null
    private var connectionGeneration = 0L
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
            addView(body(appVersionLabel()))
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
        root.addView(body(appVersionLabel()).apply {
            setPadding(dp(16), 0, dp(16), dp(4))
        }, matchWrap())

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

        val statusRow = horizontalLayout().apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), 0, dp(8), dp(4))
        }
        terminalStatus = body("Connecting…", MUTED).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }.also(statusRow::addView)
        controlButton = button("Take Control") {
            if (terminalSocket?.takeControl() == true) {
                terminalStatus?.text = "Requesting control…"
            } else {
                terminalStatus?.text = "Take control request could not be sent"
            }
        }.apply {
            isEnabled = false
            contentDescription = "Take control of this terminal"
        }.also(statusRow::addView)
        root.addView(statusRow, matchWrap())

        val toolbar = horizontalLayout().apply { gravity = Gravity.CENTER_VERTICAL }
        toolbar.addView(button("A−") { terminalView?.decreaseTextSize() })
        toolbar.addView(button("A+") { terminalView?.increaseTextSize() })
        ctrlButton = button("Ctrl") {
            val enabled = ctrlButton?.isSelected != true
            ctrlButton?.isSelected = enabled
            terminalView?.setControlModifier(enabled)
            updateCtrlButton(enabled)
        }.also(toolbar::addView)
        toolbar.addView(button("Esc") { if (viewerAuthority.canSendInput) terminalView?.sendEscape() })
        toolbar.addView(button("Tab") { if (viewerAuthority.canSendInput) terminalView?.sendTab() })
        toolbar.addView(button("Paste") { if (viewerAuthority.canSendInput) terminalView?.pasteClipboard() })
        toolbar.addView(button("Copy") {
            val copied = terminalView?.copyVisibleText().orEmpty()
            Toast.makeText(this, if (copied.isEmpty()) "No visible text" else "Visible terminal text copied", Toast.LENGTH_SHORT).show()
        })
        zoomButton = button(if (tmuxZoomed) "Unzoom pane" else "Zoom pane") {
            requestPaneFocus(!tmuxZoomed)
        }.also(toolbar::addView)
        root.addView(HorizontalScrollView(this).apply { addView(toolbar) }, matchWrap())

        terminalView = RemoteTerminalView(this).apply {
            onInput = { data -> if (viewerAuthority.canSendInput) terminalSocket?.sendInput(data) }
            onResize = { columns, rows -> terminalSocket?.sendResize(columns, rows) }
            onScrollRows = { rows -> if (viewerAuthority.canSendInput) terminalSocket?.scroll(rows) }
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
        viewerAuthority.connecting(ViewerTarget(pane.paneId, tmuxZoomed))
        syncInteractionUi()
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
            viewerAuthority.attached(readOnly)
            if (!resumeToken.isNullOrBlank()) {
                this@MainActivity.resumeToken = resumeToken
                resumeSessionId = activePane?.sessionId
            }
            syncInteractionUi()
            // Fresh and resumed attachments use the same correlated authority check, including read-only viewers.
            requestPaneFocus(tmuxZoomed)
        }

        override fun onOutput(data: ByteArray) = runOnUiThread {
            if (!isCurrentConnection(generation, sessionId)) return@runOnUiThread
            terminalView?.append(data)
        }

        override fun onStatus(type: String, message: String?) = runOnUiThread {
            if (!isCurrentConnection(generation, sessionId)) return@runOnUiThread
            when (type) {
                "control" -> {
                    viewerAuthority.controllerChanged(hasControl = true)
                    syncInteractionUi(message ?: statusPrefix())
                    return@runOnUiThread
                }
                "readonly" -> {
                    viewerAuthority.controllerChanged(hasControl = false)
                    syncInteractionUi(message ?: statusPrefix())
                    return@runOnUiThread
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
            when (val resolution = viewerAuthority.resolve(result)) {
                ViewerResolution.Ignored -> return@runOnUiThread
                is ViewerResolution.Converged -> {
                    cancelNavigationTimeout()
                    tmuxZoomed = resolution.target.zoomed
                    zoomButton?.text = if (tmuxZoomed) "Unzoom pane" else "Zoom pane"
                    syncInteractionUi()
                    terminalView?.requestFocus()
                }
                is ViewerResolution.Failed -> {
                    cancelNavigationTimeout()
                    syncInteractionUi(resolution.message)
                }
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
        if (viewerAuthority.hasPendingNavigation) return
        val expected = ViewerTarget(pane.paneId, zoom)
        val requestId = socket.focusPane(pane.paneId, zoom)
        if (requestId == null) {
            handleTerminalFailure("Pane focus request could not be sent")
            return
        }
        viewerAuthority.beginFocus(requestId, expected)
        syncInteractionUi(if (zoom) "Confirming pane zoom…" else "Confirming pane focus…")
        scheduleNavigationTimeout { reconcileTimedOutFocus(requestId) }
    }

    private fun reconcileTimedOutFocus(focusRequestId: String) {
        val socket = terminalSocket ?: return
        val viewerStateRequestId = socket.viewerState()
        if (viewerStateRequestId == null) {
            val resolution = viewerAuthority.failPending(
                focusRequestId,
                "Pane focus timed out and terminal viewer state could not be requested.",
            )
            if (resolution is ViewerResolution.Failed) syncInteractionUi(resolution.message)
            return
        }
        if (!viewerAuthority.beginViewerStateReconciliation(focusRequestId, viewerStateRequestId)) return
        syncInteractionUi("Pane focus result timed out · checking viewer state…")
        scheduleNavigationTimeout {
            val resolution = viewerAuthority.failPending(
                viewerStateRequestId,
                "Pane focus timed out and viewer state could not be confirmed.",
            )
            if (resolution is ViewerResolution.Failed) syncInteractionUi(resolution.message)
        }
    }

    private fun scheduleNavigationTimeout(action: () -> Unit) {
        cancelNavigationTimeout()
        navigationTimeout = Runnable {
            navigationTimeout = null
            action()
        }.also { mainHandler.postDelayed(it, FOCUS_TIMEOUT_MS) }
    }

    private fun cancelNavigationTimeout() {
        navigationTimeout?.let(mainHandler::removeCallbacks)
        navigationTimeout = null
    }

    private fun handleTerminalFailure(message: String) {
        disconnectTerminal()
        viewerAuthority.failed()
        syncInteractionUi("$message · reconnecting")
        if (started && screen == Screen.TERMINAL) mainHandler.postDelayed(reconnect, RECONNECT_DELAY_MS)
    }

    private fun disconnectTerminal() {
        connectionGeneration += 1
        mainHandler.removeCallbacks(reconnect)
        cancelNavigationTimeout()
        val existing = terminalSocket
        terminalSocket = null
        viewerAuthority.detached()
        syncInteractionUi()
        existing?.close()
    }

    private fun statusPrefix(): String = when {
        viewerAuthority.connectionState == TerminalConnectionState.DETACHED -> "Detached"
        viewerAuthority.connectionState == TerminalConnectionState.CONNECTING -> "Connecting"
        viewerAuthority.connectionState == TerminalConnectionState.FAILED -> "Failed"
        !viewerAuthority.failureMessage.isNullOrBlank() -> viewerAuthority.failureMessage.orEmpty()
        viewerAuthority.hasPendingNavigation &&
            viewerAuthority.controllerOwnership == ControllerOwnership.READ_ONLY ->
            "Read-only · confirming pane"
        viewerAuthority.hasPendingNavigation -> "Connected · confirming pane"
        viewerAuthority.controllerOwnership == ControllerOwnership.READ_ONLY &&
            viewerAuthority.authoritativeTarget == viewerAuthority.desiredTarget ->
            "Read-only · viewing ${viewerAuthority.authoritativeTarget?.paneId}"
        viewerAuthority.controllerOwnership == ControllerOwnership.READ_ONLY -> "Read-only"
        viewerAuthority.canSendInput -> "Interactive · ${viewerAuthority.authoritativeTarget?.paneId}"
        else -> "Connected · pane not confirmed"
    }

    private fun syncInteractionUi(status: String = statusPrefix()) {
        controlButton?.isEnabled =
            viewerAuthority.connectionState == TerminalConnectionState.ATTACHED &&
            viewerAuthority.controllerOwnership == ControllerOwnership.READ_ONLY
        terminalView?.setRemoteScrollEnabled(viewerAuthority.canSendInput)
        terminalStatus?.text = status
    }

    private fun appVersionLabel(): String = "v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"

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
        const val FOCUS_TIMEOUT_MS = 5_000L
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
