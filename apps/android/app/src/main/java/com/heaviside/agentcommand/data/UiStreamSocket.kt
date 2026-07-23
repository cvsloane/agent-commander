/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.data

import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

object UiStreamEventParser {
    fun parse(text: String): UiStreamEvent? {
        val message = JSONObject(text)
        return when (message.getString("type")) {
            "ui.subscribed" -> UiStreamSubscribedEvent(
                timestamp = message.getString("ts"),
                subscriptionId = message.getJSONObject("payload").getString("subscription_id"),
            )
            "commands.result" -> parseCommandResult(
                message.getString("ts"),
                message.getJSONObject("payload"),
            )
            "sessions.changed" -> parseSessionsChanged(
                message.getString("ts"),
                message.getJSONObject("payload"),
            )
            "tmux.topology" -> parseTopology(
                message.getString("ts"),
                message.getJSONObject("payload"),
            )
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

    private fun parseSessionsChanged(timestamp: String, payload: JSONObject): SessionsChangedEvent {
        val sessions = payload.optJSONArray("sessions") ?: JSONArray()
        val limit = minOf(sessions.length(), MAX_CHANGED_SESSION_SIGNALS)
        val tmuxPanes = buildList {
            for (index in 0 until limit) {
                val session = sessions.optJSONObject(index) ?: continue
                val sessionId = session.optString("id").takeIf(String::isNotBlank) ?: continue
                val hostId = session.optString("host_id").takeIf(String::isNotBlank) ?: continue
                val paneId = session.optString("tmux_pane_id").takeIf(String::isNotBlank) ?: continue
                add(ChangedTmuxPane(sessionId, hostId, paneId))
            }
        }
        return SessionsChangedEvent(
            timestamp = timestamp,
            tmuxPanes = tmuxPanes,
            truncated = sessions.length() > limit,
        )
    }

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

    private const val MAX_CHANGED_SESSION_SIGNALS = 128
}

class UiStreamSocket(
    private val client: WebSocket.Factory,
    private val url: String,
    private val origin: String,
    private val listener: Listener,
) {
    interface Listener {
        fun onConnected()
        fun onEvent(event: UiStreamEvent)
        fun onFailure(message: String)
        fun onClosed()
    }

    private val stateLock = Any()
    private var socket: WebSocket? = null
    private var intentionallyClosed = false
    private val subscriptionId = UUID.randomUUID().toString()
    private var subscriptionReady = false
    private var nextGeneration = 0L
    private var activeGeneration: Long? = null

    fun connect() {
        val generation = synchronized(stateLock) {
            if (activeGeneration != null || intentionallyClosed) return
            subscriptionReady = false
            nextGeneration += 1
            activeGeneration = nextGeneration
            nextGeneration
        }
        val createdSocket = try {
            client.newWebSocket(
                Request.Builder().url(url).header("Origin", origin).build(),
                AttemptListener(generation),
            )
        } catch (failure: RuntimeException) {
            synchronized(stateLock) {
                if (activeGeneration == generation) activeGeneration = null
            }
            throw failure
        }
        val discarded = synchronized(stateLock) {
            if (activeGeneration == generation) {
                socket = createdSocket
                false
            } else {
                true
            }
        }
        if (discarded) createdSocket.close(1000, "Android event stream attempt ended")
    }

    fun close() {
        val socketToClose = synchronized(stateLock) {
            intentionallyClosed = true
            activeGeneration = null
            subscriptionReady = false
            socket.also { socket = null }
        }
        socketToClose?.close(1000, "Android event stream closed")
    }

    private fun onOpen(generation: Long, webSocket: WebSocket) {
        synchronized(stateLock) {
            if (activeGeneration != generation) return
            webSocket.send(buildSubscription(Instant.now().toString(), subscriptionId).toString())
        }
    }

    private fun onMessage(generation: Long, text: String) {
        synchronized(stateLock) {
            if (activeGeneration != generation) return
        }
        val event = runCatching { UiStreamEventParser.parse(text) }.getOrElse {
            synchronized(stateLock) {
                if (activeGeneration == generation) {
                    listener.onFailure("Invalid Agent Command event")
                }
            }
            return
        }
        synchronized(stateLock) {
            if (activeGeneration != generation) return
            when (event) {
                is UiStreamSubscribedEvent -> {
                    if (event.subscriptionId != subscriptionId) {
                        listener.onFailure("Agent Command acknowledged the wrong event subscription")
                    } else if (!subscriptionReady) {
                        subscriptionReady = true
                        listener.onConnected()
                    }
                }
                null -> Unit
                else -> listener.onEvent(event)
            }
        }
    }

    private fun onFailure(generation: Long, throwable: Throwable) {
        synchronized(stateLock) {
            if (activeGeneration != generation) return
            activeGeneration = null
            socket = null
            subscriptionReady = false
            if (!intentionallyClosed) {
                listener.onFailure(throwable.message ?: "Event connection failed")
            }
        }
    }

    private fun onClosed(generation: Long) {
        synchronized(stateLock) {
            if (activeGeneration != generation) return
            activeGeneration = null
            socket = null
            subscriptionReady = false
            if (!intentionallyClosed) listener.onClosed()
        }
    }

    private inner class AttemptListener(
        private val generation: Long,
    ) : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            this@UiStreamSocket.onOpen(generation, webSocket)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            this@UiStreamSocket.onMessage(generation, text)
        }

        override fun onFailure(webSocket: WebSocket, throwable: Throwable, response: Response?) {
            this@UiStreamSocket.onFailure(generation, throwable)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            this@UiStreamSocket.onClosed(generation)
        }
    }

    internal companion object {
        fun buildSubscription(timestamp: String, subscriptionId: String): JSONObject = JSONObject()
            .put("v", 1)
            .put("type", "ui.subscribe")
            .put("ts", timestamp)
            .put(
                "payload",
                JSONObject()
                    .put("subscription_id", subscriptionId)
                    .put(
                        "topics",
                        JSONArray()
                            .put(JSONObject().put("type", "commands.result"))
                            .put(JSONObject().put("type", "tmux.topology"))
                            .put(JSONObject().put("type", "sessions")),
                    ),
            )
    }
}
