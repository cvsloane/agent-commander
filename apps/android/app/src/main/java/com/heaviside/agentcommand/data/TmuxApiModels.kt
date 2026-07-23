/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.data

import org.json.JSONArray
import org.json.JSONObject

data class TmuxOpenRequest(
    val hostId: String? = null,
    val hostAlias: String? = null,
    val tmuxTarget: String? = null,
    val paneId: String? = null,
) {
    init {
        require(!hostId.isNullOrBlank() || !hostAlias.isNullOrBlank()) {
            "A host ID or alias is required"
        }
        require(!tmuxTarget.isNullOrBlank() || !paneId.isNullOrBlank()) {
            "A tmux target or pane ID is required"
        }
    }

    fun toJson(): JSONObject = JSONObject().apply {
        hostId?.takeIf { it.isNotBlank() }?.let { put("host_id", it) }
        hostAlias?.takeIf { it.isNotBlank() }?.let { put("host_alias", it) }
        tmuxTarget?.takeIf { it.isNotBlank() }?.let { put("tmux_target", it) }
        paneId?.takeIf { it.isNotBlank() }?.let { put("pane_id", it) }
    }
}

data class TmuxOpenResult(
    val sessionId: String,
    val href: String,
    val pane: TmuxPane,
    val adopted: Boolean,
    val terminalOpenable: Boolean,
    val terminalPaneId: String?,
)

sealed class ScrollbackRequest(
    private val stripAnsi: Boolean,
) {
    abstract val mode: String

    data class Visible(val strip: Boolean = true) : ScrollbackRequest(strip) {
        override val mode = "visible"
    }

    data class Last(val lines: Int, val strip: Boolean = true) : ScrollbackRequest(strip) {
        init {
            require(lines in 1..MAX_LINES)
        }

        override val mode = "last_n"
    }

    data class Range(
        val startLine: Int,
        val endLine: Int,
        val strip: Boolean = true,
    ) : ScrollbackRequest(strip) {
        init {
            require(endLine >= startLine) { "Scrollback range end must not precede its start" }
            require(endLine.toLong() - startLine.toLong() + 1 <= MAX_LINES) {
                "Scrollback range cannot exceed $MAX_LINES lines"
            }
        }

        override val mode = "range"
    }

    data class Full(
        val pageSize: Int = DEFAULT_SNAPSHOT_PAGE_SIZE,
        val snapshotId: String? = null,
        val beforeLine: Int? = null,
        val strip: Boolean = true,
    ) : ScrollbackRequest(strip) {
        init {
            require(pageSize in 1..MAX_LINES)
            require((snapshotId == null) == (beforeLine == null)) {
                "Snapshot ID and before-line cursor must be provided together"
            }
            require(snapshotId == null || snapshotId.isNotBlank())
            require(beforeLine == null || beforeLine >= 0)
        }

        override val mode = "full"
    }

    fun toJson(): JSONObject = JSONObject()
        .put("mode", mode)
        .put("strip_ansi", stripAnsi)
        .apply {
            when (this@ScrollbackRequest) {
                is Last -> put("last_n_lines", lines)
                is Range -> {
                    put("start_line", startLine)
                    put("end_line", endLine)
                }
                is Full -> {
                    put("page_size", pageSize)
                    snapshotId?.let { put("snapshot_id", it) }
                    beforeLine?.let { put("before_line", it) }
                }
                is Visible -> Unit
            }
        }

    companion object {
        const val DEFAULT_SNAPSHOT_PAGE_SIZE = 500
        const val MAX_LINES = 5_000
    }
}

data class ApiError(
    val code: String,
    val message: String,
)

data class ScrollbackCapture(
    val cmdId: String,
    val ok: Boolean,
    val lines: List<String>,
    val truncated: Boolean,
    val error: ApiError? = null,
    val snapshotId: String? = null,
    val rangeStart: Int? = null,
    val rangeEnd: Int? = null,
    val hasOlder: Boolean? = null,
    val lineCount: Int? = null,
    val captureMode: String? = null,
    val totalLines: Int? = null,
    val sourceTotalLines: Int? = null,
    val snapshotTruncated: Boolean? = null,
    val nextBefore: Int? = null,
)

data class TranscriptRequest(
    val pageSize: Int = DEFAULT_PAGE_SIZE,
    val beforeEntry: Int? = null,
) {
    init {
        require(pageSize in 1..MAX_PAGE_SIZE)
        require(beforeEntry == null || beforeEntry >= 0)
    }

    fun toJson(): JSONObject = JSONObject()
        .put("page_size", pageSize)
        .apply { beforeEntry?.let { put("before_entry", it) } }

    companion object {
        const val DEFAULT_PAGE_SIZE = 200
        const val MAX_PAGE_SIZE = 500
    }
}

data class TranscriptRecord(
    val index: Int,
    val type: String?,
    val rawJson: String,
)

data class TranscriptCapture(
    val cmdId: String,
    val ok: Boolean,
    val entries: List<TranscriptRecord>,
    val firstEntry: Int,
    val totalEntries: Int,
    val source: String?,
    val error: ApiError? = null,
) {
    fun olderRequest(pageSize: Int = TranscriptRequest.DEFAULT_PAGE_SIZE): TranscriptRequest? =
        firstEntry.takeIf { ok && it > 0 }?.let { TranscriptRequest(pageSize, it) }
}

class TmuxCommand(
    val type: String,
    payload: JSONObject = JSONObject(),
) {
    val payload: JSONObject = JSONObject(payload.toString())

    init {
        require(type.isNotBlank()) { "Command type is required" }
    }

    fun toJson(): JSONObject = JSONObject()
        .put("type", type)
        .put("payload", JSONObject(payload.toString()))

    override fun toString(): String = "TmuxCommand(type=$type, payload=<redacted>)"

    companion object {
        fun sendInput(text: String, enter: Boolean = true): TmuxCommand =
            TmuxCommand("send_input", JSONObject().put("text", text).put("enter", enter))
    }
}

data class CommandDispatchAcceptance(
    val cmdId: String,
) {
    val isComplete: Boolean = false
}

data class BulkTerminateRequest(val sessionId: String) {
    init {
        require(sessionId.isNotBlank()) { "A tracked session ID is required" }
    }

    fun toJson(): JSONObject = JSONObject()
        .put("operation", "terminate")
        .put("session_ids", JSONArray().put(sessionId))
}

data class BulkTerminateResult(
    val sessionId: String,
    val completed: Boolean,
    val error: String? = null,
)
