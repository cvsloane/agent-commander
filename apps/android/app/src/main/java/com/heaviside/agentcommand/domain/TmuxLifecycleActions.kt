/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.Host
import com.heaviside.agentcommand.data.SessionsChangedEvent
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

sealed interface CreatedPaneAdoptionAction {
    data object Ignore : CreatedPaneAdoptionAction

    data class WaitForPersistence(
        val hostId: String,
        val paneId: String,
    ) : CreatedPaneAdoptionAction

    data class RefreshRoster(
        val hostId: String,
        val paneId: String,
    ) : CreatedPaneAdoptionAction

    data class OpenPane(val pane: TmuxPane) : CreatedPaneAdoptionAction
    data class FocusPane(val pane: TmuxPane) : CreatedPaneAdoptionAction
    data class Failed(val message: String) : CreatedPaneAdoptionAction
}

class CreatedPaneAdoptionState {
    private enum class Phase {
        WAITING_FOR_PERSISTENCE,
        REFRESHING_ROSTER,
        OPENING_PANE,
        FOCUSING_PANE,
    }

    private data class Pending(
        val hostId: String,
        val paneId: String,
        val tmuxSessionName: String,
        val phase: Phase,
        val persistedSessionId: String? = null,
    )

    private var pending: Pending? = null

    val isPending: Boolean
        get() = pending != null

    fun begin(
        hostId: String,
        paneId: String,
        tmuxSessionName: String,
    ): CreatedPaneAdoptionAction {
        check(pending == null) { "A created pane adoption is already pending" }
        pending = Pending(
            hostId = hostId,
            paneId = paneId,
            tmuxSessionName = tmuxSessionName,
            phase = Phase.WAITING_FOR_PERSISTENCE,
        )
        return CreatedPaneAdoptionAction.WaitForPersistence(hostId, paneId)
    }

    fun observe(event: SessionsChangedEvent): CreatedPaneAdoptionAction {
        val current = pending ?: return CreatedPaneAdoptionAction.Ignore
        if (current.phase != Phase.WAITING_FOR_PERSISTENCE) {
            return CreatedPaneAdoptionAction.Ignore
        }
        val changedPane = event.find(current.hostId, current.paneId)
            ?: return CreatedPaneAdoptionAction.Ignore
        pending = current.copy(
            phase = Phase.REFRESHING_ROSTER,
            persistedSessionId = changedPane.sessionId,
        )
        return CreatedPaneAdoptionAction.RefreshRoster(current.hostId, current.paneId)
    }

    fun resolveRoster(roster: TmuxRoster): CreatedPaneAdoptionAction {
        val current = pending ?: return CreatedPaneAdoptionAction.Ignore
        if (current.phase != Phase.REFRESHING_ROSTER) {
            return CreatedPaneAdoptionAction.Ignore
        }
        val pane = roster.findPane(current.hostId, current.paneId)
            ?: return fail("Created pane ${current.paneId} was absent from the durable roster.")
        if (pane.sessionId != current.persistedSessionId) {
            return fail("Created pane ${current.paneId} resolved to the wrong durable session.")
        }
        if (pane.tmuxSessionName != current.tmuxSessionName || pane.target.isBlank()) {
            return fail("Created pane ${current.paneId} resolved to the wrong tmux anchor.")
        }
        pending = current.copy(
            phase = if (pane.unmanaged == true) Phase.OPENING_PANE else Phase.FOCUSING_PANE,
        )
        return if (pane.unmanaged == true) {
            CreatedPaneAdoptionAction.OpenPane(pane)
        } else {
            CreatedPaneAdoptionAction.FocusPane(pane)
        }
    }

    fun resolveOpen(opened: TmuxOpenResult): CreatedPaneAdoptionAction {
        val current = pending ?: return CreatedPaneAdoptionAction.Ignore
        if (current.phase != Phase.OPENING_PANE) {
            return CreatedPaneAdoptionAction.Ignore
        }
        val anchor = CreatedPaneAnchor.resolve(current.hostId, current.paneId, opened)
        if (anchor is CreatedPaneAnchor.Failed) return fail(anchor.message)
        val pane = (anchor as CreatedPaneAnchor.Ready).pane
        if (
            pane.sessionId != current.persistedSessionId ||
            pane.tmuxSessionName != current.tmuxSessionName ||
            pane.unmanaged == true
        ) {
            return fail("Created pane ${current.paneId} opened with the wrong durable anchor.")
        }
        pending = current.copy(phase = Phase.FOCUSING_PANE)
        return CreatedPaneAdoptionAction.FocusPane(pane)
    }

    fun timeout(): CreatedPaneAdoptionAction {
        val current = pending ?: return CreatedPaneAdoptionAction.Ignore
        return fail(
            "Created pane ${current.paneId} was not durably available before the adoption timeout.",
        )
    }

    private fun fail(message: String): CreatedPaneAdoptionAction.Failed {
        pending = null
        return CreatedPaneAdoptionAction.Failed(message)
    }

    fun complete() {
        pending = null
    }
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
