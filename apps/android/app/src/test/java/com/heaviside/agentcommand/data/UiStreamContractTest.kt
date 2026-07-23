/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UiStreamContractTest {
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
    fun `UI stream uses a one-time ticket and subscribes only to command and topology truth`() {
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
            listOf("commands.result", "tmux.topology"),
            (0 until subscription.getJSONObject("payload").getJSONArray("topics").length()).map {
                subscription.getJSONObject("payload").getJSONArray("topics")
                    .getJSONObject(it)
                    .getString("type")
            },
        )
    }
}
