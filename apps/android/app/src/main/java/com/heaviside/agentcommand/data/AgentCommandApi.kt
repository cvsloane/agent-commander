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
import okhttp3.MediaType.Companion.toMediaType
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
        val panes = parseRoster(executeControlJson("v1/tmux/roster"), hostNames)
            .distinctBy { it.sessionId }
        return Topology(hosts, panes)
    }

    fun openTmuxTarget(request: TmuxOpenRequest): TmuxOpenResult {
        val payload = executeControlJson("v1/tmux/open", method = "POST", body = request.toJson())
        val session = payload.getJSONObject("session")
        val hostId = session.getString("host_id")
        return parseTmuxOpen(payload, mapOf(hostId to (request.hostAlias ?: hostId.take(8))))
    }

    fun loadScrollback(sessionId: String, request: ScrollbackRequest): ScrollbackCapture =
        parseScrollback(
            executeControlJson(
                "v1/sessions/$sessionId/scrollback",
                method = "POST",
                body = request.toJson(),
            ),
        )

    fun loadTranscript(sessionId: String, request: TranscriptRequest): TranscriptCapture =
        parseTranscript(
            executeControlJson(
                "v1/sessions/$sessionId/transcript",
                method = "POST",
                body = request.toJson(),
            ),
        )

    fun dispatchTmuxCommand(sessionId: String, command: TmuxCommand): CommandDispatchAcceptance =
        parseCommandAcceptance(
            executeControlJson(
                "v1/sessions/$sessionId/commands",
                method = "POST",
                body = command.toJson(),
            ),
        )

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

    fun createUiStreamSocket(listener: UiStreamSocket.Listener): UiStreamSocket {
        val ticket = executeControlJson("v1/auth/ws-ticket", method = "POST").optString("ticket")
        if (ticket.isBlank()) throw IOException("Agent Command did not issue an event ticket")
        return UiStreamSocket(
            webSockets,
            buildUiStreamUrl(baseUrl, ticket),
            publicOrigin(baseUrl),
            listener,
        )
    }

    private fun executeControlJson(
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
    ): JSONObject {
        val token = getControlPlaneToken()
        val request = if (body == null) {
            buildControlRequest(baseUrl, path, method, token)
        } else {
            require(method == "POST") { "JSON control requests must use POST" }
            buildJsonControlRequest(baseUrl, path, body, token)
        }
        http.newCall(request).execute().use { response ->
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

        fun buildJsonControlRequest(
            baseUrl: HttpUrl,
            path: String,
            body: JSONObject,
            token: String,
        ): Request {
            val url = baseUrl.resolve(path) ?: throw IOException("Invalid Agent Command API path")
            return Request.Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                .build()
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

        fun buildUiStreamUrl(baseUrl: HttpUrl, ticket: String): String {
            val stream = baseUrl.resolve("v1/ui/stream")
                ?: throw IllegalArgumentException("Unable to build event stream URL")
            return stream.newBuilder()
                .addQueryParameter("ticket", ticket)
                .build()
                .toString()
                .replaceFirst("https://", "wss://")
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
                val capabilities = item.optJSONObject("capabilities")
                add(
                    Host(
                        id = item.getString("id"),
                        name = item.optString("name", item.getString("id")),
                        online = item.optBoolean("online", false),
                        lastHeartbeatAt = item.optNullableString("last_heartbeat_at"),
                        lastSeenAt = item.optNullableString("last_seen_at"),
                        agentVersion = item.optNullableString("agent_version"),
                        capabilities = HostCapabilities(
                            tmux = capabilities?.optBoolean("tmux", false) ?: false,
                            terminal = capabilities?.optBoolean("terminal", false) ?: false,
                            spawn = capabilities?.optBoolean("spawn", false) ?: false,
                            kill = capabilities?.optBoolean("kill", false) ?: false,
                        ),
                    ),
                )
            }
        }

        fun parseRoster(payload: JSONObject, hostNames: Map<String, String>): List<TmuxPane> {
            val sessions = payload.getJSONArray("sessions")
            return buildList {
                for (index in 0 until sessions.length()) {
                    val item = sessions.getJSONObject(index)
                    val sessionMetadata = item.optJSONObject("metadata")
                    val metadata = sessionMetadata?.optJSONObject("tmux")
                    val paneId = item.optNullableString("tmux_pane_id")
                        ?: metadata?.optNullableString("pane_id")
                        ?: continue
                    val hostId = item.getString("host_id")
                    val snapshot = item.optJSONObject("latest_snapshot")?.let { latest ->
                        val createdAt = latest.optNullableString("created_at")
                        val captureText = latest.optNullableString("capture_text")
                        val captureHash = latest.optNullableString("capture_hash")
                        if (createdAt != null && captureText != null && captureHash != null) {
                            TmuxSnapshot(createdAt, captureText, captureHash)
                        } else {
                            null
                        }
                    }
                    val target = item.optNullableString("tmux_target")
                        ?: metadata?.optNullableString("target")
                        ?: ""
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
                            cwd = item.optNullableString("cwd"),
                            repoRoot = item.optNullableString("repo_root"),
                            gitBranch = item.optNullableString("git_branch"),
                            attentionReason = item.optNullableString("attention_reason"),
                            statusDetail = sessionMetadata?.optNullableString("status_detail"),
                            lastActivityAt = item.optNullableString("last_activity_at"),
                            updatedAt = item.optNullableString("updated_at"),
                            unmanaged = sessionMetadata?.optNullableBoolean("unmanaged"),
                            currentCommand = metadata?.optNullableString("current_command"),
                            panePid = metadata?.optNullableLong("pane_pid"),
                            latestSnapshot = snapshot,
                        ),
                    )
                }
            }.sortedWith(
                compareBy<TmuxPane>({ it.hostName }, { it.tmuxSessionName }, { it.windowIndex }, { it.paneIndex }),
            )
        }

        fun parseTmuxOpen(payload: JSONObject, hostNames: Map<String, String>): TmuxOpenResult {
            val pane = parseRoster(
                JSONObject().put("sessions", JSONArray().put(payload.getJSONObject("session"))),
                hostNames,
            ).single()
            val terminal = payload.getJSONObject("terminal")
            return TmuxOpenResult(
                sessionId = payload.getString("session_id"),
                href = payload.getString("href"),
                pane = pane,
                adopted = payload.optBoolean("adopted", false),
                terminalOpenable = terminal.optBoolean("openable", false),
                terminalPaneId = terminal.optNullableString("pane_id"),
            )
        }

        fun parseScrollback(payload: JSONObject): ScrollbackCapture {
            val result = payload.optJSONObject("result")
            val content = result?.optString("content").orEmpty()
            val lines = if (content.isEmpty()) {
                emptyList()
            } else {
                content.split('\n').let { if (content.endsWith('\n')) it.dropLast(1) else it }
            }
            val error = payload.optJSONObject("error")?.let {
                ApiError(it.optString("code", "scrollback_failed"), it.optString("message", "Scrollback failed"))
            }
            return ScrollbackCapture(
                cmdId = payload.getString("cmd_id"),
                ok = payload.optBoolean("ok", false),
                lines = lines,
                truncated = result?.optBoolean("truncated", false) ?: false,
                error = error,
            )
        }

        fun parseTranscript(payload: JSONObject): TranscriptCapture {
            val result = payload.optJSONObject("result")
            val firstEntry = result?.optInt("first_entry", 0) ?: 0
            val rawEntries = result?.optJSONArray("entries") ?: JSONArray()
            val entries = buildList {
                for (index in 0 until rawEntries.length()) {
                    val entry = rawEntries.getJSONObject(index)
                    add(
                        TranscriptRecord(
                            index = firstEntry + index,
                            type = entry.optNullableString("type"),
                            rawJson = entry.toString(),
                        ),
                    )
                }
            }
            val error = payload.optJSONObject("error")?.let {
                ApiError(it.optString("code", "transcript_failed"), it.optString("message", "Transcript failed"))
            }
            return TranscriptCapture(
                cmdId = payload.getString("cmd_id"),
                ok = payload.optBoolean("ok", false),
                entries = entries,
                firstEntry = firstEntry,
                totalEntries = result?.optInt("total_entries", 0) ?: 0,
                source = result?.optNullableString("source"),
                error = error,
            )
        }

        fun parseCommandAcceptance(payload: JSONObject): CommandDispatchAcceptance =
            CommandDispatchAcceptance(payload.getString("cmd_id"))

        private val TARGET_INDEXES = Regex(":(\\d+)(?:\\.(\\d+))?$")
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        private fun JSONObject.optNullableString(name: String): String? =
            if (isNull(name)) null else optString(name).takeIf { it.isNotBlank() }

        private fun JSONObject.optNullableInt(name: String): Int? =
            if (has(name) && !isNull(name)) optInt(name) else null

        private fun JSONObject.optNullableLong(name: String): Long? =
            if (has(name) && !isNull(name)) optLong(name) else null

        private fun JSONObject.optNullableBoolean(name: String): Boolean? =
            if (has(name) && !isNull(name)) optBoolean(name) else null
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

    fun viewerState(): String? {
        val requestId = UUID.randomUUID().toString()
        return requestId.takeIf { send(buildViewerStateMessage(requestId)) }
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

        fun buildViewerStateMessage(requestId: String): JSONObject = JSONObject()
            .put("type", "navigate")
            .put("op", "viewer_state")
            .put("request_id", requestId)

        private const val MAX_SCROLL_LINES = 120
    }
}
