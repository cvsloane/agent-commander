/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.TmuxPane
import com.heaviside.agentcommand.data.Topology
import com.heaviside.agentcommand.data.Host
import com.heaviside.agentcommand.terminal.ViewerTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkbenchNavigationTest {
    @Test
    fun `same tmux session keeps the active pane until its exact focus acknowledgement`() {
        val original = pane("backend-1", "host-a", "vault", "%1", "vault:0.0")
        val candidate = pane("backend-2", "host-a", "vault", "%2", "vault:1.0")
        val navigation = WorkbenchNavigation(original)

        val action = navigation.select(candidate, viewerAvailable = true, zoomed = false)

        assertEquals(WorkbenchNavigationAction.FocusCandidate(ViewerTarget("%2", false)), action)
        assertEquals(original, navigation.activePane)
        assertEquals(candidate, navigation.candidatePane)
        assertNull(navigation.confirm(ViewerTarget("%2", true)))
        assertEquals(original, navigation.activePane)

        assertEquals(candidate, navigation.confirm(ViewerTarget("%2", false)))
        assertEquals(candidate, navigation.activePane)
        assertNull(navigation.candidatePane)
    }

    @Test
    fun `cross session or host selection requires a fresh attachment`() {
        val original = pane("backend-1", "host-a", "vault", "%1", "vault:0.0")
        val navigation = WorkbenchNavigation(original)
        val otherSession = pane("backend-3", "host-a", "agents", "%3", "agents:0.0")
        val otherHost = pane("backend-4", "host-b", "vault", "%4", "vault:0.0")

        assertEquals(
            WorkbenchNavigationAction.FreshAttachment(otherSession),
            navigation.select(otherSession, viewerAvailable = true, zoomed = false),
        )
        assertEquals(
            WorkbenchNavigationAction.FreshAttachment(otherHost),
            navigation.select(otherHost, viewerAvailable = true, zoomed = false),
        )
        assertTrue(navigation.candidatePane == null)
        assertEquals(original, navigation.activePane)
    }

    @Test
    fun `last target restore returns only a fully validated roster pane and clears stale identity`() {
        val available = pane("backend-1", "host-a", "vault", "%1", "vault:0.0")
        val roster = TmuxRoster.from(Topology(listOf(Host("host-a", "Alpha")), listOf(available)))
        val valid = AppPreferences(
            lastValidatedTarget = ValidatedTmuxTarget(
                hostId = "host-a",
                sessionId = "backend-1",
                paneId = "%1",
                tmuxTarget = "vault:0.0",
                validatedAtEpochMillis = 10,
            ),
        )

        val restored = LastTargetPreference.resolve(valid, roster)
        assertEquals(available, restored.pane)
        assertEquals(valid, restored.preferences)

        val stale = LastTargetPreference.resolve(
            valid.copy(lastValidatedTarget = valid.lastValidatedTarget?.copy(tmuxTarget = "vault:9.9")),
            roster,
        )
        assertNull(stale.pane)
        assertNull(stale.preferences.lastValidatedTarget)
    }

    private fun pane(
        sessionId: String,
        hostId: String,
        tmuxSession: String,
        paneId: String,
        target: String,
    ) = TmuxPane(
        sessionId = sessionId,
        hostId = hostId,
        hostName = hostId,
        title = paneId,
        status = "RUNNING",
        provider = "claude_code",
        paneId = paneId,
        target = target,
        tmuxSessionName = tmuxSession,
        windowName = "window",
        windowIndex = 0,
        paneIndex = 0,
    )
}
