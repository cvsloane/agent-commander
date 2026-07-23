/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.ApiError
import com.heaviside.agentcommand.data.CommandDispatchAcceptance
import com.heaviside.agentcommand.data.CommandResultEvent
import com.heaviside.agentcommand.data.TmuxTopologyEvent
import com.heaviside.agentcommand.data.TmuxTopologySession
import com.heaviside.agentcommand.data.TmuxTopologyWindow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TmuxCommandTrackerTest {
    @Test
    fun `REST acceptance remains pending until the correlated command result arrives`() {
        val tracker = TmuxCommandTracker()
        val pending = tracker.register(
            acceptance = CommandDispatchAcceptance("cmd-select"),
            hostId = "host-a",
            sessionId = "session-a",
        )

        assertTrue(pending is TmuxCommandState.Pending)
        assertEquals(
            TmuxCommandState.Succeeded(
                cmdId = "cmd-select",
                source = TmuxCommandTruth.COMMAND_RESULT,
            ),
            tracker.observe(
                CommandResultEvent(
                    timestamp = "2026-07-23T12:00:00Z",
                    hostId = "host-a",
                    cmdId = "cmd-select",
                    sessionId = "session-a",
                    ok = true,
                ),
            ),
        )
    }

    @Test
    fun `correlated command failures retain the exact agent error`() {
        val tracker = TmuxCommandTracker()
        tracker.register(CommandDispatchAcceptance("cmd-fail"), "host-a", "session-a")

        val result = tracker.observe(
            CommandResultEvent(
                timestamp = "2026-07-23T12:00:00Z",
                hostId = "host-a",
                cmdId = "cmd-fail",
                sessionId = "session-a",
                ok = false,
                error = ApiError("TMUX_COMMAND_FAILED", "can't find window: 2"),
            ),
        )

        assertEquals(
            TmuxCommandState.Failed(
                cmdId = "cmd-fail",
                error = ApiError("TMUX_COMMAND_FAILED", "can't find window: 2"),
            ),
            result,
        )
    }

    @Test
    fun `successful exact results retain the created pane identity`() {
        val tracker = TmuxCommandTracker()
        tracker.register(CommandDispatchAcceptance("cmd-split"), "host-a", "session-a")

        val result = tracker.observe(
            CommandResultEvent(
                timestamp = "2026-07-23T12:00:00Z",
                hostId = "host-a",
                cmdId = "cmd-split",
                sessionId = "session-a",
                ok = true,
                resultJson = """{"pane_id":"%42","tmux_target":"vault:2.1"}""",
            ),
        ) as TmuxCommandState.Succeeded

        assertEquals("""{"pane_id":"%42","tmux_target":"vault:2.1"}""", result.resultJson)
    }

    @Test
    fun `a result that beats REST registration is still correlated`() {
        val tracker = TmuxCommandTracker()
        tracker.observe(
            CommandResultEvent(
                timestamp = "2026-07-23T12:00:00Z",
                hostId = "host-a",
                cmdId = "cmd-fast",
                sessionId = "session-a",
                ok = true,
            ),
        )

        val result = tracker.register(
            CommandDispatchAcceptance("cmd-fast"),
            hostId = "host-a",
            sessionId = "session-a",
        )

        assertEquals(TmuxCommandState.Succeeded("cmd-fast", TmuxCommandTruth.COMMAND_RESULT), result)
        assertTrue(tracker.pendingCommands().isEmpty())
    }

    @Test
    fun `authoritative topology can complete a pending command expectation`() {
        val tracker = TmuxCommandTracker()
        tracker.register(
            CommandDispatchAcceptance("cmd-window"),
            hostId = "host-a",
            sessionId = "session-a",
            expectation = TopologyExpectation.ActiveWindow("vault", 2),
        )

        val result = tracker.observe(
            TmuxTopologyEvent(
                timestamp = "2026-07-23T12:00:00Z",
                hostId = "host-a",
                reason = "hook:window-linked",
                sessions = listOf(
                    TmuxTopologySession(
                        name = "vault",
                        attached = true,
                        attachedClients = 1,
                        windows = listOf(
                            TmuxTopologyWindow(
                                index = 2,
                                name = "review",
                                active = true,
                                zoomed = false,
                                layout = "layout",
                                bell = false,
                                activity = true,
                                panes = emptyList(),
                            ),
                        ),
                    ),
                ),
            ),
        )

        assertEquals(
            listOf(TmuxCommandState.Succeeded("cmd-window", TmuxCommandTruth.TOPOLOGY)),
            result,
        )
        assertTrue(tracker.pendingCommands().isEmpty())
    }

    @Test
    fun `stream loss fails pending commands and clears pending plus early result state`() {
        val tracker = TmuxCommandTracker()
        tracker.register(CommandDispatchAcceptance("cmd-pending"), "host-a", "session-a")
        tracker.observe(
            CommandResultEvent(
                timestamp = "2026-07-23T12:00:00Z",
                hostId = "host-a",
                cmdId = "cmd-early",
                sessionId = "session-a",
                ok = true,
            ),
        )
        val streamError = ApiError("COMMAND_STREAM_FAILED", "event stream failed")

        assertEquals(
            listOf(TmuxCommandState.Failed("cmd-pending", streamError)),
            tracker.failPending(streamError),
        )
        assertTrue(tracker.pendingCommands().isEmpty())
        assertTrue(
            tracker.register(
                CommandDispatchAcceptance("cmd-early"),
                "host-a",
                "session-a",
            ) is TmuxCommandState.Pending,
        )
    }
}
