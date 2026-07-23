/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.Host
import com.heaviside.agentcommand.data.HostCapabilities
import com.heaviside.agentcommand.data.ChangedTmuxPane
import com.heaviside.agentcommand.data.SessionsChangedEvent
import com.heaviside.agentcommand.data.TmuxOpenResult
import com.heaviside.agentcommand.data.TmuxPane
import com.heaviside.agentcommand.data.Topology
import com.heaviside.agentcommand.terminal.ViewerTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TmuxLifecycleActionsTest {
    @Test
    fun `window selection uses explicit viewer focus and only falls back when no pane exists`() {
        assertEquals(
            LifecycleTransport.ViewerFocus(ViewerTarget("%7", zoomed = true)),
            TmuxLifecycleActions.plan(
                LifecycleAction.SelectWindow(
                    sessionName = "vault",
                    windowIndex = 2,
                    paneId = "%7",
                    preserveZoom = true,
                ),
            ),
        )

        val fallback = TmuxLifecycleActions.plan(
            LifecycleAction.SelectWindow(
                sessionName = "vault",
                windowIndex = 3,
                paneId = null,
                preserveZoom = false,
            ),
        ) as LifecycleTransport.RestCommand
        assertEquals("select_window", fallback.command.type)
        assertEquals(3, fallback.command.payload.getInt("window_index"))
        assertEquals(TopologyExpectation.ActiveWindow("vault", 3), fallback.expectation)
        assertEquals(LifecycleCompletion.TOPOLOGY_OR_RESULT, fallback.completion)
    }

    @Test
    fun `window and split mutations use schema JSON with the required completion truth`() {
        val rename = TmuxLifecycleActions.plan(
            LifecycleAction.RenameWindow("vault", 2, "review"),
        ) as LifecycleTransport.RestCommand
        assertEquals("rename_window", rename.command.type)
        assertEquals(2, rename.command.payload.getInt("window_index"))
        assertEquals("review", rename.command.payload.getString("name"))
        assertEquals(TopologyExpectation.WindowPresent("vault", 2, "review"), rename.expectation)
        assertEquals(LifecycleCompletion.TOPOLOGY_OR_RESULT, rename.completion)

        val close = TmuxLifecycleActions.plan(
            LifecycleAction.CloseWindow("vault", 2),
        ) as LifecycleTransport.RestCommand
        assertEquals("kill_window", close.command.type)
        assertEquals(TopologyExpectation.WindowAbsent("vault", 2), close.expectation)

        val newWindow = TmuxLifecycleActions.plan(
            LifecycleAction.NewWindow("/work/agent-command"),
        ) as LifecycleTransport.RestCommand
        assertEquals("new_window", newWindow.command.type)
        assertEquals("/work/agent-command", newWindow.command.payload.getString("cwd"))
        assertNull(newWindow.expectation)
        assertEquals(LifecycleCompletion.EXACT_RESULT, newWindow.completion)

        val split = TmuxLifecycleActions.plan(
            LifecycleAction.SplitPane(
                direction = PaneSplitDirection.HORIZONTAL,
                cwd = "/work/agent-command",
                supportsPercent = true,
            ),
        ) as LifecycleTransport.RestCommand
        assertEquals("split_pane", split.command.type)
        assertEquals("horizontal", split.command.payload.getString("direction"))
        assertEquals(50, split.command.payload.getInt("percent"))
        assertEquals("/work/agent-command", split.command.payload.getString("cwd"))
        assertNull(split.expectation)
        assertEquals(LifecycleCompletion.EXACT_RESULT, split.completion)
    }

    @Test
    fun `pane navigation and focus are explicit viewer operations while terminate is dedicated`() {
        assertEquals(
            LifecycleTransport.ViewerFocus(ViewerTarget("%8", zoomed = true)),
            TmuxLifecycleActions.plan(
                LifecycleAction.SelectPane("%8", preserveZoom = true),
            ),
        )
        assertEquals(
            LifecycleTransport.ViewerFocus(ViewerTarget("%8", zoomed = true)),
            TmuxLifecycleActions.plan(
                LifecycleAction.SetPaneFocus("%8", focused = true),
            ),
        )
        assertEquals(
            LifecycleTransport.ViewerFocus(ViewerTarget("%8", zoomed = false)),
            TmuxLifecycleActions.plan(
                LifecycleAction.SetPaneFocus("%8", focused = false),
            ),
        )
        assertEquals(
            LifecycleTransport.BulkTerminate("tracked-session"),
            TmuxLifecycleActions.plan(LifecycleAction.TerminatePane("tracked-session")),
        )
    }

    @Test
    fun `confirmation and capability policy is exact and conservative`() {
        assertEquals(
            "Close window 2? This ends the whole tmux session.",
            TmuxLifecycleConfirmation.closeWindow(windowIndex = 2, liveWindowCount = 1),
        )
        assertEquals(
            "Close window 2?",
            TmuxLifecycleConfirmation.closeWindow(windowIndex = 2, liveWindowCount = null),
        )
        assertEquals(
            "Terminate pane %7? This kills the pane and archives its tracked session.",
            TmuxLifecycleConfirmation.terminatePane("%7"),
        )

        assertTrue(
            hostSupportsPercentSplits(
                Host("host-a", "Alpha", capabilities = HostCapabilities(tmuxVersion = "tmux 3.4")),
            ),
        )
        assertFalse(
            hostSupportsPercentSplits(
                Host("host-a", "Alpha", capabilities = HostCapabilities(tmuxVersion = "tmux 3.0a")),
            ),
        )
        assertFalse(hostSupportsPercentSplits(Host("host-a", "Alpha")))
    }

    @Test
    fun `created pane requires an exact durable open anchor before viewer focus`() {
        val pane = TmuxPane(
            sessionId = "created-session",
            hostId = "host-a",
            hostName = "Alpha",
            title = "Created",
            status = "RUNNING",
            provider = "shell",
            paneId = "%42",
            target = "vault:2.1",
            tmuxSessionName = "vault",
            windowName = "new",
            windowIndex = 2,
            paneIndex = 1,
        )
        val opened = TmuxOpenResult(
            sessionId = pane.sessionId,
            href = "/?session_id=created-session",
            pane = pane,
            adopted = true,
            terminalOpenable = true,
            terminalPaneId = pane.paneId,
        )

        assertEquals(
            CreatedPaneAnchor.Ready(pane),
            CreatedPaneAnchor.resolve("host-a", "%42", opened),
        )
        assertEquals(
            CreatedPaneAnchor.Failed("Opened pane %41 instead of created pane %42."),
            CreatedPaneAnchor.resolve(
                "host-a",
                "%42",
                opened.copy(terminalPaneId = "%41"),
            ),
        )
    }

    @Test
    fun `created pane waits for its exact persistence event before durable adoption`() {
        val adoption = CreatedPaneAdoptionState()
        assertEquals(
            CreatedPaneAdoptionAction.WaitForPersistence("host-a", "%42"),
            adoption.begin("host-a", "%42", "vault"),
        )
        assertTrue(adoption.isPending)

        assertEquals(
            CreatedPaneAdoptionAction.Ignore,
            adoption.observe(
                SessionsChangedEvent(
                    timestamp = "2026-07-23T12:00:00Z",
                    tmuxPanes = listOf(ChangedTmuxPane("other", "host-a", "%41")),
                    truncated = false,
                ),
            ),
        )
        assertEquals(
            CreatedPaneAdoptionAction.RefreshRoster("host-a", "%42"),
            adoption.observe(
                SessionsChangedEvent(
                    timestamp = "2026-07-23T12:00:01Z",
                    tmuxPanes = listOf(ChangedTmuxPane("created-session", "host-a", "%42")),
                    truncated = false,
                ),
            ),
        )

        val unmanaged = TmuxPane(
            sessionId = "created-session",
            hostId = "host-a",
            hostName = "Alpha",
            title = "Created",
            status = "RUNNING",
            provider = "shell",
            paneId = "%42",
            target = "vault:2.1",
            tmuxSessionName = "vault",
            windowName = "new",
            windowIndex = 2,
            paneIndex = 1,
            unmanaged = true,
        )
        val roster = TmuxRoster.from(
            Topology(listOf(Host("host-a", "Alpha")), listOf(unmanaged)),
        )
        assertEquals(
            CreatedPaneAdoptionAction.OpenPane(unmanaged),
            adoption.resolveRoster(roster),
        )

        val adopted = unmanaged.copy(unmanaged = false)
        assertEquals(
            CreatedPaneAdoptionAction.FocusPane(adopted),
            adoption.resolveOpen(
                TmuxOpenResult(
                    sessionId = adopted.sessionId,
                    href = "/?session_id=created-session",
                    pane = adopted,
                    adopted = true,
                    terminalOpenable = true,
                    terminalPaneId = adopted.paneId,
                ),
            ),
        )
        assertTrue(adoption.isPending)
        adoption.complete()
        assertFalse(adoption.isPending)
    }

    @Test
    fun `created pane consumes an exact persistence event that arrived before command result`() {
        val adoption = CreatedPaneAdoptionState()
        assertEquals(
            CreatedPaneAdoptionAction.Ignore,
            adoption.observe(
                SessionsChangedEvent(
                    timestamp = "2026-07-23T12:00:00Z",
                    tmuxPanes = listOf(
                        ChangedTmuxPane("created-session", "host-a", "%42"),
                    ),
                    truncated = false,
                ),
            ),
        )

        assertEquals(
            CreatedPaneAdoptionAction.RefreshRoster("host-a", "%42"),
            adoption.begin("host-a", "%42", "vault"),
        )
        assertTrue(adoption.isPending)
    }

    @Test
    fun `created pane early persistence retention is bounded and cleared on teardown`() {
        fun remember(state: CreatedPaneAdoptionState, index: Int) {
            state.observe(
                SessionsChangedEvent(
                    timestamp = "2026-07-23T12:00:${index.toString().padStart(2, '0')}Z",
                    tmuxPanes = listOf(
                        ChangedTmuxPane("session-$index", "host-$index", "%$index"),
                    ),
                    truncated = false,
                ),
            )
        }

        val evicted = CreatedPaneAdoptionState()
        repeat(129) { remember(evicted, it) }
        assertEquals(
            CreatedPaneAdoptionAction.WaitForPersistence("host-0", "%0"),
            evicted.begin("host-0", "%0", "vault"),
        )

        val retained = CreatedPaneAdoptionState()
        repeat(129) { remember(retained, it) }
        assertEquals(
            CreatedPaneAdoptionAction.RefreshRoster("host-128", "%128"),
            retained.begin("host-128", "%128", "vault"),
        )

        val cleared = CreatedPaneAdoptionState()
        remember(cleared, 42)
        cleared.clear()
        cleared.clear()
        assertFalse(cleared.isPending)
        assertEquals(
            CreatedPaneAdoptionAction.WaitForPersistence("host-42", "%42"),
            cleared.begin("host-42", "%42", "vault"),
        )
    }

    @Test
    fun `created pane persistence timeout fails and releases its adoption lock`() {
        val adoption = CreatedPaneAdoptionState()
        adoption.begin("host-a", "%42", "vault")

        assertEquals(
            CreatedPaneAdoptionAction.Failed(
                "Created pane %42 was not durably available before the adoption timeout.",
            ),
            adoption.timeout(),
        )
        assertFalse(adoption.isPending)
        assertEquals(CreatedPaneAdoptionAction.Ignore, adoption.timeout())
    }
}
