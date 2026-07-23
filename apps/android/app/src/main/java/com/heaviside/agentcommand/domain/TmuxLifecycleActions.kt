/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.Host
import com.heaviside.agentcommand.data.TmuxCommand
import com.heaviside.agentcommand.data.TmuxOpenResult
import com.heaviside.agentcommand.data.TmuxPane
import com.heaviside.agentcommand.terminal.ViewerTarget
import org.json.JSONObject

enum class LifecycleCompletion {
    TOPOLOGY_OR_RESULT,
    EXACT_RESULT,
}

sealed interface LifecycleTransport {
    data class ViewerFocus(val target: ViewerTarget) : LifecycleTransport

    data class RestCommand(
        val command: TmuxCommand,
        val expectation: TopologyExpectation?,
        val completion: LifecycleCompletion,
    ) : LifecycleTransport

    data class BulkTerminate(val sessionId: String) : LifecycleTransport
}

sealed interface LifecycleAction {
    data class SelectWindow(
        val sessionName: String,
        val windowIndex: Int,
        val paneId: String?,
        val preserveZoom: Boolean,
    ) : LifecycleAction

    data class RenameWindow(
        val sessionName: String,
        val windowIndex: Int,
        val name: String,
    ) : LifecycleAction

    data class CloseWindow(
        val sessionName: String,
        val windowIndex: Int,
    ) : LifecycleAction

    data class NewWindow(val cwd: String? = null) : LifecycleAction

    data class SplitPane(
        val direction: PaneSplitDirection,
        val cwd: String? = null,
        val supportsPercent: Boolean,
    ) : LifecycleAction

    data class SelectPane(
        val paneId: String,
        val preserveZoom: Boolean,
    ) : LifecycleAction

    data class SetPaneFocus(
        val paneId: String,
        val focused: Boolean,
    ) : LifecycleAction

    data class TerminatePane(val sessionId: String) : LifecycleAction
}

enum class PaneSplitDirection(val wireValue: String) {
    HORIZONTAL("horizontal"),
    VERTICAL("vertical"),
}

object TmuxLifecycleActions {
    fun plan(action: LifecycleAction): LifecycleTransport = when (action) {
        is LifecycleAction.SelectWindow -> action.paneId?.let {
            LifecycleTransport.ViewerFocus(ViewerTarget(it, action.preserveZoom))
        } ?: LifecycleTransport.RestCommand(
            command = TmuxCommand(
                "select_window",
                JSONObject().put("window_index", action.windowIndex),
            ),
            expectation = TopologyExpectation.ActiveWindow(
                action.sessionName,
                action.windowIndex,
            ),
            completion = LifecycleCompletion.TOPOLOGY_OR_RESULT,
        )
        is LifecycleAction.RenameWindow -> LifecycleTransport.RestCommand(
            command = TmuxCommand(
                "rename_window",
                JSONObject()
                    .put("window_index", action.windowIndex)
                    .put("name", action.name),
            ),
            expectation = TopologyExpectation.WindowPresent(
                action.sessionName,
                action.windowIndex,
                action.name,
            ),
            completion = LifecycleCompletion.TOPOLOGY_OR_RESULT,
        )
        is LifecycleAction.CloseWindow -> LifecycleTransport.RestCommand(
            command = TmuxCommand(
                "kill_window",
                JSONObject().put("window_index", action.windowIndex),
            ),
            expectation = TopologyExpectation.WindowAbsent(
                action.sessionName,
                action.windowIndex,
            ),
            completion = LifecycleCompletion.TOPOLOGY_OR_RESULT,
        )
        is LifecycleAction.NewWindow -> LifecycleTransport.RestCommand(
            command = TmuxCommand(
                "new_window",
                JSONObject().apply {
                    action.cwd?.takeIf { it.isNotBlank() }?.let { put("cwd", it) }
                },
            ),
            expectation = null,
            completion = LifecycleCompletion.EXACT_RESULT,
        )
        is LifecycleAction.SplitPane -> LifecycleTransport.RestCommand(
            command = TmuxCommand(
                "split_pane",
                JSONObject()
                    .put("direction", action.direction.wireValue)
                    .apply {
                        if (action.supportsPercent) put("percent", 50)
                        action.cwd?.takeIf { it.isNotBlank() }?.let { put("cwd", it) }
                    },
            ),
            expectation = null,
            completion = LifecycleCompletion.EXACT_RESULT,
        )
        is LifecycleAction.SelectPane -> LifecycleTransport.ViewerFocus(
            ViewerTarget(action.paneId, action.preserveZoom),
        )
        is LifecycleAction.SetPaneFocus -> LifecycleTransport.ViewerFocus(
            ViewerTarget(action.paneId, action.focused),
        )
        is LifecycleAction.TerminatePane -> LifecycleTransport.BulkTerminate(action.sessionId)
    }
}

object TmuxLifecycleConfirmation {
    fun closeWindow(windowIndex: Int, liveWindowCount: Int?): String =
        if (liveWindowCount == 1) {
            "Close window $windowIndex? This ends the whole tmux session."
        } else {
            "Close window $windowIndex?"
        }

    fun terminatePane(paneId: String): String =
        "Terminate pane $paneId? This kills the pane and archives its tracked session."
}

fun hostSupportsPercentSplits(host: Host?): Boolean {
    val version = host?.capabilities?.tmuxVersion ?: return false
    val match = Regex("(\\d+)\\.(\\d+)").find(version) ?: return false
    val major = match.groupValues[1].toIntOrNull() ?: return false
    val minor = match.groupValues[2].toIntOrNull() ?: return false
    return major > 3 || major == 3 && minor >= 1
}

sealed interface CreatedPaneAnchor {
    data class Ready(val pane: TmuxPane) : CreatedPaneAnchor
    data class Failed(val message: String) : CreatedPaneAnchor

    companion object {
        fun resolve(
            expectedHostId: String,
            expectedPaneId: String,
            opened: TmuxOpenResult,
        ): CreatedPaneAnchor {
            if (!opened.terminalOpenable) {
                return Failed("Created pane $expectedPaneId is not terminal-openable.")
            }
            if (opened.terminalPaneId != expectedPaneId) {
                return Failed(
                    "Opened pane ${opened.terminalPaneId ?: "none"} instead of created pane $expectedPaneId.",
                )
            }
            if (opened.pane.paneId != expectedPaneId) {
                return Failed(
                    "Adopted pane ${opened.pane.paneId} instead of created pane $expectedPaneId.",
                )
            }
            if (opened.pane.hostId != expectedHostId) {
                return Failed("Created pane $expectedPaneId opened on the wrong host.")
            }
            if (opened.sessionId != opened.pane.sessionId || opened.pane.target.isBlank()) {
                return Failed("Created pane $expectedPaneId did not return a durable command anchor.")
            }
            return Ready(opened.pane)
        }
    }
}
