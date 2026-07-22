/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentCommandContractTest {
    @Test
    fun `public endpoint requires https`() {
        assertThrows(IllegalArgumentException::class.java) {
            AgentCommandApi.requireEndpoint("http://agent-command.example.com")
        }

        assertEquals(
            "https://agent-command.example.com/",
            AgentCommandApi.requireEndpoint("https://agent-command.example.com").toString(),
        )
    }

    @Test
    fun `terminal URL uses public wss ticket and separate resume token`() {
        val url = AgentCommandApi.buildTerminalUrl(
            AgentCommandApi.requireEndpoint("https://agent-command.example.com"),
            "session-123",
            "one-time-ticket",
            120,
            40,
            "resume-456",
        )

        assertTrue(url.startsWith("wss://agent-command.example.com/v1/ui/terminal/session-123?"))
        assertTrue(url.contains("ticket=one-time-ticket"))
        assertTrue(url.contains("resume_token=resume-456"))
        assertFalse(url.contains("Authorization"))
    }

    @Test
    fun `shared roster metadata becomes existing pane topology`() {
        val hosts = AgentCommandApi.parseHosts(
            JSONArray("""[{"id":"host-a","name":"Workstation"}]"""),
        )
        val panes = AgentCommandApi.parseRoster(
            JSONObject(
                """
                {
                  "sessions": [{
                    "id": "session-a",
                    "host_id": "host-a",
                    "status": "running",
                    "provider": "claude",
                    "title": "Agent work",
                    "tmux_target": "vault:2.3",
                    "tmux_pane_id": "%7",
                    "metadata": {"tmux": {"session_name": "vault", "window_name": "code"}}
                  }]
                }
                """.trimIndent(),
            ),
            hosts.associate { it.id to it.name },
        )

        assertEquals(1, panes.size)
        assertEquals("Workstation", panes.single().hostName)
        assertEquals("%7", panes.single().paneId)
        assertEquals(2, panes.single().windowIndex)
        assertEquals(3, panes.single().paneIndex)
        assertTrue(panes.single().rosterLabel().contains("vault:2.3"))
    }
}
