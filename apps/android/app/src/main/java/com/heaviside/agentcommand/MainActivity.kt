/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand

import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.widget.doAfterTextChanged
import com.heaviside.agentcommand.data.AgentCommandApi
import com.heaviside.agentcommand.data.CommandResultEvent
import com.heaviside.agentcommand.data.NavigationResult
import com.heaviside.agentcommand.data.SavedCredentials
import com.heaviside.agentcommand.data.ScrollbackRequest
import com.heaviside.agentcommand.data.SessionsChangedEvent
import com.heaviside.agentcommand.data.TerminalSocket
import com.heaviside.agentcommand.data.TmuxCommand
import com.heaviside.agentcommand.data.TmuxOpenRequest
import com.heaviside.agentcommand.data.TmuxPane
import com.heaviside.agentcommand.data.TmuxTopologyEvent
import com.heaviside.agentcommand.data.Topology
import com.heaviside.agentcommand.data.TranscriptRequest
import com.heaviside.agentcommand.data.UiStreamEvent
import com.heaviside.agentcommand.data.UiStreamSocket
import com.heaviside.agentcommand.domain.AppPreferences
import com.heaviside.agentcommand.domain.ClaudePaneVisibility
import com.heaviside.agentcommand.domain.ClaudeTranscriptFormatter
import com.heaviside.agentcommand.domain.CreatedPaneAdoptionAction
import com.heaviside.agentcommand.domain.CreatedPaneAdoptionState
import com.heaviside.agentcommand.domain.KeyRailMode
import com.heaviside.agentcommand.domain.LastTargetPreference
import com.heaviside.agentcommand.domain.LifecycleAction
import com.heaviside.agentcommand.domain.LifecycleCompletion
import com.heaviside.agentcommand.domain.LifecycleTransport
import com.heaviside.agentcommand.domain.PaneDirection
import com.heaviside.agentcommand.domain.PaneSplitDirection
import com.heaviside.agentcommand.domain.ScrollbackReaderState
import com.heaviside.agentcommand.domain.TmuxHostNode
import com.heaviside.agentcommand.domain.TmuxCommandState
import com.heaviside.agentcommand.domain.TmuxCommandTracker
import com.heaviside.agentcommand.domain.TmuxLifecycleActions
import com.heaviside.agentcommand.domain.TmuxLifecycleConfirmation
import com.heaviside.agentcommand.domain.TmuxPaneNode
import com.heaviside.agentcommand.domain.TmuxRoster
import com.heaviside.agentcommand.domain.TmuxSessionNode
import com.heaviside.agentcommand.domain.TmuxWindowNode
import com.heaviside.agentcommand.domain.TopologyExpectation
import com.heaviside.agentcommand.domain.TranscriptHistory
import com.heaviside.agentcommand.domain.WorkbenchNavigation
import com.heaviside.agentcommand.domain.WorkbenchNavigationAction
import com.heaviside.agentcommand.domain.hostSupportsPercentSplits
import com.heaviside.agentcommand.domain.resolveDirectionalPaneTargets
import com.heaviside.agentcommand.security.AppPreferenceStore
import com.heaviside.agentcommand.security.SecureStore
import com.heaviside.agentcommand.terminal.ControllerOwnership
import com.heaviside.agentcommand.terminal.RemoteTerminalView
import com.heaviside.agentcommand.terminal.TerminalKey
import com.heaviside.agentcommand.terminal.TerminalConnectionState
import com.heaviside.agentcommand.terminal.ViewerAuthority
import com.heaviside.agentcommand.terminal.ViewerResolution
import com.heaviside.agentcommand.terminal.ViewerTarget
import com.heaviside.agentcommand.ui.RosterNavigatorView
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import kotlin.math.roundToInt

class MainActivity : Activity() {
    private enum class Screen { SIGN_IN, ROSTER, TERMINAL }

    private data class LifecycleContext(
        val host: TmuxHostNode,
        val session: TmuxSessionNode,
        val window: TmuxWindowNode,
        val pane: TmuxPaneNode,
        val commandPane: TmuxPane,
        val zoomed: Boolean,
    )

    private val mainHandler = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()

    private lateinit var secureStore: SecureStore
    private lateinit var preferenceStore: AppPreferenceStore
    private var preferences = AppPreferences()
    private var api: AgentCommandApi? = null
    private var pendingCredentials: SavedCredentials? = null
    private var screen = Screen.SIGN_IN
    private var started = false
    private var topology: Topology? = null
    private var roster = TmuxRoster(emptyList())
    private var rosterView: RosterNavigatorView? = null
    private var navigatorView: RosterNavigatorView? = null
    private var navigatorDialog: Dialog? = null
    private var restoreLastTargetPending = false
    private var activePane: TmuxPane? = null
    private val workbenchNavigation = WorkbenchNavigation()
    private var terminalSocket: TerminalSocket? = null
    private var terminalView: RemoteTerminalView? = null
    private var terminalTitle: TextView? = null
    private var terminalStatus: TextView? = null
    private var zoomButton: Button? = null
    private var claudeButton: Button? = null
    private var controlButton: Button? = null
    private var ctrlButton: Button? = null
    private var railModeButton: Button? = null
    private var keyRailContainer: LinearLayout? = null
    private var resumeToken: String? = null
    private var resumeSessionId: String? = null
    private val viewerAuthority = ViewerAuthority()
    private var navigationTimeout: Runnable? = null
    private var connectionGeneration = 0L
    private var reconnecting = false
    private var tmuxZoomed = false
    private var uiStreamSocket: UiStreamSocket? = null
    private var uiStreamGeneration = 0L
    private var uiStreamConnecting = false
    private var uiStreamConnected = false
    private var uiStreamFailure: String? = null
    private val commandTracker = TmuxCommandTracker()
    private val commandCallbacks = mutableMapOf<String, (TmuxCommandState) -> Unit>()
    private val liveTopologies = mutableMapOf<String, TmuxTopologyEvent>()
    private var lifecycleDialog: Dialog? = null
    private var lifecycleStatus: TextView? = null
    private val lifecycleButtons = mutableMapOf<Button, Boolean>()
    private var lifecycleMutationPending = false
    private var pendingLifecycleViewerTarget: ViewerTarget? = null
    private var pendingLifecycleSuccess: String? = null
    private val createdPaneAdoption = CreatedPaneAdoptionState()
    private var createdPaneAdoptionTimeout: Runnable? = null

    private val reconnect = Runnable {
        if (started && screen == Screen.TERMINAL && terminalSocket == null) connectTerminal()
    }
    private val reconnectUiStream = Runnable {
        if (started && api != null && uiStreamSocket == null && !uiStreamConnecting) {
            connectUiStream()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        secureStore = SecureStore(this)
        preferenceStore = AppPreferenceStore(this)
        preferences = preferenceStore.load()
        api = secureStore.load()?.let(::AgentCommandApi)

        val restoredPane = savedInstanceState?.toPane()
        if (restoredPane != null && api != null) {
            resumeToken = savedInstanceState.getString(STATE_RESUME_TOKEN)
            resumeSessionId = restoredPane.sessionId
            tmuxZoomed = savedInstanceState.getBoolean(STATE_TMUX_ZOOMED)
            showTerminal(restoredPane, freshAttachment = false)
        } else if (api != null) {
            showRoster(restoreLastTarget = true)
            refreshRoster()
        } else {
            showSignIn()
        }
    }

    override fun onStart() {
        super.onStart()
        started = true
        mainHandler.removeCallbacks(reconnectUiStream)
        connectUiStream()
        if (screen == Screen.TERMINAL && terminalSocket == null) connectTerminal()
    }

    override fun onStop() {
        started = false
        mainHandler.removeCallbacks(reconnect)
        mainHandler.removeCallbacks(reconnectUiStream)
        disconnectUiStream()
        disconnectTerminal()
        super.onStop()
    }

    override fun onDestroy() {
        navigatorDialog?.dismiss()
        lifecycleDialog?.dismiss()
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
            refreshRoster()
        } else {
            super.onBackPressed()
        }
    }

    private fun showSignIn(error: String? = null) {
        screen = Screen.SIGN_IN
        disconnectUiStream()
        disconnectTerminal()
        activePane = null
        workbenchNavigation.clear()
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
                showRoster(restoreLastTarget = true)
                refreshRoster()
            },
            matchWrap(top = 20),
        )
        setContentView(content)
    }

    private fun showRoster(restoreLastTarget: Boolean = false) {
        screen = Screen.ROSTER
        reconnecting = false
        restoreLastTargetPending = restoreLastTarget
        disconnectTerminal()
        activePane = null
        workbenchNavigation.clear()
        navigatorDialog?.dismiss()
        lifecycleDialog?.dismiss()

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
        header.addView(button("Open") { showOpenExistingDialog() })
        header.addView(button("Web") { openWebLaunch() })
        header.addView(button("Sign out") {
            secureStore.clear()
            api = null
            topology = null
            roster = TmuxRoster(emptyList())
            liveTopologies.clear()
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
        rosterView = RosterNavigatorView(this, ::selectWorkbenchPane).also {
            it.tag = ROSTER_LIST_TAG
            root.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        setContentView(root)
        renderRoster(topology)
        connectUiStream()
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
                    acceptLoadedTopology(loaded)
                    pendingCredentials?.let(secureStore::save)
                    pendingCredentials = null
                    connectUiStream()
                    if (restoreLastTargetPending) {
                        restoreLastTargetPending = false
                        val resolution = LastTargetPreference.resolve(preferences, roster)
                        if (resolution.preferences != preferences) {
                            preferences = resolution.preferences
                            preferenceStore.save(preferences)
                        }
                        if (resolution.pane != null) {
                            showTerminal(resolution.pane, freshAttachment = true)
                            return@runOnUiThread
                        }
                    }
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
        findTaggedView<ProgressBar>(ROSTER_PROGRESS_TAG)?.visibility = View.GONE
        findTaggedView<TextView>(ROSTER_STATUS_TAG)?.text =
            buildString {
                append("${loaded.hosts.size} hosts · ${roster.panes.size} attachable panes")
                if (uiStreamConnected) append(" · live")
                uiStreamFailure?.let { append("\nLive topology: $it") }
            }
        rosterView?.update(roster)
    }

    private fun showTerminal(pane: TmuxPane, freshAttachment: Boolean) {
        screen = Screen.TERMINAL
        if (freshAttachment) {
            resumeToken = null
            resumeSessionId = null
            reconnecting = false
            tmuxZoomed = false
        }
        activePane = pane
        workbenchNavigation.attach(pane)
        disconnectTerminal()
        lifecycleDialog?.dismiss()

        val root = verticalLayout()
        val titleRow = horizontalLayout().apply {
            setPadding(dp(4), dp(6), dp(8), dp(2))
            gravity = Gravity.CENTER_VERTICAL
        }
        titleRow.addView(button("‹ Roster") {
            showRoster()
            refreshRoster()
        })
        terminalTitle = TextView(this).apply {
            text = terminalTitle(pane)
            setTextColor(Color.WHITE)
            textSize = 16f
            maxLines = 1
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }.also(titleRow::addView)
        titleRow.addView(button("Navigate") { showTerminalNavigator() })
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

        val workbenchTools = horizontalLayout().apply { gravity = Gravity.CENTER_VERTICAL }
        workbenchTools.addView(button("History") { activePane?.let(::showHistory) })
        workbenchTools.addView(button("Actions") { showTmuxActions() })
        claudeButton = button("Claude") { activePane?.let(::showClaudeTranscript) }.apply {
            visibility = if (ClaudePaneVisibility.isVisible(pane)) View.VISIBLE else View.GONE
        }.also(workbenchTools::addView)
        workbenchTools.addView(button("Copy live") {
            val copied = terminalView?.copyVisibleText().orEmpty()
            toast(if (copied.isEmpty()) "No visible terminal text" else "Visible terminal text copied")
        })
        workbenchTools.addView(button("Web launch") { openWebLaunch() })
        root.addView(HorizontalScrollView(this).apply { addView(workbenchTools) }, matchWrap())

        val displayTools = horizontalLayout().apply { gravity = Gravity.CENTER_VERTICAL }
        displayTools.addView(button("A−") { terminalView?.decreaseTextSize() })
        displayTools.addView(button("A+") { terminalView?.increaseTextSize() })
        zoomButton = button(if (tmuxZoomed) "Unzoom pane" else "Zoom pane") {
            requestPaneFocus(!tmuxZoomed)
        }.also(displayTools::addView)
        railModeButton = button(railModeLabel()) {
            preferences = preferences.copy(
                keyRailMode = if (preferences.keyRailMode == KeyRailMode.FIXED) {
                    KeyRailMode.EXPANDED
                } else {
                    KeyRailMode.FIXED
                },
            )
            savePreferences()
            railModeButton?.text = railModeLabel()
            renderKeyRail()
        }.also(displayTools::addView)
        displayTools.addView(button("Prefix settings") { showPrefixDialog() })
        root.addView(HorizontalScrollView(this).apply { addView(displayTools) }, matchWrap())

        keyRailContainer = horizontalLayout().apply {
            gravity = Gravity.CENTER_VERTICAL
        }
        root.addView(
            HorizontalScrollView(this).apply { addView(keyRailContainer) },
            matchWrap(),
        )

        terminalView = RemoteTerminalView(this).apply {
            onInput = { data -> if (viewerAuthority.canSendInput) terminalSocket?.sendInput(data) }
            onResize = { columns, rows -> terminalSocket?.sendResize(columns, rows) }
            onScrollRows = { rows -> if (viewerAuthority.canSendInput) terminalSocket?.scroll(rows) }
            onTextSizeChanged = { size ->
                preferences = preferences.copy(fontSizeSp = size.toFloat())
                savePreferences()
                terminalStatus?.text = "${statusPrefix()} · ${columns}×${rows} · ${size}sp"
            }
            onControlModifierChanged = { enabled -> updateCtrlButton(enabled) }
            setTextSizeSp(preferences.fontSizeSp.roundToInt())
        }.also { terminal ->
            root.addView(terminal, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        setContentView(root)
        renderKeyRail()
        navigatorView?.update(roster, pane.paneId)
        connectUiStream()
        loadTerminalRosterIfNeeded()
        if (started) connectTerminal()
    }

    private fun showTerminalNavigator() {
        if (screen != Screen.TERMINAL) return
        navigatorDialog?.dismiss()
        val root = verticalLayout().apply { setPadding(dp(12), dp(8), dp(12), dp(8)) }
        val header = horizontalLayout().apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(heading("Tmux navigator").apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        val dialog = fullScreenDialog(root)
        header.addView(button("Close") { dialog.dismiss() })
        root.addView(header, matchWrap())
        root.addView(body("Choose a pane. Same-session switches keep this viewer until tmux confirms the candidate."))
        navigatorView = RosterNavigatorView(this, ::selectWorkbenchPane).also {
            root.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            it.update(roster, activePane?.paneId)
        }
        dialog.setOnDismissListener {
            if (navigatorDialog === dialog) {
                navigatorDialog = null
                navigatorView = null
            }
        }
        navigatorDialog = dialog
        dialog.showFullScreen()
    }

    private fun showTmuxActions() {
        if (screen != Screen.TERMINAL) return
        val context = lifecycleContext()
        if (context == null) {
            toast("Wait for the current tmux pane to become authoritative.")
            return
        }
        lifecycleDialog?.dismiss()
        lifecycleButtons.clear()
        val root = verticalLayout().apply { setPadding(dp(12), dp(8), dp(12), dp(12)) }
        val dialog = fullScreenDialog(root)
        val header = horizontalLayout().apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(heading("Window & pane actions").apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        header.addView(button("Close") { dialog.dismiss() })
        root.addView(header, matchWrap())
        root.addView(
            body(
                buildString {
                    append("${context.host.host.name} · ${context.session.name}")
                    append("\nWindow ${context.window.index}: ${context.window.name}")
                    if (context.window.active == true) append(" · active")
                    if (context.window.activity == true) append(" · activity")
                    if (context.window.bell == true) append(" · bell")
                    append("\nPane ${context.pane.paneId} · index ${context.pane.paneIndex}")
                    append(if (context.pane.attachable) " · tracked" else " · live-only")
                    append(if (context.zoomed) " · focused/zoomed" else " · unzoomed")
                },
                Color.WHITE,
            ),
            matchWrap(),
        )
        lifecycleStatus = body(
            if (lifecycleMutationPending) {
                "Pending · waiting for authoritative completion…"
            } else {
                "Ready · REST acceptance is not command success."
            },
        ).also { root.addView(it, matchWrap()) }

        val hostAvailable = context.host.host.online &&
            context.host.host.capabilities.tmux &&
            context.host.host.capabilities.terminal
        val trackedCurrent = context.pane.attachable
        val canSpawn = hostAvailable && context.host.host.capabilities.spawn
        val canDestroy = hostAvailable && context.host.host.capabilities.kill && trackedCurrent
        val sections = verticalLayout()
        sections.addView(heading("Window").apply { textSize = 18f }, matchWrap())
        sections.addView(
            lifecycleButton("Select window…", hostAvailable) {
                showWindowSelection(context)
            },
            matchWrap(),
        )
        sections.addView(
            lifecycleButton("New window", canSpawn) {
                executeLifecycleAction(
                    context,
                    LifecycleAction.NewWindow(
                        context.pane.currentPath ?: context.commandPane.cwd,
                    ),
                    "create a new window",
                )
            },
            matchWrap(),
        )
        sections.addView(
            lifecycleButton("Rename current window", hostAvailable) {
                showRenameWindow(context)
            },
            matchWrap(),
        )
        sections.addView(
            lifecycleButton("Close current window", canDestroy) {
                confirmCloseWindow(context)
            },
            matchWrap(),
        )

        sections.addView(heading("Pane").apply {
            textSize = 18f
            setPadding(0, dp(16), 0, dp(4))
        }, matchWrap())
        val splitRow = horizontalLayout()
        splitRow.addView(
            lifecycleButton("Split horizontal", canSpawn) {
                executeLifecycleAction(
                    context,
                    LifecycleAction.SplitPane(
                        direction = PaneSplitDirection.HORIZONTAL,
                        cwd = context.pane.currentPath ?: context.commandPane.cwd,
                        supportsPercent = hostSupportsPercentSplits(context.host.host),
                    ),
                    "split the pane horizontally",
                )
            },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )
        splitRow.addView(
            lifecycleButton("Split vertical", canSpawn) {
                executeLifecycleAction(
                    context,
                    LifecycleAction.SplitPane(
                        direction = PaneSplitDirection.VERTICAL,
                        cwd = context.pane.currentPath ?: context.commandPane.cwd,
                        supportsPercent = hostSupportsPercentSplits(context.host.host),
                    ),
                    "split the pane vertically",
                )
            },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )
        sections.addView(splitRow, matchWrap())

        val directional = resolveDirectionalPaneTargets(
            context.window.panes,
            context.pane.paneId,
            context.window.layout.orEmpty(),
        )
        val directionRow = horizontalLayout()
        listOf(
            "←" to PaneDirection.LEFT,
            "↑" to PaneDirection.UP,
            "↓" to PaneDirection.DOWN,
            "→" to PaneDirection.RIGHT,
        ).forEach { (label, direction) ->
            val target = directional.getValue(direction)
            directionRow.addView(
                lifecycleButton(label, target != null) {
                    target?.let {
                        executeLifecycleAction(
                            context,
                            LifecycleAction.SelectPane(it.paneId, preserveZoom = context.zoomed),
                            "select pane ${direction.name.lowercase()}",
                        )
                    }
                },
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
            )
        }
        sections.addView(directionRow, matchWrap())

        sections.addView(
            lifecycleButton(
                if (context.zoomed) "Unfocus / unzoom pane" else "Focus / zoom pane",
                hostAvailable,
            ) {
                executeLifecycleAction(
                    context,
                    LifecycleAction.SetPaneFocus(context.pane.paneId, focused = !context.zoomed),
                    if (context.zoomed) "unfocus the pane" else "focus the pane",
                )
            },
            matchWrap(),
        )
        sections.addView(
            lifecycleButton("Terminate & archive tracked pane", canDestroy) {
                confirmTerminatePane(context)
            },
            matchWrap(),
        )
        if (!trackedCurrent) {
            sections.addView(
                body("Destructive actions are disabled because this authoritative pane is live-only."),
                matchWrap(),
            )
        }
        root.addView(
            ScrollView(this).apply { addView(sections, matchWrap()) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
        )
        dialog.setOnDismissListener {
            if (lifecycleDialog === dialog) {
                lifecycleDialog = null
                lifecycleStatus = null
                lifecycleButtons.clear()
            }
        }
        lifecycleDialog = dialog
        setLifecyclePending(lifecycleMutationPending)
        dialog.showFullScreen()
    }

    private fun lifecycleContext(): LifecycleContext? {
        val commandPane = activePane ?: return null
        val target = viewerAuthority.authoritativeTarget ?: return null
        val host = roster.hosts.firstOrNull { it.host.id == commandPane.hostId } ?: return null
        host.sessions.forEach { session ->
            session.windows.forEach { window ->
                val pane = window.panes.firstOrNull { it.paneId == target.paneId }
                if (pane != null && session.name == commandPane.tmuxSessionName) {
                    return LifecycleContext(host, session, window, pane, commandPane, target.zoomed)
                }
            }
        }
        return null
    }

    private fun lifecycleButton(label: String, enabled: Boolean, action: () -> Unit): Button =
        button(label, action).also {
            lifecycleButtons[it] = enabled
            it.isEnabled = enabled && !lifecycleMutationPending
        }

    private fun showWindowSelection(context: LifecycleContext) {
        val windows = context.session.windows.sortedBy { it.index }
        val labels = windows.map { window ->
            buildString {
                append("${window.index}: ${window.name}")
                if (window.active == true) append(" · active")
                if (window.activity == true) append(" · activity")
                if (window.bell == true) append(" · bell")
            }
        }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("Select window")
            .setItems(labels) { _, index ->
                val window = windows[index]
                val target = window.panes.firstOrNull { it.active == true } ?: window.panes.firstOrNull()
                executeLifecycleAction(
                    context,
                    LifecycleAction.SelectWindow(
                        sessionName = context.session.name,
                        windowIndex = window.index,
                        paneId = target?.paneId,
                        preserveZoom = context.zoomed,
                    ),
                    "select window ${window.index}",
                )
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showRenameWindow(context: LifecycleContext) {
        val input = EditText(this).apply {
            setText(context.window.name)
            setSelection(text.length)
            setSingleLine()
            setTextColor(Color.WHITE)
        }
        AlertDialog.Builder(this)
            .setTitle("Rename window ${context.window.index}")
            .setView(input)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Rename") { _, _ ->
                val name = input.text.toString().trim()
                if (name.isBlank()) {
                    setLifecycleStatus("Failed · window name is required.", ERROR)
                } else {
                    executeLifecycleAction(
                        context,
                        LifecycleAction.RenameWindow(
                            context.session.name,
                            context.window.index,
                            name,
                        ),
                        "rename window ${context.window.index}",
                    )
                }
            }
            .show()
    }

    private fun confirmCloseWindow(context: LifecycleContext) {
        AlertDialog.Builder(this)
            .setTitle("Confirm window close")
            .setMessage(
                TmuxLifecycleConfirmation.closeWindow(
                    context.window.index,
                    context.session.windows.size.takeIf { context.session.attached != null },
                ),
            )
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Close window") { _, _ ->
                executeLifecycleAction(
                    context,
                    LifecycleAction.CloseWindow(context.session.name, context.window.index),
                    "close window ${context.window.index}",
                )
            }
            .show()
    }

    private fun confirmTerminatePane(context: LifecycleContext) {
        val tracked = context.pane.pane ?: return
        AlertDialog.Builder(this)
            .setTitle("Confirm pane termination")
            .setMessage(TmuxLifecycleConfirmation.terminatePane(context.pane.paneId))
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Terminate & archive") { _, _ ->
                executeLifecycleAction(
                    context,
                    LifecycleAction.TerminatePane(tracked.sessionId),
                    "terminate pane ${context.pane.paneId}",
                )
            }
            .show()
    }

    private fun executeLifecycleAction(
        context: LifecycleContext,
        action: LifecycleAction,
        label: String,
    ) {
        if (lifecycleMutationPending || viewerAuthority.hasPendingNavigation) {
            setLifecycleStatus("Pending · wait for the current tmux action to finish.", MUTED)
            return
        }
        val current = lifecycleContext()
        if (
            current == null ||
            current.host.host.id != context.host.host.id ||
            current.session.name != context.session.name ||
            current.window.index != context.window.index ||
            current.pane.paneId != context.pane.paneId
        ) {
            setLifecycleStatus("Failed · authoritative pane changed; reopen Actions.", ERROR)
            return
        }
        when (val transport = TmuxLifecycleActions.plan(action)) {
            is LifecycleTransport.ViewerFocus ->
                executeLifecycleViewerAction(action, transport.target, label)
            is LifecycleTransport.RestCommand ->
                executeLifecycleRestAction(current, transport, label)
            is LifecycleTransport.BulkTerminate ->
                executeLifecycleTerminate(current, transport.sessionId, label)
        }
    }

    private fun executeLifecycleViewerAction(
        action: LifecycleAction,
        target: ViewerTarget,
        label: String,
    ) {
        if (
            terminalSocket == null ||
            viewerAuthority.connectionState != TerminalConnectionState.ATTACHED
        ) {
            setLifecycleStatus("Failed · terminal viewer is not attached.", ERROR)
            return
        }
        if (viewerAuthority.authoritativeTarget == target && !viewerAuthority.hasPendingNavigation) {
            setLifecycleStatus("Succeeded · ${target.paneId} is already authoritative.", ONLINE)
            return
        }
        if (action is LifecycleAction.SelectWindow || action is LifecycleAction.SelectPane) {
            val pane = activePane?.hostId?.let { roster.findPane(it, target.paneId) }
            if (pane != null) {
                workbenchNavigation.select(
                    pane = pane,
                    viewerAvailable = true,
                    zoomed = target.zoomed,
                )
            }
        }
        setLifecyclePending(true)
        pendingLifecycleViewerTarget = target
        pendingLifecycleSuccess = "Succeeded · $label."
        setLifecycleStatus("Pending · confirming $label through the terminal viewer…", MUTED)
        if (!requestViewerFocus(target) && pendingLifecycleViewerTarget != null) {
            failLifecycleViewerOperation("Pane focus request could not be sent.")
        }
    }

    private fun executeLifecycleRestAction(
        context: LifecycleContext,
        transport: LifecycleTransport.RestCommand,
        label: String,
    ) {
        setLifecyclePending(true)
        setLifecycleStatus("Pending · dispatching $label…", MUTED)
        dispatchTrackedCommand(
            context.commandPane,
            transport.command,
            transport.expectation,
        ) { state ->
            when (state) {
                is TmuxCommandState.Pending ->
                    setLifecycleStatus(
                        "Pending · $label accepted; waiting for command/topology completion…",
                        MUTED,
                    )
                is TmuxCommandState.Failed ->
                    reconcileRosterAfterMutation(
                        "Failed · ${state.error.code}: ${state.error.message}",
                        ERROR,
                    )
                is TmuxCommandState.Succeeded -> {
                    if (transport.completion == LifecycleCompletion.EXACT_RESULT) {
                        val createdPaneId = state.createdPaneId()
                        if (createdPaneId == null) {
                            reconcileRosterAfterMutation(
                                "Failed · command completed without the required created pane ID.",
                                ERROR,
                            )
                            return@dispatchTrackedCommand
                        }
                        adoptCreatedPaneAndFocus(context, createdPaneId, label)
                    } else {
                        val closesCurrentWindow = transport.command.type == "kill_window"
                        reconcileRosterAfterMutation(
                            "Succeeded · $label.",
                            ONLINE,
                        ) {
                            if (closesCurrentWindow) {
                                lifecycleDialog?.dismiss()
                                showRoster()
                                refreshRoster()
                            }
                        }
                    }
                }
            }
        }
    }

    private fun adoptCreatedPaneAndFocus(
        context: LifecycleContext,
        createdPaneId: String,
        label: String,
    ) {
        val successMessage = "Succeeded · $label; selected $createdPaneId."
        pendingLifecycleSuccess = successMessage
        val adoption = createdPaneAdoption.begin(
            hostId = context.host.host.id,
            paneId = createdPaneId,
            tmuxSessionName = context.session.name,
        )
        scheduleCreatedPaneAdoptionTimeout()
        when (adoption) {
            is CreatedPaneAdoptionAction.RefreshRoster ->
                refreshCreatedPaneAdoption(adoption)
            is CreatedPaneAdoptionAction.WaitForPersistence ->
                setLifecycleStatus(
                    "Completed · created $createdPaneId · waiting for its durable session event…",
                    MUTED,
                )
            else -> Unit
        }
    }

    private fun observeCreatedPanePersistence(event: SessionsChangedEvent) {
        when (val action = createdPaneAdoption.observe(event)) {
            CreatedPaneAdoptionAction.Ignore -> Unit
            is CreatedPaneAdoptionAction.RefreshRoster -> refreshCreatedPaneAdoption(action)
            else -> Unit
        }
    }

    private fun refreshCreatedPaneAdoption(
        action: CreatedPaneAdoptionAction.RefreshRoster,
    ) {
        val currentApi = api
        if (currentApi == null) {
            failLifecycleViewerOperation("Sign in again to adopt created pane ${action.paneId}.")
            return
        }
        setLifecycleStatus(
            "Persisted ${action.paneId} · resolving its authoritative roster anchor…",
            MUTED,
        )
        io.execute {
            runCatching { currentApi.loadTopology() }
                .onSuccess { loaded -> runOnUiThread {
                    if (!createdPaneAdoption.isPending) return@runOnUiThread
                    val durableRoster = TmuxRoster.from(loaded)
                    acceptLoadedTopology(loaded)
                    updateRosterViews()
                    when (val resolved = createdPaneAdoption.resolveRoster(durableRoster)) {
                        CreatedPaneAdoptionAction.Ignore -> Unit
                        is CreatedPaneAdoptionAction.OpenPane -> {
                            cancelCreatedPaneAdoptionTimeout()
                            openCreatedPaneForAdoption(resolved.pane)
                        }
                        is CreatedPaneAdoptionAction.FocusPane -> {
                            cancelCreatedPaneAdoptionTimeout()
                            focusCreatedPane(resolved.pane)
                        }
                        is CreatedPaneAdoptionAction.Failed ->
                            failLifecycleViewerOperation(resolved.message)
                        else -> Unit
                    }
                } }
                .onFailure { failure -> runOnUiThread {
                    if (!createdPaneAdoption.isPending) return@runOnUiThread
                    failLifecycleViewerOperation(
                        failure.message
                            ?: "Unable to resolve created pane ${action.paneId} from the roster.",
                    )
                } }
        }
    }

    private fun openCreatedPaneForAdoption(pane: TmuxPane) {
        val currentApi = api
        if (currentApi == null) {
            failLifecycleViewerOperation("Sign in again to adopt created pane ${pane.paneId}.")
            return
        }
        setLifecycleStatus(
            "Resolved ${pane.paneId} · adopting its durable command anchor…",
            MUTED,
        )
        io.execute {
            runCatching {
                currentApi.openTmuxTarget(
                    TmuxOpenRequest(
                        hostId = pane.hostId,
                        paneId = pane.paneId,
                    ),
                )
            }.onSuccess { opened -> runOnUiThread {
                if (!createdPaneAdoption.isPending) return@runOnUiThread
                when (val resolved = createdPaneAdoption.resolveOpen(opened)) {
                    is CreatedPaneAdoptionAction.FocusPane -> focusCreatedPane(resolved.pane)
                    is CreatedPaneAdoptionAction.Failed ->
                        failLifecycleViewerOperation(resolved.message)
                    else -> Unit
                }
            } }.onFailure { failure -> runOnUiThread {
                if (!createdPaneAdoption.isPending) return@runOnUiThread
                failLifecycleViewerOperation(
                    failure.message ?: "Unable to adopt created pane ${pane.paneId}.",
                )
            } }
        }
    }

    private fun focusCreatedPane(pane: TmuxPane) {
        val target = ViewerTarget(pane.paneId, zoomed = false)
        val navigation = workbenchNavigation.select(
            pane = pane,
            viewerAvailable = terminalSocket != null &&
                viewerAuthority.connectionState == TerminalConnectionState.ATTACHED,
            zoomed = false,
        )
        if (navigation !is WorkbenchNavigationAction.FocusCandidate) {
            failLifecycleViewerOperation(
                "Created pane ${pane.paneId} could not use the current viewer.",
            )
            return
        }
        pendingLifecycleViewerTarget = target
        setLifecycleStatus(
            "Adopted ${pane.paneId} · confirming authoritative viewer focus…",
            MUTED,
        )
        if (!requestViewerFocus(target) && pendingLifecycleViewerTarget != null) {
            failLifecycleViewerOperation(
                "Pane focus request for created pane ${pane.paneId} could not be sent.",
            )
        }
    }

    private fun scheduleCreatedPaneAdoptionTimeout() {
        cancelCreatedPaneAdoptionTimeout()
        createdPaneAdoptionTimeout = Runnable {
            createdPaneAdoptionTimeout = null
            val timedOut = createdPaneAdoption.timeout()
            if (timedOut is CreatedPaneAdoptionAction.Failed) {
                failLifecycleViewerOperation(timedOut.message)
            }
        }.also {
            mainHandler.postDelayed(it, CREATED_PANE_ADOPTION_TIMEOUT_MS)
        }
    }

    private fun cancelCreatedPaneAdoptionTimeout() {
        createdPaneAdoptionTimeout?.let(mainHandler::removeCallbacks)
        createdPaneAdoptionTimeout = null
    }

    private fun executeLifecycleTerminate(
        context: LifecycleContext,
        sessionId: String,
        label: String,
    ) {
        if (context.pane.pane?.sessionId != sessionId) {
            setLifecycleStatus("Failed · pane is no longer tracked by that session.", ERROR)
            return
        }
        val currentApi = api ?: run {
            setLifecycleStatus("Failed · sign in again.", ERROR)
            return
        }
        setLifecyclePending(true)
        setLifecycleStatus("Pending · waiting for terminate and archive completion…", MUTED)
        io.execute {
            runCatching { currentApi.terminateTrackedPane(sessionId) }
                .onSuccess { result -> runOnUiThread {
                    if (!result.completed) {
                        reconcileRosterAfterMutation(
                            "Failed · ${result.error ?: "tracked pane termination failed"}",
                            ERROR,
                        )
                    } else {
                        reconcileRosterAfterMutation(
                            "Succeeded · $label and archive completed.",
                            ONLINE,
                        ) {
                            lifecycleDialog?.dismiss()
                            showRoster()
                            refreshRoster()
                        }
                    }
                } }
                .onFailure { failure -> runOnUiThread {
                    reconcileRosterAfterMutation(
                        "Failed · ${failure.message ?: "tracked pane termination failed"}",
                        ERROR,
                    )
                } }
        }
    }

    private fun reconcileRosterAfterMutation(
        finalStatus: String,
        color: Int,
        after: () -> Unit = {},
    ) {
        val currentApi = api
        if (currentApi == null) {
            setLifecyclePending(false)
            setLifecycleStatus("$finalStatus\nRoster reconciliation failed: sign in again.", color)
            after()
            return
        }
        setLifecycleStatus("Reconciling authoritative roster…", MUTED)
        io.execute {
            runCatching { currentApi.loadTopology() }
                .onSuccess { loaded -> runOnUiThread {
                    acceptLoadedTopology(loaded)
                    updateRosterViews()
                    setLifecyclePending(false)
                    setLifecycleStatus(finalStatus, color)
                    after()
                } }
                .onFailure { failure -> runOnUiThread {
                    setLifecyclePending(false)
                    setLifecycleStatus(
                        "$finalStatus\nRoster reconciliation failed: " +
                            (failure.message ?: "unable to load topology"),
                        color,
                    )
                    after()
                } }
        }
    }

    private fun TmuxCommandState.Succeeded.createdPaneId(): String? =
        resultJson?.let { raw ->
            runCatching { JSONObject(raw).optString("pane_id").takeIf(String::isNotBlank) }
                .getOrNull()
        }

    private fun setLifecyclePending(pending: Boolean) {
        lifecycleMutationPending = pending
        lifecycleButtons.forEach { (button, allowed) ->
            button.isEnabled = allowed && !pending
        }
    }

    private fun setLifecycleStatus(message: String, color: Int) {
        lifecycleStatus?.setTextColor(color)
        lifecycleStatus?.text = message
    }

    private fun selectWorkbenchPane(pane: TmuxPane) {
        if (screen == Screen.TERMINAL && viewerAuthority.hasPendingNavigation) {
            toast("Wait for the current pane switch to finish.")
            return
        }
        val action = workbenchNavigation.select(
            pane = pane,
            viewerAvailable = screen == Screen.TERMINAL &&
                terminalSocket != null &&
                viewerAuthority.connectionState == TerminalConnectionState.ATTACHED,
            zoomed = tmuxZoomed,
        )
        navigatorDialog?.dismiss()
        when (action) {
            WorkbenchNavigationAction.AlreadyActive -> {
                if (screen == Screen.TERMINAL && !viewerAuthority.canSendInput) {
                    requestViewerFocus(ViewerTarget(pane.paneId, tmuxZoomed))
                }
            }
            is WorkbenchNavigationAction.FocusCandidate -> requestViewerFocus(action.target)
            is WorkbenchNavigationAction.FreshAttachment ->
                showTerminal(action.pane, freshAttachment = true)
        }
    }

    private fun renderKeyRail() {
        val rail = keyRailContainer ?: return
        rail.removeAllViews()
        rail.addView(keyButton("Esc", TerminalKey.ESCAPE))
        ctrlButton = button("Ctrl") {
            if (!viewerAuthority.canSendInput) return@button showInputBlocked()
            val enabled = ctrlButton?.isSelected != true
            ctrlButton?.isSelected = enabled
            terminalView?.setControlModifier(enabled)
            updateCtrlButton(enabled)
        }.also(rail::addView)
        rail.addView(keyButton("Tab", TerminalKey.TAB))
        if (preferences.keyRailMode == KeyRailMode.EXPANDED) {
            rail.addView(keyButton("⇧Tab", TerminalKey.SHIFT_TAB))
        }
        rail.addView(keyButton("←", TerminalKey.LEFT))
        rail.addView(keyButton("↑", TerminalKey.UP))
        rail.addView(keyButton("↓", TerminalKey.DOWN))
        rail.addView(keyButton("→", TerminalKey.RIGHT))
        if (preferences.keyRailMode == KeyRailMode.EXPANDED) {
            rail.addView(keyButton("PgUp", TerminalKey.PAGE_UP))
            rail.addView(keyButton("PgDn", TerminalKey.PAGE_DOWN))
            rail.addView(keyButton("Home", TerminalKey.HOME))
            rail.addView(keyButton("End", TerminalKey.END))
        }
        rail.addView(keyButton("Enter", TerminalKey.ENTER))
        rail.addView(button("Keyboard") { terminalView?.toggleKeyboard() })
        rail.addView(button("Paste") {
            if (!viewerAuthority.canSendInput) {
                showInputBlocked()
            } else if (terminalView?.pasteClipboard() != true) {
                toast("Clipboard is empty or unavailable. Tap the terminal and use the keyboard paste action.")
            }
        })
        val prefix = configuredPrefix()
        rail.addView(button("Prefix $prefix") {
            if (viewerAuthority.canSendInput) terminalView?.sendTmuxPrefix(prefix) else showInputBlocked()
        })
    }

    private fun keyButton(label: String, key: TerminalKey): Button = button(label) {
        if (viewerAuthority.canSendInput) terminalView?.sendKey(key) else showInputBlocked()
    }

    private fun showInputBlocked() {
        toast(
            when {
                viewerAuthority.controllerOwnership == ControllerOwnership.READ_ONLY ->
                    "Read-only. Use Take Control before sending input."
                viewerAuthority.hasPendingNavigation -> "Pane switch is still being confirmed."
                else -> "Terminal input is not yet verified."
            },
        )
    }

    private fun showPrefixDialog() {
        val pane = activePane ?: return
        val input = EditText(this).apply {
            setText(configuredPrefix())
            setSelection(text.length)
            hint = "C-b"
            setTextColor(Color.WHITE)
            setHintTextColor(MUTED)
            inputType = InputType.TYPE_CLASS_TEXT
        }
        AlertDialog.Builder(this)
            .setTitle("Tmux prefix for ${pane.hostName}")
            .setMessage("Use forms such as C-b, Ctrl+a, or a literal sequence.")
            .setView(input)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save") { _, _ ->
                val value = input.text.toString().trim()
                if (value.isBlank()) {
                    toast("Tmux prefix cannot be blank")
                } else {
                    preferences = preferences.copy(
                        tmuxPrefixes = preferences.tmuxPrefixes + (pane.hostId to value),
                    )
                    savePreferences()
                    renderKeyRail()
                }
            }
            .show()
    }

    private fun configuredPrefix(): String =
        activePane?.hostId?.let(preferences.tmuxPrefixes::get) ?: DEFAULT_TMUX_PREFIX

    private fun railModeLabel(): String =
        if (preferences.keyRailMode == KeyRailMode.FIXED) "Expand keys" else "Fixed keys"

    private fun showOpenExistingDialog() {
        val hostInput = EditText(this).apply {
            hint = "Host ID or alias"
            setText(activePane?.hostId ?: roster.hosts.firstOrNull()?.host?.id.orEmpty())
            setTextColor(Color.WHITE)
            setHintTextColor(MUTED)
            setSingleLine()
        }
        val targetInput = EditText(this).apply {
            hint = "Existing target, e.g. vault:1.0 or %7"
            setTextColor(Color.WHITE)
            setHintTextColor(MUTED)
            setSingleLine()
        }
        val status = body("Opens or adopts an existing tmux target. It does not launch a new agent.")
        val root = verticalLayout().apply {
            setPadding(dp(20), dp(12), dp(20), dp(4))
            addView(hostInput, matchWrap())
            addView(targetInput, matchWrap())
            addView(status, matchWrap())
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("Open existing tmux target")
            .setView(root)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Open", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val host = hostInput.text.toString().trim()
                val target = targetInput.text.toString().trim()
                if (host.isBlank() || target.isBlank()) {
                    status.setTextColor(ERROR)
                    status.text = "Host and existing target are required."
                    return@setOnClickListener
                }
                status.setTextColor(MUTED)
                status.text = "Opening existing target…"
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                val knownHost = roster.hosts.firstOrNull { it.host.id == host }
                val request = TmuxOpenRequest(
                    hostId = knownHost?.host?.id,
                    hostAlias = host.takeIf { knownHost == null },
                    tmuxTarget = target.takeUnless { it.startsWith("%") },
                    paneId = target.takeIf { it.startsWith("%") },
                )
                val currentApi = api ?: return@setOnClickListener
                io.execute {
                    runCatching { currentApi.openTmuxTarget(request) }
                        .onSuccess { result -> runOnUiThread {
                            if (!dialog.isShowing) return@runOnUiThread
                            if (!result.terminalOpenable) {
                                status.setTextColor(ERROR)
                                status.text = "The target was found but is not terminal-openable."
                                dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true
                            } else {
                                dialog.dismiss()
                                showTerminal(result.pane, freshAttachment = true)
                            }
                        } }
                        .onFailure { failure -> runOnUiThread {
                            if (!dialog.isShowing) return@runOnUiThread
                            status.setTextColor(ERROR)
                            status.text = failure.message ?: "Unable to open existing tmux target"
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true
                        } }
                }
            }
        }
        dialog.show()
    }

    private fun openWebLaunch() {
        val endpoint = secureStore.load()?.endpoint
        if (endpoint.isNullOrBlank()) {
            toast("Sign in again before opening the web workbench.")
            return
        }
        val url = Uri.parse(endpoint.trimEnd('/') + "/")
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
            .onFailure { toast("No browser is available for the authenticated web launch flow.") }
    }

    private fun showHistory(pane: TmuxPane) {
        val reader = ScrollbackReaderState()
        val root = verticalLayout().apply { setPadding(dp(12), dp(8), dp(12), dp(8)) }
        val dialog = fullScreenDialog(root)
        val header = horizontalLayout().apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(heading("History · ${pane.target}").apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        header.addView(button("Return live") { dialog.dismiss() })
        root.addView(header, matchWrap())
        val status = body("Loading recent server history…")
        root.addView(status, matchWrap())
        val search = EditText(this).apply {
            hint = "Search loaded history"
            setSingleLine()
            setTextColor(Color.WHITE)
            setHintTextColor(MUTED)
        }
        root.addView(search, matchWrap())
        val text = selectableMonospaceText()
        root.addView(
            ScrollView(this).apply { addView(text, matchWrap()) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
        )
        val actions = horizontalLayout()
        val older = button("Load older") {}
        actions.addView(older)
        actions.addView(button("Copy visible") {
            copyScrollbackCapture(pane, ScrollbackRequest.Visible(), "Visible history copied", status)
        })
        actions.addView(button("Copy last 50") {
            copyScrollbackCapture(pane, ScrollbackRequest.Last(50), "Last 50 lines copied", status)
        })
        actions.addView(button("Copy all") {
            copyScrollbackCapture(pane, ScrollbackRequest.Full(), "All available history copied", status)
        })
        root.addView(HorizontalScrollView(this).apply { addView(actions) }, matchWrap())

        fun render() {
            val lines = reader.visibleLines
            text.text = lines.joinToString("\n") { it.text }
            status.setTextColor(MUTED)
            status.text = buildString {
                append("${reader.allLines.size} lines loaded")
                if (search.text?.isNotBlank() == true) append(" · ${lines.size} matching")
                append(" · selectable")
                if (viewerAuthority.controllerOwnership == ControllerOwnership.READ_ONLY) {
                    append(" · read-only safe")
                }
            }
            older.isEnabled = reader.canLoadOlder
        }

        fun loadOlder() {
            val range = reader.nextRange ?: return
            older.isEnabled = false
            status.setTextColor(MUTED)
            status.text = "Loading lines ${range.startLine}…${range.endLine}…"
            val currentApi = api ?: return
            io.execute {
                runCatching {
                    currentApi.loadScrollback(
                        pane.sessionId,
                        ScrollbackRequest.Range(range.startLine, range.endLine),
                    )
                }.onSuccess { capture -> runOnUiThread {
                    if (!dialog.isShowing) return@runOnUiThread
                    runCatching { reader.accept(range, capture) }
                        .onSuccess { render() }
                        .onFailure {
                            status.setTextColor(ERROR)
                            status.text = it.message ?: "Unable to load history"
                            older.isEnabled = true
                        }
                } }.onFailure { failure -> runOnUiThread {
                    if (!dialog.isShowing) return@runOnUiThread
                    status.setTextColor(ERROR)
                    status.text = failure.message ?: "Unable to load history"
                    older.isEnabled = true
                } }
            }
        }

        older.setOnClickListener { loadOlder() }
        search.doAfterTextChanged {
            reader.query = it?.toString().orEmpty()
            render()
        }
        dialog.showFullScreen()
        loadOlder()
    }

    private fun copyScrollbackCapture(
        pane: TmuxPane,
        request: ScrollbackRequest,
        successMessage: String,
        status: TextView,
    ) {
        val currentApi = api ?: return
        status.setTextColor(MUTED)
        status.text = "Capturing history…"
        io.execute {
            runCatching { currentApi.loadScrollback(pane.sessionId, request) }
                .onSuccess { capture -> runOnUiThread {
                    if (!capture.ok) {
                        status.setTextColor(ERROR)
                        status.text = capture.error?.message ?: "History capture failed"
                    } else {
                        val content = capture.lines.joinToString("\n")
                        if (content.isEmpty()) {
                            status.text = "No history was returned."
                        } else {
                            copyText("tmux history", content)
                            status.text = successMessage
                        }
                    }
                } }
                .onFailure { failure -> runOnUiThread {
                    status.setTextColor(ERROR)
                    status.text = failure.message ?: "History capture failed"
                } }
        }
    }

    private fun showClaudeTranscript(pane: TmuxPane) {
        val history = arrayOf(TranscriptHistory())
        val root = verticalLayout().apply { setPadding(dp(12), dp(8), dp(12), dp(8)) }
        val dialog = fullScreenDialog(root)
        val header = horizontalLayout().apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(heading("Claude transcript · ${pane.target}").apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        header.addView(button("Return live") { dialog.dismiss() })
        root.addView(header, matchWrap())
        val status = body("Loading transcript…")
        root.addView(status, matchWrap())
        val search = EditText(this).apply {
            hint = "Search loaded transcript"
            setSingleLine()
            setTextColor(Color.WHITE)
            setHintTextColor(MUTED)
        }
        root.addView(search, matchWrap())
        val transcript = selectableMonospaceText()
        root.addView(
            ScrollView(this).apply { addView(transcript, matchWrap()) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
        )
        val older = button("Load older") {}
        root.addView(older, matchWrap())
        val composer = EditText(this).apply {
            hint = "Prompt current verified Claude pane"
            minLines = 2
            maxLines = 5
            gravity = Gravity.TOP
            setTextColor(Color.WHITE)
            setHintTextColor(MUTED)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
        }
        root.addView(composer, matchWrap())
        val send = button("Send prompt + Enter") {
            val prompt = composer.text.toString()
            val current = activePane
            val verified = screen == Screen.TERMINAL &&
                current?.hostId == pane.hostId &&
                current.paneId == pane.paneId &&
                viewerAuthority.canSendInput &&
                viewerAuthority.authoritativeTarget?.paneId == pane.paneId
            when {
                prompt.isEmpty() -> {
                    status.setTextColor(ERROR)
                    status.text = "Enter a prompt first."
                }
                !verified -> {
                    status.setTextColor(ERROR)
                    status.text = "Prompt not sent: this pane is not the verified writable current pane."
                }
                !uiStreamConnected -> {
                    status.setTextColor(ERROR)
                    status.text = "Prompt not sent: command-result stream is not connected."
                }
                else -> {
                    status.setTextColor(MUTED)
                    status.text = "Sending exact prompt + Enter…"
                    dispatchTrackedCommand(pane, TmuxCommand.sendInput(prompt, enter = true)) { result ->
                        if (!dialog.isShowing) return@dispatchTrackedCommand
                        when (result) {
                            is TmuxCommandState.Pending -> status.text = "Prompt accepted · waiting for completion…"
                            is TmuxCommandState.Succeeded -> {
                                composer.text.clear()
                                status.setTextColor(ONLINE)
                                status.text = "Prompt sent to ${pane.paneId}."
                            }
                            is TmuxCommandState.Failed -> {
                                status.setTextColor(ERROR)
                                status.text = "${result.error.code}: ${result.error.message}"
                            }
                        }
                    }
                }
            }
        }
        root.addView(send, matchWrap())

        fun render() {
            val entries = history[0].filtered(search.text?.toString().orEmpty())
            transcript.text = ClaudeTranscriptFormatter.format(entries)
            older.isEnabled = history[0].hasOlder
            status.setTextColor(MUTED)
            status.text = "${history[0].entries.size} entries loaded · ${entries.size} shown"
        }

        fun load(request: TranscriptRequest) {
            older.isEnabled = false
            status.setTextColor(MUTED)
            status.text = "Loading transcript…"
            val currentApi = api ?: return
            io.execute {
                runCatching { currentApi.loadTranscript(pane.sessionId, request) }
                    .onSuccess { capture -> runOnUiThread {
                        if (!dialog.isShowing) return@runOnUiThread
                        runCatching { history[0] = history[0].withCapture(capture) }
                            .onSuccess { render() }
                            .onFailure {
                                status.setTextColor(ERROR)
                                status.text = it.message ?: "Unable to load Claude transcript"
                                older.isEnabled = true
                            }
                    } }
                    .onFailure { failure -> runOnUiThread {
                        if (!dialog.isShowing) return@runOnUiThread
                        status.setTextColor(ERROR)
                        status.text = failure.message ?: "Unable to load Claude transcript"
                        older.isEnabled = true
                    } }
            }
        }

        older.setOnClickListener {
            history[0].beforeEntry?.takeIf { it > 0 }?.let {
                load(TranscriptRequest(beforeEntry = it))
            }
        }
        search.doAfterTextChanged { render() }
        dialog.showFullScreen()
        load(TranscriptRequest())
    }

    private fun connectUiStream() {
        val currentApi = api ?: return
        if (!started || uiStreamSocket != null || uiStreamConnecting) return
        mainHandler.removeCallbacks(reconnectUiStream)
        val generation = ++uiStreamGeneration
        uiStreamConnecting = true
        uiStreamFailure = null
        io.execute {
            runCatching {
                currentApi.createUiStreamSocket(
                    object : UiStreamSocket.Listener {
                        override fun onConnected() = runOnUiThread {
                            if (generation != uiStreamGeneration) return@runOnUiThread
                            uiStreamConnecting = false
                            uiStreamConnected = true
                            mainHandler.removeCallbacks(reconnectUiStream)
                            updateRosterViews()
                        }

                        override fun onEvent(event: UiStreamEvent) = runOnUiThread {
                            if (generation != uiStreamGeneration) return@runOnUiThread
                            when (event) {
                                is TmuxTopologyEvent -> {
                                    liveTopologies[event.hostId] = event
                                    roster = roster.withTopology(event)
                                    commandTracker.observe(event).forEach(::deliverCommandState)
                                    updateRosterViews()
                                }
                                is CommandResultEvent ->
                                    commandTracker.observe(event)?.let(::deliverCommandState)
                                is SessionsChangedEvent ->
                                    observeCreatedPanePersistence(event)
                            }
                        }

                        override fun onFailure(message: String) = runOnUiThread {
                            handleUiStreamLoss(generation, "COMMAND_STREAM_FAILED", message)
                        }

                        override fun onClosed() = runOnUiThread {
                            handleUiStreamLoss(
                                generation,
                                "COMMAND_STREAM_CLOSED",
                                "Command-result stream closed.",
                            )
                        }
                    },
                )
            }.onSuccess { created -> runOnUiThread {
                if (!started || generation != uiStreamGeneration) {
                    created.close()
                } else {
                    uiStreamSocket = created
                    created.connect()
                }
            } }.onFailure { failure -> runOnUiThread {
                handleUiStreamLoss(
                    generation,
                    "COMMAND_STREAM_CONNECT_FAILED",
                    failure.message ?: "Unable to connect live topology",
                )
            } }
        }
    }

    private fun disconnectUiStream() {
        mainHandler.removeCallbacks(reconnectUiStream)
        uiStreamGeneration += 1
        uiStreamConnecting = false
        uiStreamConnected = false
        uiStreamSocket?.close()
        uiStreamSocket = null
        resetCommandTracking(
            "COMMAND_STREAM_STOPPED",
            "Command-result stream stopped while the app is not in the foreground.",
        )
    }

    private fun handleUiStreamLoss(generation: Long, code: String, message: String) {
        if (generation != uiStreamGeneration) return
        uiStreamGeneration += 1
        uiStreamConnecting = false
        uiStreamConnected = false
        uiStreamFailure = message
        val failedSocket = uiStreamSocket
        uiStreamSocket = null
        failedSocket?.close()
        resetCommandTracking(code, message)
        updateRosterViews()
        scheduleUiStreamReconnect()
    }

    private fun scheduleUiStreamReconnect() {
        mainHandler.removeCallbacks(reconnectUiStream)
        if (started && api != null) {
            mainHandler.postDelayed(reconnectUiStream, UI_STREAM_RECONNECT_DELAY_MS)
        }
    }

    private fun updateRosterViews() {
        rosterView?.update(roster, activePane?.paneId)
        navigatorView?.update(roster, activePane?.paneId)
        renderRoster(topology)
    }

    private fun dispatchTrackedCommand(
        pane: TmuxPane,
        command: TmuxCommand,
        expectation: TopologyExpectation? = null,
        callback: (TmuxCommandState) -> Unit,
    ) {
        if (!started || !uiStreamConnected) {
            callback(
                TmuxCommandState.Failed(
                    "not-dispatched",
                    com.heaviside.agentcommand.data.ApiError(
                        "COMMAND_STREAM_UNAVAILABLE",
                        "Command-result stream is not connected.",
                    ),
                ),
            )
            return
        }
        val commandStreamGeneration = uiStreamGeneration
        val currentApi = api ?: return callback(
            TmuxCommandState.Failed(
                cmdId = "not-dispatched",
                error = com.heaviside.agentcommand.data.ApiError("NOT_AUTHENTICATED", "Sign in again."),
            ),
        )
        io.execute {
            runCatching { currentApi.dispatchTmuxCommand(pane.sessionId, command) }
                .onSuccess { acceptance -> runOnUiThread {
                    if (
                        !started ||
                        !uiStreamConnected ||
                        commandStreamGeneration != uiStreamGeneration
                    ) {
                        callback(
                            TmuxCommandState.Failed(
                                acceptance.cmdId,
                                com.heaviside.agentcommand.data.ApiError(
                                    "COMMAND_STREAM_UNAVAILABLE",
                                    "Command was accepted after its result stream stopped.",
                                ),
                            ),
                        )
                        return@runOnUiThread
                    }
                    val state = commandTracker.register(
                        acceptance,
                        pane.hostId,
                        pane.sessionId,
                        expectation,
                    )
                    if (state is TmuxCommandState.Pending) {
                        commandCallbacks[state.cmdId] = callback
                    }
                    callback(state)
                } }
                .onFailure { failure -> runOnUiThread {
                    callback(
                        TmuxCommandState.Failed(
                            cmdId = "not-dispatched",
                            error = com.heaviside.agentcommand.data.ApiError(
                                "COMMAND_DISPATCH_FAILED",
                                failure.message ?: "Unable to dispatch tmux command",
                            ),
                        ),
                    )
                } }
        }
    }

    private fun deliverCommandState(state: TmuxCommandState) {
        commandCallbacks.remove(state.cmdId)?.invoke(state)
    }

    private fun resetCommandTracking(code: String, message: String) {
        val error = com.heaviside.agentcommand.data.ApiError(code, message)
        val trackerFailures = commandTracker.failPending(error).associateBy { it.cmdId }
        val callbacks = commandCallbacks.toMap()
        commandCallbacks.clear()
        callbacks.forEach { (cmdId, callback) ->
            callback(trackerFailures[cmdId] ?: TmuxCommandState.Failed(cmdId, error))
        }
    }

    private fun loadTerminalRosterIfNeeded() {
        if (topology != null) return
        val currentApi = api ?: return
        io.execute {
            runCatching { currentApi.loadTopology() }
                .onSuccess { loaded -> runOnUiThread {
                    acceptLoadedTopology(loaded)
                    updateRosterViews()
                } }
                .onFailure { failure -> runOnUiThread {
                    uiStreamFailure = failure.message ?: "Unable to load tmux navigator"
                    updateRosterViews()
                } }
        }
    }

    private fun acceptLoadedTopology(loaded: Topology) {
        topology = loaded
        roster = liveTopologies.values
            .sortedBy { it.hostId }
            .fold(TmuxRoster.from(loaded)) { current, event -> current.withTopology(event) }
    }

    private fun connectTerminal() {
        val pane = activePane ?: return
        val currentApi = api ?: return showSignIn("Sign in again.")
        if (terminalSocket != null) return
        val generation = ++connectionGeneration
        val tokenForPane = resumeToken.takeIf { resumeSessionId == pane.sessionId }
        terminalStatus?.text = when {
            reconnecting -> "Reconnecting…"
            tokenForPane == null -> "Connecting…"
            else -> "Resuming…"
        }
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
            reconnecting = false
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
                        reconnecting = true
                        terminalStatus?.text = "Reconnecting · saved terminal resume expired"
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
                    workbenchNavigation.confirm(resolution.target)?.let { adopted ->
                        activePane = adopted
                        // The current socket was issued for the previous backend session. Its resume token
                        // cannot be replayed against the newly adopted pane's fresh-attachment endpoint.
                        resumeToken = null
                        resumeSessionId = null
                        terminalTitle?.text = terminalTitle(adopted)
                        claudeButton?.visibility =
                            if (ClaudePaneVisibility.isVisible(adopted)) View.VISIBLE else View.GONE
                        navigatorView?.update(roster, adopted.paneId)
                    }
                    activePane?.takeIf { it.paneId == resolution.target.paneId }?.let(::rememberValidatedTarget)
                    zoomButton?.text = if (tmuxZoomed) "Unzoom pane" else "Zoom pane"
                    syncInteractionUi()
                    terminalView?.requestFocus()
                    if (pendingLifecycleViewerTarget == resolution.target) {
                        val success = pendingLifecycleSuccess ?: "Succeeded · tmux viewer updated."
                        cancelCreatedPaneAdoptionTimeout()
                        createdPaneAdoption.clear()
                        pendingLifecycleViewerTarget = null
                        pendingLifecycleSuccess = null
                        reconcileRosterAfterMutation(success, ONLINE)
                    }
                }
                is ViewerResolution.Failed -> {
                    cancelNavigationTimeout()
                    syncInteractionUi(resolution.message)
                    failLifecycleViewerOperation(
                        resolution.message,
                        reconcileRoster = true,
                    )
                }
            }
        }

        override fun onFailure(message: String) = runOnUiThread {
            if (isCurrentConnection(generation, sessionId)) handleTerminalFailure(message)
        }
    }

    private fun isCurrentConnection(generation: Long, sessionId: String): Boolean =
        started && screen == Screen.TERMINAL && connectionGeneration == generation

    private fun requestPaneFocus(zoom: Boolean) {
        val pane = activePane ?: return
        requestViewerFocus(ViewerTarget(pane.paneId, zoom))
    }

    private fun requestViewerFocus(expected: ViewerTarget): Boolean {
        val socket = terminalSocket ?: return false
        if (viewerAuthority.hasPendingNavigation) return false
        val requestId = socket.focusPane(expected.paneId, expected.zoomed)
        if (requestId == null) {
            handleTerminalFailure("Pane focus request could not be sent")
            return false
        }
        viewerAuthority.beginFocus(requestId, expected)
        syncInteractionUi(
            if (workbenchNavigation.candidatePane != null) {
                "Switching · confirming ${expected.paneId}…"
            } else if (expected.zoomed) {
                "Switching · confirming pane zoom…"
            } else {
                "Switching · confirming pane focus…"
            },
        )
        scheduleNavigationTimeout { reconcileTimedOutFocus(requestId) }
        return true
    }

    private fun reconcileTimedOutFocus(focusRequestId: String) {
        val socket = terminalSocket ?: return
        val viewerStateRequestId = socket.viewerState()
        if (viewerStateRequestId == null) {
            val resolution = viewerAuthority.failPending(
                focusRequestId,
                "Pane focus timed out and terminal viewer state could not be requested.",
            )
            if (resolution is ViewerResolution.Failed) {
                syncInteractionUi(resolution.message)
                failLifecycleViewerOperation(
                    resolution.message,
                    reconcileRoster = true,
                )
            }
            return
        }
        if (!viewerAuthority.beginViewerStateReconciliation(focusRequestId, viewerStateRequestId)) return
        syncInteractionUi("Reconciling · pane focus result timed out · checking viewer state…")
        scheduleNavigationTimeout {
            val resolution = viewerAuthority.failPending(
                viewerStateRequestId,
                "Pane focus timed out and viewer state could not be confirmed.",
            )
            if (resolution is ViewerResolution.Failed) {
                syncInteractionUi(resolution.message)
                failLifecycleViewerOperation(
                    resolution.message,
                    reconcileRoster = true,
                )
            }
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
        failLifecycleViewerOperation(message)
        disconnectTerminal()
        viewerAuthority.failed()
        reconnecting = true
        syncInteractionUi("Failed · $message · reconnecting")
        if (started && screen == Screen.TERMINAL) mainHandler.postDelayed(reconnect, RECONNECT_DELAY_MS)
    }

    private fun failLifecycleViewerOperation(
        message: String,
        reconcileRoster: Boolean = false,
    ) {
        val hadLifecycleOperation =
            pendingLifecycleViewerTarget != null ||
                pendingLifecycleSuccess != null
        cancelCreatedPaneAdoptionTimeout()
        createdPaneAdoption.clear()
        pendingLifecycleViewerTarget = null
        pendingLifecycleSuccess = null
        workbenchNavigation.rejectCandidate()
        if (hadLifecycleOperation) {
            setLifecyclePending(false)
            val status = "Failed · $message"
            setLifecycleStatus(status, ERROR)
            if (reconcileRoster) {
                reconcileRosterAfterMutation(status, ERROR)
            }
        }
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

    private fun rememberValidatedTarget(pane: TmuxPane) {
        if (pane.target.isBlank()) return
        preferences = LastTargetPreference.remember(
            preferences,
            pane,
            System.currentTimeMillis(),
        )
        savePreferences()
    }

    private fun savePreferences() {
        preferenceStore.save(preferences)
    }

    private fun terminalTitle(pane: TmuxPane): String =
        "${pane.hostName} · ${pane.target.ifBlank { pane.paneId }}"

    private fun selectableMonospaceText() = TextView(this).apply {
        setTextColor(Color.WHITE)
        textSize = 14f
        typeface = Typeface.MONOSPACE
        setTextIsSelectable(true)
        setPadding(dp(8), dp(8), dp(8), dp(16))
    }

    private fun fullScreenDialog(content: View): Dialog = Dialog(this).apply {
        requestWindowFeature(Window.FEATURE_NO_TITLE)
        setContentView(content)
    }

    private fun Dialog.showFullScreen() {
        show()
        window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    }

    private fun copyText(label: String, value: String) {
        getSystemService(ClipboardManager::class.java)
            .setPrimaryClip(ClipData.newPlainText(label, value))
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
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
        const val UI_STREAM_RECONNECT_DELAY_MS = 1_500L
        const val CREATED_PANE_ADOPTION_TIMEOUT_MS = 10_000L
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
        val ONLINE = Color.rgb(74, 222, 128)
        const val DEFAULT_TMUX_PREFIX = "C-b"
    }
}
