/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.data

import android.util.Base64
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

class AgentCommandApi(credentials: SavedCredentials) {
    private val baseUrl = requireEndpoint(credentials.endpoint)
    private val accessCode = credentials.accessCode
    private val cookies = MemoryCookieJar()
    private val http = OkHttpClient.Builder()
        .cookieJar(cookies)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    private val webSockets = http.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    private var controlPlaneToken: String? = null
    private var controlPlaneTokenExpiry = 0L

    fun loadTopology(): Topology {
        val hosts = executeControlJson("v1/hosts").getJSONArray("hosts").let(::parseHosts)
        val hostNames = hosts.associate { it.id to it.name }
        val panes = hosts.flatMap { host ->
            parseRoster(executeControlJson("v1/tmux/roster?host_id=${host.id}"), hostNames)
        }.distinctBy { it.sessionId }
        return Topology(hosts, panes)
    }

    fun createTerminalSocket(
        session: TmuxPane,
        columns: Int,
        rows: Int,
        resumeToken: String?,
        listener: TerminalSocket.Listener,
    ): TerminalSocket {
        val ticket = executeControlJson("v1/auth/ws-ticket", method = "POST").optString("ticket")
        if (ticket.isBlank()) throw IOException("Agent Command did not issue a terminal ticket")
        val url = buildTerminalUrl(baseUrl, session.sessionId, ticket, columns, rows, resumeToken)
        return TerminalSocket(webSockets, url, publicOrigin(baseUrl), listener)
    }

    private fun executeControlJson(path: String, method: String = "GET"): JSONObject {
        val token = getControlPlaneToken()
        http.newCall(buildControlRequest(baseUrl, path, method, token)).execute().use { response ->
            if (!response.isSuccessful) throw response.toApiException()
            val body = response.body?.string().orEmpty()
            return JSONObject(body)
        }
    }

    private fun getControlPlaneToken(): String {
        val now = System.currentTimeMillis() / 1_000
        controlPlaneToken?.takeIf { controlPlaneTokenExpiry - now > 30 }?.let { return it }

        var response = executeDashboardJson("api/control-plane-token")
        if (response.first == 401) {
            signIn()
            response = executeDashboardJson("api/control-plane-token")
        }
        if (response.first !in 200..299) throw IOException("Agent Command authentication failed")
        val payload = response.second
        val token = payload.optString("token")
        if (token.isBlank()) throw IOException("Agent Command did not issue a control-plane token")
        controlPlaneToken = token
        controlPlaneTokenExpiry = payload.optLong("exp", now + 60)
        return token
    }

    private fun signIn() {
        val csrfResponse = executeDashboardJson("api/auth/csrf")
        if (csrfResponse.first !in 200..299) throw IOException("Unable to begin Agent Command sign-in")
        val csrfToken = csrfResponse.second.optString("csrfToken")
        if (csrfToken.isBlank()) throw IOException("Agent Command did not issue a CSRF token")

        val callbackUrl = publicOrigin(baseUrl) + "/"
        val body = FormBody.Builder()
            .add("csrfToken", csrfToken)
            .add("code", accessCode)
            .add("callbackUrl", callbackUrl)
            .add("json", "true")
            .build()
        val url = baseUrl.resolve("api/auth/callback/credentials")
            ?: throw IOException("Invalid Agent Command sign-in path")
        http.newCall(
            Request.Builder()
                .url(url)
                .header("Accept", "application/json")
                .post(body)
                .build(),
        ).execute().use { response ->
            val payload = response.body?.string().orEmpty()
            if (!response.isSuccessful || payload.contains("CredentialsSignin")) {
                throw IOException("Invalid Agent Command access code")
            }
        }
    }

    private fun executeDashboardJson(path: String): Pair<Int, JSONObject> {
        val url = baseUrl.resolve(path) ?: throw IOException("Invalid Agent Command dashboard path")
        http.newCall(Request.Builder().url(url).header("Accept", "application/json").build())
            .execute()
            .use { response ->
                val body = response.body?.string().orEmpty()
                return response.code to runCatching { JSONObject(body) }.getOrDefault(JSONObject())
            }
    }

    private fun Response.toApiException(): IOException {
        val detail = runCatching {
            JSONObject(body?.string().orEmpty()).optString("error")
        }.getOrDefault("")
        return IOException(if (detail.isBlank()) "Agent Command returned HTTP $code" else detail)
    }

    internal companion object {
        fun buildControlRequest(baseUrl: HttpUrl, path: String, method: String, token: String): Request {
            val url = baseUrl.resolve(path) ?: throw IOException("Invalid Agent Command API path")
            val builder = Request.Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
            if (method == "POST") {
                builder.post(ByteArray(0).toRequestBody(null))
            }
            return builder.build()
        }

        fun requireEndpoint(raw: String): HttpUrl {
            val normalized = raw.trim().trimEnd('/') + "/"
            val url = normalized.toHttpUrlOrNull()
                ?: throw IllegalArgumentException("Enter a valid Agent Command HTTPS endpoint")
            require(url.scheme == "https") { "Agent Command must use a public HTTPS endpoint" }
            return url
        }

        fun buildTerminalUrl(
            baseUrl: HttpUrl,
            sessionId: String,
            ticket: String,
            columns: Int,
            rows: Int,
            resumeToken: String?,
        ): String {
            val terminal = baseUrl.resolve("v1/ui/terminal/$sessionId")
                ?: throw IllegalArgumentException("Unable to build terminal URL")
            val secureHttpUrl = terminal.newBuilder()
                .addQueryParameter("ticket", ticket)
                .addQueryParameter("cols", columns.coerceAtLeast(4).toString())
                .addQueryParameter("rows", rows.coerceAtLeast(4).toString())
                .apply {
                    if (!resumeToken.isNullOrBlank()) addQueryParameter("resume_token", resumeToken)
                }
                .build()
            return secureHttpUrl.toString().replaceFirst("https://", "wss://")
        }

        fun publicOrigin(baseUrl: HttpUrl): String = baseUrl.newBuilder()
            .encodedPath("/")
            .query(null)
            .fragment(null)
            .build()
            .toString()
            .removeSuffix("/")

        fun parseHosts(hosts: JSONArray): List<Host> = buildList {
            for (index in 0 until hosts.length()) {
                val item = hosts.getJSONObject(index)
                add(Host(item.getString("id"), item.optString("name", item.getString("id"))))
            }
        }

        fun parseRoster(payload: JSONObject, hostNames: Map<String, String>): List<TmuxPane> {
            val sessions = payload.getJSONArray("sessions")
            return buildList {
                for (index in 0 until sessions.length()) {
                    val item = sessions.getJSONObject(index)
                    val paneId = item.optNullableString("tmux_pane_id") ?: continue
                    val hostId = item.getString("host_id")
                    val metadata = item.optJSONObject("metadata")?.optJSONObject("tmux")
                    val target = item.optNullableString("tmux_target").orEmpty()
                    val parsedIndexes = TARGET_INDEXES.find(target)
                    val sessionName = item.optNullableString("tmux_session_name")
                        ?: metadata?.optNullableString("session_name")
                        ?: target.substringBefore(':', "tmux")
                    val windowIndex = item.optNullableInt("tmux_window_index")
                        ?: metadata?.optNullableInt("window_index")
                        ?: parsedIndexes?.groupValues?.getOrNull(1)?.toIntOrNull()
                        ?: 0
                    val paneIndex = item.optNullableInt("tmux_pane_index")
                        ?: metadata?.optNullableInt("pane_index")
                        ?: parsedIndexes?.groupValues?.getOrNull(2)?.toIntOrNull()
                        ?: 0
                    add(
                        TmuxPane(
                            sessionId = item.getString("id"),
                            hostId = hostId,
                            hostName = hostNames[hostId] ?: hostId.take(8),
                            title = item.optNullableString("title") ?: target.ifBlank { paneId },
                            status = item.optString("status", "unknown"),
                            provider = item.optString("provider", "unknown"),
                            paneId = paneId,
                            target = target,
                            tmuxSessionName = sessionName,
                            windowName = metadata?.optNullableString("window_name") ?: windowIndex.toString(),
                            windowIndex = windowIndex,
                            paneIndex = paneIndex,
                        ),
                    )
                }
            }.sortedWith(
                compareBy<TmuxPane>({ it.hostName }, { it.tmuxSessionName }, { it.windowIndex }, { it.paneIndex }),
            )
        }

        private val TARGET_INDEXES = Regex(":(\\d+)(?:\\.(\\d+))?$")

        private fun JSONObject.optNullableString(name: String): String? =
            if (isNull(name)) null else optString(name).takeIf { it.isNotBlank() }

        private fun JSONObject.optNullableInt(name: String): Int? =
            if (has(name) && !isNull(name)) optInt(name) else null
    }
}

private class MemoryCookieJar : CookieJar {
    private val cookies = mutableListOf<Cookie>()

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        for (cookie in cookies) {
            this.cookies.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
            this.cookies.add(cookie)
        }
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        cookies.removeAll { it.expiresAt < System.currentTimeMillis() }
        return cookies.filter { it.matches(url) }
    }
}

class TerminalSocket(
    private val client: OkHttpClient,
    private val url: String,
    private val origin: String,
    private val listener: Listener,
) : WebSocketListener() {
    interface Listener {
        fun onAttached(readOnly: Boolean, resumed: Boolean, resumeToken: String?)
        fun onOutput(data: ByteArray)
        fun onStatus(type: String, message: String?)
        fun onNavigationResult(result: NavigationResult)
        fun onFailure(message: String)
    }

    private var socket: WebSocket? = null
    @Volatile private var intentionallyClosed = false

    fun connect() {
        if (socket != null || intentionallyClosed) return
        socket = client.newWebSocket(Request.Builder().url(url).header("Origin", origin).build(), this)
    }

    override fun onOpen(webSocket: WebSocket, response: Response) {
        webSocket.send(JSONObject().put("type", "hello").put("binary", true).toString())
    }

    override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        listener.onOutput(bytes.toByteArray())
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        val message = runCatching { JSONObject(text) }.getOrElse {
            listener.onFailure("Invalid terminal response")
            return
        }
        when (val type = message.optString("type")) {
            "output" -> {
                val data = message.optString("data")
                listener.onOutput(
                    if (message.optString("encoding") == "base64") {
                        Base64.decode(data, Base64.DEFAULT)
                    } else {
                        data.toByteArray(Charsets.UTF_8)
                    },
                )
            }
            "attached" -> listener.onAttached(
                message.optBoolean("readonly", false),
                message.optBoolean("resumed", false),
                message.optString("resume_token").takeIf { it.isNotBlank() },
            )
            "navigation_result" -> listener.onNavigationResult(
                NavigationResult(
                    requestId = message.optString("request_id"),
                    ok = message.optBoolean("ok", false),
                    paneId = message.optString("pane_id").takeIf { it.isNotBlank() },
                    windowIndex = if (message.has("window_index")) message.optInt("window_index") else null,
                    zoomed = if (message.has("zoomed")) message.optBoolean("zoomed") else null,
                    message = message.optString("message").takeIf { it.isNotBlank() },
                ),
            )
            "control", "readonly", "detached", "error", "idle_timeout", "lag" ->
                listener.onStatus(type, message.optString("message").takeIf { it.isNotBlank() })
            else -> listener.onStatus(type.ifBlank { "unknown" }, null)
        }
    }

    override fun onFailure(webSocket: WebSocket, throwable: Throwable, response: Response?) {
        if (!intentionallyClosed) listener.onFailure(throwable.message ?: "Terminal connection failed")
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        if (!intentionallyClosed) {
            listener.onFailure(reason.ifBlank { "Terminal connection closed" })
        }
    }

    fun sendInput(data: String): Boolean = send(
        JSONObject().put("type", "input").put("data", data),
    )

    fun sendResize(columns: Int, rows: Int): Boolean = send(
        JSONObject()
            .put("type", "resize")
            .put("cols", columns.coerceAtLeast(4))
            .put("rows", rows.coerceAtLeast(4)),
    )

    fun focusPane(paneId: String, zoom: Boolean): String? {
        val requestId = UUID.randomUUID().toString()
        val sent = send(
            JSONObject()
                .put("type", "navigate")
                .put("op", "focus_pane")
                .put("request_id", requestId)
                .put("pane_id", paneId)
                .put("zoom", zoom),
        )
        return requestId.takeIf { sent }
    }

    fun scroll(lines: Int): Boolean {
        val message = buildScrollMessage(lines) ?: return false
        return send(message)
    }

    fun takeControl(): Boolean = send(JSONObject().put("type", "control"))

    fun close() {
        intentionallyClosed = true
        socket?.close(1000, "Android client backgrounded")
    }

    private fun send(message: JSONObject): Boolean = socket?.send(message.toString()) == true

    internal companion object {
        fun buildScrollMessage(lines: Int): JSONObject? {
            val normalized = lines.coerceIn(-MAX_SCROLL_LINES, MAX_SCROLL_LINES)
            if (normalized == 0) return null
            return JSONObject()
                .put("type", "navigate")
                .put("op", "scroll")
                .put("lines", normalized)
        }

        private const val MAX_SCROLL_LINES = 120
    }
}
