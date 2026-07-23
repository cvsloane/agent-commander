/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.data

import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject

class UiStreamContractTest {
    @Test
    fun `synchronous failure before socket return does not retain the dead attempt`() {
        val failures = mutableListOf<String>()
        val factory = RecordingWebSocketFactory { index, webSocket, listener ->
            if (index == 0) {
                listener.onFailure(
                    webSocket,
                    IllegalStateException("synchronous failure"),
                    null,
                )
            }
        }
        val socket = UiStreamSocket(
            client = factory,
            url = "wss://agent-command.example.com/v1/ui/stream?ticket=one-time-ticket",
            origin = "https://agent-command.example.com",
            listener = object : UiStreamSocket.Listener {
                override fun onConnected() = Unit
                override fun onEvent(event: UiStreamEvent) = Unit
                override fun onFailure(message: String) {
                    failures += message
                }
                override fun onClosed() = Unit
            },
        )

        socket.connect()
        socket.connect()

        assertEquals(listOf("synchronous failure"), failures)
        assertEquals(2, factory.connections.size)
        assertEquals(1, factory.connections[0].webSocket.closeCalls)
    }

    @Test
    fun `socket becomes command-ready only after its correlated subscription acknowledgement`() {
        var connected = 0
        val failures = mutableListOf<String>()
        val factory = RecordingWebSocketFactory()
        val socket = UiStreamSocket(
            client = factory,
            url = "wss://agent-command.example.com/v1/ui/stream?ticket=one-time-ticket",
            origin = "https://agent-command.example.com",
            listener = object : UiStreamSocket.Listener {
                override fun onConnected() {
                    connected += 1
                }

                override fun onEvent(event: UiStreamEvent) = Unit

                override fun onFailure(message: String) {
                    failures += message
                }

                override fun onClosed() = Unit
            },
        )
        socket.connect()
        val connection = factory.connections.single()
        connection.listener.onOpen(
            connection.webSocket,
            switchingProtocols(connection.webSocket),
        )

        assertEquals(0, connected)
        val subscriptionId = JSONObject(connection.webSocket.sent.single())
            .getJSONObject("payload")
            .getString("subscription_id")
        val acknowledgement = JSONObject()
            .put("v", 1)
            .put("type", "ui.subscribed")
            .put("ts", "2026-07-23T12:00:01Z")
            .put("payload", JSONObject().put("subscription_id", subscriptionId))
            .toString()
        connection.listener.onMessage(connection.webSocket, acknowledgement)
        connection.listener.onMessage(connection.webSocket, acknowledgement)

        assertEquals(1, connected)
        assertTrue(failures.isEmpty())
    }

    @Test
    fun `socket becomes command-ready again after close and failure callbacks`() {
        var connected = 0
        val failures = mutableListOf<String>()
        val factory = RecordingWebSocketFactory()
        val socket = UiStreamSocket(
            client = factory,
            url = "wss://agent-command.example.com/v1/ui/stream?ticket=one-time-ticket",
            origin = "https://agent-command.example.com",
            listener = object : UiStreamSocket.Listener {
                override fun onConnected() {
                    connected += 1
                }

                override fun onEvent(event: UiStreamEvent) = Unit

                override fun onFailure(message: String) {
                    failures += message
                }

                override fun onClosed() = Unit
            },
        )
        socket.connect()
        val first = factory.connections[0]
        first.listener.onOpen(first.webSocket, switchingProtocols(first.webSocket))
        val subscriptionId = JSONObject(first.webSocket.sent.single())
            .getJSONObject("payload")
            .getString("subscription_id")
        val acknowledgement = subscribedAcknowledgement(subscriptionId)

        first.listener.onMessage(first.webSocket, acknowledgement)
        first.listener.onClosed(first.webSocket, 1006, "network changed")

        socket.connect()
        val second = factory.connections[1]
        second.listener.onOpen(second.webSocket, switchingProtocols(second.webSocket))
        second.listener.onMessage(second.webSocket, acknowledgement)
        second.listener.onFailure(
            second.webSocket,
            IllegalStateException("network lost"),
            null,
        )

        socket.connect()
        val third = factory.connections[2]
        third.listener.onOpen(third.webSocket, switchingProtocols(third.webSocket))
        third.listener.onMessage(third.webSocket, acknowledgement)

        assertEquals(3, connected)
        assertEquals(listOf("network lost"), failures)
    }

    @Test
    fun `payload-less unknown events are ignored without failing the stream`() {
        assertNull(
            UiStreamEventParser.parse(
                JSONObject()
                    .put("v", 1)
                    .put("type", "future.event")
                    .toString(),
            ),
        )

        val failures = mutableListOf<String>()
        val factory = RecordingWebSocketFactory()
        val socket = UiStreamSocket(
            client = factory,
            url = "wss://agent-command.example.com/v1/ui/stream?ticket=one-time-ticket",
            origin = "https://agent-command.example.com",
            listener = object : UiStreamSocket.Listener {
                override fun onConnected() = Unit
                override fun onEvent(event: UiStreamEvent) = Unit
                override fun onFailure(message: String) {
                    failures += message
                }
                override fun onClosed() = Unit
            },
        )

        socket.connect()
        val connection = factory.connections.single()
        connection.listener.onMessage(
            connection.webSocket,
            JSONObject().put("v", 1).put("type", "future.event").toString(),
        )

        assertTrue(failures.isEmpty())
    }

    @Test
    fun `callbacks from a replaced socket cannot affect the active connection`() {
        var connected = 0
        var closed = 0
        val failures = mutableListOf<String>()
        val events = mutableListOf<UiStreamEvent>()
        val factory = RecordingWebSocketFactory()
        val socket = UiStreamSocket(
            client = factory,
            url = "wss://agent-command.example.com/v1/ui/stream?ticket=one-time-ticket",
            origin = "https://agent-command.example.com",
            listener = object : UiStreamSocket.Listener {
                override fun onConnected() {
                    connected += 1
                }

                override fun onEvent(event: UiStreamEvent) {
                    events += event
                }

                override fun onFailure(message: String) {
                    failures += message
                }

                override fun onClosed() {
                    closed += 1
                }
            },
        )
        socket.connect()
        val replaced = factory.connections[0]
        replaced.listener.onOpen(
            replaced.webSocket,
            switchingProtocols(replaced.webSocket),
        )
        val subscriptionId = JSONObject(replaced.webSocket.sent.single())
            .getJSONObject("payload")
            .getString("subscription_id")
        val acknowledgement = subscribedAcknowledgement(subscriptionId)
        replaced.listener.onClosed(replaced.webSocket, 1006, "replace connection")

        socket.connect()
        val active = factory.connections[1]
        active.listener.onOpen(active.webSocket, switchingProtocols(active.webSocket))

        replaced.listener.onMessage(replaced.webSocket, acknowledgement)
        assertEquals(0, connected)

        active.listener.onMessage(active.webSocket, acknowledgement)
        replaced.listener.onMessage(replaced.webSocket, sessionsChanged())
        replaced.listener.onFailure(
            replaced.webSocket,
            IllegalStateException("stale failure"),
            null,
        )
        replaced.listener.onClosed(replaced.webSocket, 1006, "stale close")
        active.listener.onMessage(active.webSocket, acknowledgement)
        active.listener.onMessage(active.webSocket, sessionsChanged())

        assertEquals(1, connected)
        assertEquals(1, events.size)
        assertTrue(failures.isEmpty())
        assertEquals(1, closed)
    }

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
        val subscriptionId = "11111111-1111-4111-8111-111111111111"
        val url = AgentCommandApi.buildUiStreamUrl(
            AgentCommandApi.requireEndpoint("https://agent-command.example.com"),
            "one-time-ticket",
        )
        val subscription = UiStreamSocket.buildSubscription(
            "2026-07-23T12:00:00Z",
            subscriptionId,
        )

        assertTrue(url.startsWith("wss://agent-command.example.com/v1/ui/stream?"))
        assertTrue(url.contains("ticket=one-time-ticket"))
        assertFalse(url.contains("token="))
        assertEquals("ui.subscribe", subscription.getString("type"))
        assertEquals(
            subscriptionId,
            subscription.getJSONObject("payload").getString("subscription_id"),
        )
        assertEquals(
            listOf("commands.result", "tmux.topology", "sessions"),
            (0 until subscription.getJSONObject("payload").getJSONArray("topics").length()).map {
                subscription.getJSONObject("payload").getJSONArray("topics")
                    .getJSONObject(it)
                    .getString("type")
            },
        )

        assertEquals(
            UiStreamSubscribedEvent("2026-07-23T12:00:01Z", subscriptionId),
            UiStreamEventParser.parse(
                """
                {
                  "v":1,
                  "type":"ui.subscribed",
                  "ts":"2026-07-23T12:00:01Z",
                  "payload":{"subscription_id":"$subscriptionId"}
                }
                """.trimIndent(),
            ),
        )
    }

    private class RecordingWebSocket : WebSocket {
        val sent = mutableListOf<String>()
        var closeCalls = 0
        private val request = Request.Builder()
            .url("wss://agent-command.example.com/v1/ui/stream")
            .build()

        override fun request(): Request = request

        override fun queueSize(): Long = 0

        override fun send(text: String): Boolean {
            sent += text
            return true
        }

        override fun send(bytes: ByteString): Boolean = true

        override fun close(code: Int, reason: String?): Boolean {
            closeCalls += 1
            return true
        }

        override fun cancel() = Unit
    }

    private class RecordingWebSocketFactory(
        private val beforeReturn: (
            index: Int,
            webSocket: RecordingWebSocket,
            listener: WebSocketListener,
        ) -> Unit = { _, _, _ -> },
    ) : WebSocket.Factory {
        data class Connection(
            val webSocket: RecordingWebSocket,
            val listener: WebSocketListener,
        )

        val connections = mutableListOf<Connection>()

        override fun newWebSocket(request: Request, listener: WebSocketListener): WebSocket {
            val webSocket = RecordingWebSocket()
            connections += Connection(webSocket, listener)
            beforeReturn(connections.lastIndex, webSocket, listener)
            return webSocket
        }
    }

    private fun switchingProtocols(webSocket: WebSocket): Response = Response.Builder()
        .request(webSocket.request())
        .protocol(Protocol.HTTP_1_1)
        .code(101)
        .message("Switching Protocols")
        .build()

    private fun subscribedAcknowledgement(subscriptionId: String): String = JSONObject()
        .put("v", 1)
        .put("type", "ui.subscribed")
        .put("ts", "2026-07-23T12:00:01Z")
        .put("payload", JSONObject().put("subscription_id", subscriptionId))
        .toString()

    private fun sessionsChanged(): String = JSONObject()
        .put("v", 1)
        .put("type", "sessions.changed")
        .put("ts", "2026-07-23T12:00:02Z")
        .put("payload", JSONObject().put("sessions", JSONArray()))
        .toString()

}
