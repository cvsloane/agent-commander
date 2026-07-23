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
import okio.Buffer

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
            JSONArray(
                """
                [{
                  "id":"host-a",
                  "name":"Workstation",
                  "online":true,
                  "last_heartbeat_at":"2026-07-23T12:00:00Z",
                  "capabilities":{"tmux":true,"terminal":true}
                }]
                """.trimIndent(),
            ),
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
                    "cwd": "/home/cvsloane/SloaneVault",
                    "git_branch": "main",
                    "last_activity_at": "2026-07-23T11:59:00Z",
                    "attention_reason": "waiting for review",
                    "metadata": {
                      "unmanaged": false,
                      "status_detail": "reviewing",
                      "tmux": {
                        "session_name": "vault",
                        "window_name": "code",
                        "current_command": "codex"
                      }
                    },
                    "latest_snapshot": {
                      "created_at": "2026-07-23T11:58:00Z",
                      "capture_text": "release verification",
                      "capture_hash": "sha256:snapshot"
                    }
                  }]
                }
                """.trimIndent(),
            ),
            hosts.associate { it.id to it.name },
        )

        assertEquals(1, panes.size)
        assertTrue(hosts.single().online)
        assertTrue(hosts.single().capabilities.terminal)
        assertEquals("Workstation", panes.single().hostName)
        assertEquals("%7", panes.single().paneId)
        assertEquals(2, panes.single().windowIndex)
        assertEquals(3, panes.single().paneIndex)
        assertEquals("codex", panes.single().currentCommand)
        assertEquals("release verification", panes.single().latestSnapshot?.captureText)
        assertEquals("waiting for review", panes.single().attentionReason)
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

    @Test
    fun `viewer state request uses a correlated terminal navigation message`() {
        val message = TerminalSocket.buildViewerStateMessage("viewer-request")

        assertEquals("navigate", message.getString("type"))
        assertEquals("viewer_state", message.getString("op"))
        assertEquals("viewer-request", message.getString("request_id"))
    }

    @Test
    fun `tmux open uses the typed JSON contract and returns an existing or adopted pane`() {
        val open = TmuxOpenRequest(
            hostId = "host-a",
            tmuxTarget = "vault:2.3",
        )
        val request = AgentCommandApi.buildJsonControlRequest(
            AgentCommandApi.requireEndpoint("https://agent-command.example.com"),
            "v1/tmux/open",
            open.toJson(),
            "control-plane-token",
        )
        val body = Buffer().also { requireNotNull(request.body).writeTo(it) }.readUtf8()

        assertEquals("application/json; charset=utf-8", request.body?.contentType().toString())
        assertEquals("host-a", JSONObject(body).getString("host_id"))
        assertEquals("vault:2.3", JSONObject(body).getString("tmux_target"))
        assertFalse(JSONObject(body).has("host_alias"))

        val result = AgentCommandApi.parseTmuxOpen(
            JSONObject(
                """
                {
                  "session_id":"session-a",
                  "href":"/?host_id=host-a&session_id=session-a&mode=terminal&attach=1",
                  "adopted":true,
                  "terminal":{"openable":true,"pane_id":"%7"},
                  "session":{
                    "id":"session-a",
                    "host_id":"host-a",
                    "status":"RUNNING",
                    "provider":"claude",
                    "title":"Agent work",
                    "tmux_target":"vault:2.3",
                    "tmux_pane_id":"%7",
                    "metadata":{"tmux":{"session_name":"vault","window_name":"code"}}
                  }
                }
                """.trimIndent(),
            ),
            mapOf("host-a" to "Workstation"),
        )

        assertTrue(result.adopted)
        assertTrue(result.terminalOpenable)
        assertEquals("%7", result.pane.paneId)
    }

    @Test
    fun `scrollback range requests are bounded and capture content remains typed`() {
        val range = ScrollbackRequest.Range(startLine = -1_000, endLine = -501)

        assertEquals("range", range.toJson().getString("mode"))
        assertEquals(-1_000, range.toJson().getInt("start_line"))
        assertEquals(-501, range.toJson().getInt("end_line"))
        assertThrows(IllegalArgumentException::class.java) {
            ScrollbackRequest.Range(startLine = -5_001, endLine = 0)
        }

        val capture = AgentCommandApi.parseScrollback(
            JSONObject(
                """
                {
                  "cmd_id":"scrollback-cmd",
                  "ok":true,
                  "result":{"content":"older\nnewer\n","truncated":true}
                }
                """.trimIndent(),
            ),
        )

        assertEquals("scrollback-cmd", capture.cmdId)
        assertEquals(listOf("older", "newer"), capture.lines)
        assertTrue(capture.truncated)
    }

    @Test
    fun `transcript pages retain ordered raw entries and derive the older cursor`() {
        val request = TranscriptRequest(pageSize = 2, beforeEntry = 42)
        assertEquals(2, request.toJson().getInt("page_size"))
        assertEquals(42, request.toJson().getInt("before_entry"))
        assertThrows(IllegalArgumentException::class.java) { TranscriptRequest(pageSize = 501) }

        val capture = AgentCommandApi.parseTranscript(
            JSONObject(
                """
                {
                  "cmd_id":"transcript-cmd",
                  "ok":true,
                  "result":{
                    "entries":[
                      {"type":"user","message":{"content":"Question"}},
                      {"type":"assistant","message":{"content":"Answer"}}
                    ],
                    "first_entry":7,
                    "total_entries":9,
                    "source":"hook"
                  }
                }
                """.trimIndent(),
            ),
        )

        assertEquals(listOf(7, 8), capture.entries.map { it.index })
        assertEquals(listOf("user", "assistant"), capture.entries.map { it.type })
        assertEquals(7, capture.olderRequest()?.beforeEntry)
        assertTrue(capture.entries.first().rawJson.contains("Question"))
    }

    @Test
    fun `generic command dispatch is represented as acceptance rather than success`() {
        val command = TmuxCommand(
            type = "rename_window",
            payload = JSONObject().put("window_index", 2).put("name", "review"),
        )
        val payload = command.toJson()
        val acceptance = AgentCommandApi.parseCommandAcceptance(
            JSONObject("""{"cmd_id":"cmd-rename-window"}"""),
        )

        assertEquals("rename_window", payload.getString("type"))
        assertEquals(2, payload.getJSONObject("payload").getInt("window_index"))
        assertEquals("cmd-rename-window", acceptance.cmdId)
        assertFalse(acceptance.isComplete)
    }
}
