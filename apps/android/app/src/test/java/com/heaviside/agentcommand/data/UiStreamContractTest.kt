/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject

class UiStreamContractTest {
    @Test
    fun `sessions changed exposes only a bounded exact tmux pane signal`() {
        val sessions = JSONArray()
        repeat(130) { index ->
            sessions.put(
                JSONObject()
                    .put("id", "session-$index")
                    .put("host_id", "host-$index")
                    .put("tmux_pane_id", "%$index"),
            )
        }
        val event = UiStreamEventParser.parse(
            JSONObject()
                .put("v", 1)
                .put("type", "sessions.changed")
                .put("ts", "2026-07-23T12:00:00Z")
                .put("payload", JSONObject().put("sessions", sessions))
                .toString(),
        ) as SessionsChangedEvent

        assertEquals(128, event.tmuxPanes.size)
        assertTrue(event.truncated)
        assertTrue(event.includes("host-42", "%42"))
        assertFalse(event.includes("host-129", "%129"))
    }

    @Test
    fun `parses correlated command results and live tmux topology metadata`() {
        val command = UiStreamEventParser.parse(
            """
            {
              "v":1,
              "type":"commands.result",
              "ts":"2026-07-23T12:00:00Z",
              "payload":{
                "host_id":"host-a",
                "cmd_id":"cmd-window",
                "session_id":"session-a",
                "ok":false,
                "error":{"code":"TMUX_COMMAND_FAILED","message":"can't find window: 2"}
              }
            }
            """.trimIndent(),
        ) as CommandResultEvent

        assertEquals("cmd-window", command.cmdId)
        assertEquals("can't find window: 2", command.error?.message)

        val topology = UiStreamEventParser.parse(
            """
            {
              "v":1,
              "type":"tmux.topology",
              "ts":"2026-07-23T12:00:01Z",
              "payload":{
                "host_id":"host-a",
                "reason":"hook:window-layout-changed",
                "tmux_sessions":[{
                  "session_name":"vault",
                  "attached":true,
                  "attached_clients":2,
                  "windows":[{
                    "window_index":2,
                    "window_name":"review",
                    "active":true,
                    "zoomed":true,
                    "layout":"layout",
                    "bell":true,
                    "activity":true,
                    "panes":[{
                      "pane_id":"%7",
                      "pane_index":3,
                      "active":true,
                      "width":120,
                      "height":40,
                      "title":"Agent work",
                      "current_command":"claude",
                      "current_path":"/home/cvsloane/SloaneVault"
                    }]
                  }]
                }]
              }
            }
            """.trimIndent(),
        ) as TmuxTopologyEvent

        assertEquals("vault", topology.sessions.single().name)
        assertEquals(2, topology.sessions.single().attachedClients)
        assertTrue(topology.sessions.single().windows.single().zoomed)
        assertTrue(topology.sessions.single().windows.single().bell)
        assertEquals("%7", topology.sessions.single().windows.single().panes.single().paneId)
    }

    @Test
    fun `UI stream uses a one-time ticket and subscribes to session persistence truth`() {
        val url = AgentCommandApi.buildUiStreamUrl(
            AgentCommandApi.requireEndpoint("https://agent-command.example.com"),
            "one-time-ticket",
        )
        val subscription = UiStreamSocket.buildSubscription("2026-07-23T12:00:00Z")

        assertTrue(url.startsWith("wss://agent-command.example.com/v1/ui/stream?"))
        assertTrue(url.contains("ticket=one-time-ticket"))
        assertFalse(url.contains("token="))
        assertEquals("ui.subscribe", subscription.getString("type"))
        assertEquals(
            listOf("commands.result", "tmux.topology", "sessions"),
            (0 until subscription.getJSONObject("payload").getJSONArray("topics").length()).map {
                subscription.getJSONObject("payload").getJSONArray("topics")
                    .getJSONObject(it)
                    .getString("type")
            },
        )
    }
}
