/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.TmuxPane
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClaudePaneVisibilityTest {
    @Test
    fun `canonical Claude Code panes expose the transcript entry point`() {
        assertTrue(ClaudePaneVisibility.isVisible(pane(provider = "claude_code")))
        assertTrue(ClaudePaneVisibility.isVisible(pane(provider = "claude")))
        assertTrue(ClaudePaneVisibility.isVisible(pane(provider = "unknown", command = "claude")))
        assertFalse(ClaudePaneVisibility.isVisible(pane(provider = "codex", command = "bash")))
    }

    private fun pane(provider: String, command: String? = null) = TmuxPane(
        sessionId = "session-a",
        hostId = "host-a",
        hostName = "Alpha",
        title = "work",
        status = "RUNNING",
        provider = provider,
        paneId = "%1",
        target = "vault:0.0",
        tmuxSessionName = "vault",
        windowName = "work",
        windowIndex = 0,
        paneIndex = 0,
        currentCommand = command,
    )
}
