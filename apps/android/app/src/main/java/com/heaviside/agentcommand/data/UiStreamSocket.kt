/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.data

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

object UiStreamEventParser {
    fun parse(text: String): UiStreamEvent? {
        val message = JSONObject(text)
        val timestamp = message.getString("ts")
        val payload = message.getJSONObject("payload")
        return when (message.getString("type")) {
            "commands.result" -> parseCommandResult(timestamp, payload)
            "tmux.topology" -> parseTopology(timestamp, payload)
            else -> null
        }
    }

    private fun parseCommandResult(timestamp: String, payload: JSONObject): CommandResultEvent =
        CommandResultEvent(
            timestamp = timestamp,
            hostId = payload.getString("host_id"),
            cmdId = payload.getString("cmd_id"),
            sessionId = payload.optString("session_id").takeIf { it.isNotBlank() },
            ok = payload.getBoolean("ok"),
            resultJson = payload.optJSONObject("result")?.toString(),
            error = payload.optJSONObject("error")?.let {
                ApiError(it.getString("code"), it.getString("message"))
            },
        )

    private fun parseTopology(timestamp: String, payload: JSONObject): TmuxTopologyEvent =
        TmuxTopologyEvent(
            timestamp = timestamp,
            hostId = payload.getString("host_id"),
            reason = payload.getString("reason"),
            sessions = payload.getJSONArray("tmux_sessions").mapObjects { session ->
                TmuxTopologySession(
                    name = session.getString("session_name"),
                    attached = session.getBoolean("attached"),
                    attachedClients = session.optIntOrNull("attached_clients"),
                    windows = session.getJSONArray("windows").mapObjects { window ->
                        TmuxTopologyWindow(
                            index = window.getInt("window_index"),
                            name = window.getString("window_name"),
                            active = window.getBoolean("active"),
                            zoomed = window.getBoolean("zoomed"),
                            layout = window.getString("layout"),
                            bell = window.getBoolean("bell"),
                            activity = window.getBoolean("activity"),
                            panes = window.getJSONArray("panes").mapObjects { pane ->
                                TmuxTopologyPane(
                                    paneId = pane.getString("pane_id"),
                                    index = pane.getInt("pane_index"),
                                    active = pane.getBoolean("active"),
                                    width = pane.getInt("width"),
                                    height = pane.getInt("height"),
                                    title = pane.getString("title"),
                                    currentCommand = pane.getString("current_command"),
                                    currentPath = pane.getString("current_path"),
                                )
                            },
                        )
                    },
                )
            },
        )

    private fun JSONObject.optIntOrNull(name: String): Int? =
        if (has(name) && !isNull(name)) getInt(name) else null

    private inline fun <T> JSONArray.mapObjects(transform: (JSONObject) -> T): List<T> =
        buildList {
            for (index in 0 until length()) add(transform(getJSONObject(index)))
        }
}

class UiStreamSocket(
    private val client: OkHttpClient,
    private val url: String,
    private val origin: String,
    private val listener: Listener,
) : WebSocketListener() {
    interface Listener {
        fun onConnected()
        fun onEvent(event: UiStreamEvent)
        fun onFailure(message: String)
        fun onClosed()
    }

    private var socket: WebSocket? = null
    @Volatile private var intentionallyClosed = false

    fun connect() {
        if (socket != null || intentionallyClosed) return
        socket = client.newWebSocket(Request.Builder().url(url).header("Origin", origin).build(), this)
    }

    override fun onOpen(webSocket: WebSocket, response: Response) {
        webSocket.send(buildSubscription(Instant.now().toString()).toString())
        listener.onConnected()
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        val event = runCatching { UiStreamEventParser.parse(text) }.getOrElse {
            listener.onFailure("Invalid Agent Command event")
            return
        }
        event?.let(listener::onEvent)
    }

    override fun onFailure(webSocket: WebSocket, throwable: Throwable, response: Response?) {
        if (!intentionallyClosed) listener.onFailure(throwable.message ?: "Event connection failed")
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        socket = null
        if (!intentionallyClosed) listener.onClosed()
    }

    fun close() {
        intentionallyClosed = true
        socket?.close(1000, "Android event stream closed")
        socket = null
    }

    internal companion object {
        fun buildSubscription(timestamp: String): JSONObject = JSONObject()
            .put("v", 1)
            .put("type", "ui.subscribe")
            .put("ts", timestamp)
            .put(
                "payload",
                JSONObject().put(
                    "topics",
                    JSONArray()
                        .put(JSONObject().put("type", "commands.result"))
                        .put(JSONObject().put("type", "tmux.topology")),
                ),
            )
    }
}
