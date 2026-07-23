/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentCommandContractTest {
    @Test
    fun `websocket ticket request is an empty bodyless-json bearer POST`() {
        val request = AgentCommandApi.buildControlRequest(
            AgentCommandApi.requireEndpoint("https://agent-command.example.com"),
            "v1/auth/ws-ticket",
            "POST",
            "control-plane-token",
        )
        val body = requireNotNull(request.body)

        assertEquals("https://agent-command.example.com/v1/auth/ws-ticket", request.url.toString())
        assertEquals("POST", request.method)
        assertEquals("Bearer control-plane-token", request.header("Authorization"))
        assertEquals("application/json", request.header("Accept"))
        assertEquals(0L, body.contentLength())
        assertNull(body.contentType())
        assertNull(request.header("Content-Type"))
    }

    @Test
    fun `saved credentials never render the access code`() {
        val credentials = SavedCredentials(
            endpoint = "https://agent-command.example.com",
            accessCode = "do-not-log-this",
        )

        assertFalse(credentials.toString().contains("do-not-log-this"))
        assertTrue(credentials.toString().contains("<redacted>"))
    }

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

    @Test
    fun `pane focus is not acknowledged before its websocket can send`() {
        val socket = TerminalSocket(
            okhttp3.OkHttpClient(),
            "wss://agent-command.example.com/v1/ui/terminal/session-123?ticket=ticket",
            "https://agent-command.example.com",
            object : TerminalSocket.Listener {
                override fun onAttached(readOnly: Boolean, resumed: Boolean, resumeToken: String?) = Unit
                override fun onOutput(data: ByteArray) = Unit
                override fun onStatus(type: String, message: String?) = Unit
                override fun onNavigationResult(result: NavigationResult) = Unit
                override fun onFailure(message: String) = Unit
            },
        )

        assertNull(socket.focusPane("%7", zoom = false))
    }

    @Test
    fun `terminal scroll message uses the bounded tmux navigation contract`() {
        val scrollUp = requireNotNull(TerminalSocket.buildScrollMessage(-7))
        assertEquals("navigate", scrollUp.getString("type"))
        assertEquals("scroll", scrollUp.getString("op"))
        assertEquals(-7, scrollUp.getInt("lines"))
        assertEquals(-120, requireNotNull(TerminalSocket.buildScrollMessage(-999)).getInt("lines"))
        assertEquals(120, requireNotNull(TerminalSocket.buildScrollMessage(999)).getInt("lines"))
        assertNull(TerminalSocket.buildScrollMessage(0))
    }
}
