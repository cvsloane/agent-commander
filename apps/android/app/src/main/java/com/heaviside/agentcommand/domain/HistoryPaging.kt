/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.ScrollbackCapture
import com.heaviside.agentcommand.data.ScrollbackRequest
import com.heaviside.agentcommand.data.TranscriptCapture
import java.util.Locale

data class ScrollbackRange(
    val startLine: Int,
    val endLine: Int,
) {
    init {
        require(endLine >= startLine) { "Scrollback range end must not precede its start" }
        require(endLine.toLong() - startLine.toLong() + 1 <= MAX_SCROLLBACK_LINES) {
            "Scrollback range cannot exceed $MAX_SCROLLBACK_LINES lines"
        }
    }

    companion object {
        const val MAX_SCROLLBACK_LINES = 5_000
    }
}

data class ScrollbackPage(
    val range: ScrollbackRange,
    val contentLines: List<String>,
) {
    val numberedLines: List<ScrollbackLine>
        get() {
            val firstLine = range.endLine - contentLines.size + 1
            return contentLines.mapIndexed { index, text -> ScrollbackLine(firstLine + index, text) }
        }
}

data class ScrollbackLine(
    val lineNumber: Int,
    val text: String,
)

data class ScrollbackHistory(
    private val pages: List<ScrollbackPage> = emptyList(),
) {
    val lines: List<ScrollbackLine>
        by lazy(LazyThreadSafetyMode.NONE) {
            pages
                .flatMap(ScrollbackPage::numberedLines)
                .associateBy { it.lineNumber }
                .toSortedMap()
                .values
                .toList()
        }

    fun withPage(page: ScrollbackPage): ScrollbackHistory =
        ScrollbackHistory((pages.filterNot { it.range == page.range } + page).sortedBy { it.range.startLine })

    fun filtered(query: String): List<ScrollbackLine> {
        val normalized = query.trim().lowercase(Locale.ROOT)
        return if (normalized.isEmpty()) lines else lines.filter {
            it.text.lowercase(Locale.ROOT).contains(normalized)
        }
    }

    fun copyRange(firstLine: Int, lastLine: Int): String {
        val start = minOf(firstLine, lastLine)
        val end = maxOf(firstLine, lastLine)
        return lines.filter { it.lineNumber in start..end }.joinToString("\n") { it.text }
    }

    fun copyLast(count: Int): String {
        require(count >= 0)
        return lines.takeLast(count).joinToString("\n") { it.text }
    }

    fun copyAll(): String = lines.joinToString("\n") { it.text }
}

data class ScrollbackSnapshotPageRequest(
    val snapshotId: String,
    val beforeLine: Int,
    val pageSize: Int,
)

class ScrollbackReaderState(
    private val pageLines: Int = ScrollbackRequest.DEFAULT_SNAPSHOT_PAGE_SIZE,
) {
    private var history = ScrollbackHistory()
    private var snapshotId: String? = null
    private var oldestLine: Int? = null

    var query: String = ""
    var canLoadOlder: Boolean = false
        private set

    var totalLines: Int? = null
        private set

    var sourceTotalLines: Int? = null
        private set

    var snapshotTruncated: Boolean = false
        private set

    init {
        require(pageLines in 1..ScrollbackRange.MAX_SCROLLBACK_LINES)
    }

    val nextSnapshotPage: ScrollbackSnapshotPageRequest?
        get() = if (canLoadOlder) {
            ScrollbackSnapshotPageRequest(
                snapshotId = requireNotNull(snapshotId),
                beforeLine = requireNotNull(oldestLine),
                pageSize = pageLines,
            )
        } else {
            null
        }

    val hasLoadedSnapshot: Boolean
        get() = snapshotId != null

    val copyAllLabel: String
        get() = if (canLoadOlder) "Copy loaded" else "Copy all"

    val visibleLines: List<ScrollbackLine>
        get() = history.filtered(query)

    val allLines: List<ScrollbackLine>
        get() = history.lines

    fun acceptInitial(capture: ScrollbackCapture) {
        val page = validatedPage(capture)
        require(page.rangeEnd == page.totalLines) {
            "History snapshot did not return its newest page. Refresh history."
        }
        history = page.asHistory()
        snapshotId = page.snapshotId
        oldestLine = page.nextBefore ?: page.rangeStart
        canLoadOlder = page.hasOlder
        totalLines = page.totalLines
        sourceTotalLines = page.sourceTotalLines
        snapshotTruncated = page.snapshotTruncated
    }

    fun acceptOlder(request: ScrollbackSnapshotPageRequest, capture: ScrollbackCapture) {
        require(request.snapshotId == snapshotId && request.beforeLine == oldestLine) {
            "History snapshot cursor is stale. Refresh history."
        }
        val page = validatedPage(capture)
        require(page.snapshotId == request.snapshotId) {
            "History snapshot expired or changed. Refresh history."
        }
        require(page.rangeEnd == request.beforeLine) {
            "History snapshot page is not contiguous. Refresh history."
        }
        require(
            page.totalLines == totalLines &&
                page.sourceTotalLines == sourceTotalLines &&
                page.snapshotTruncated == snapshotTruncated
        ) {
            "History snapshot metadata changed. Refresh history."
        }
        require(page.lines.isNotEmpty()) {
            "History snapshot returned an empty continuation page. Refresh history."
        }
        history = history.withPage(page.asScrollbackPage())
        oldestLine = page.nextBefore ?: page.rangeStart
        canLoadOlder = page.hasOlder
    }

    fun copyRange(firstLine: Int, lastLine: Int): String = history.copyRange(firstLine, lastLine)

    fun copyLast(count: Int): String = history.copyLast(count)

    fun copyAll(): String = history.copyAll()

    private fun validatedPage(capture: ScrollbackCapture): SnapshotPage {
        require(capture.ok) { capture.error?.message ?: "Scrollback capture failed" }
        val page = SnapshotPage(
            snapshotId = capture.snapshotId?.takeIf(String::isNotBlank)
                ?: throw IllegalArgumentException("History snapshot response is missing its token. Refresh history."),
            rangeStart = capture.rangeStart
                ?: throw IllegalArgumentException("History snapshot response is missing its start. Refresh history."),
            rangeEnd = capture.rangeEnd
                ?: throw IllegalArgumentException("History snapshot response is missing its end. Refresh history."),
            hasOlder = capture.hasOlder
                ?: throw IllegalArgumentException("History snapshot response is missing its cursor state. Refresh history."),
            lineCount = capture.lineCount
                ?: throw IllegalArgumentException("History snapshot response is missing its line count. Refresh history."),
            captureMode = capture.captureMode
                ?: throw IllegalArgumentException("History snapshot response is missing its mode. Refresh history."),
            totalLines = capture.totalLines
                ?: throw IllegalArgumentException("History snapshot response is missing its total. Refresh history."),
            sourceTotalLines = capture.sourceTotalLines
                ?: throw IllegalArgumentException("History snapshot response is missing its source total. Refresh history."),
            snapshotTruncated = capture.snapshotTruncated
                ?: throw IllegalArgumentException("History snapshot response is missing its truncation state. Refresh history."),
            nextBefore = capture.nextBefore,
            lines = capture.lines,
        )
        require(page.captureMode == "snapshot") {
            "History response is not an immutable snapshot. Refresh history."
        }
        require(
            page.rangeStart >= 0 &&
                page.rangeEnd >= page.rangeStart &&
                page.rangeEnd <= page.totalLines
        ) {
            "History snapshot returned an invalid range. Refresh history."
        }
        require(
            page.lineCount == page.lines.size &&
                page.rangeEnd.toLong() - page.rangeStart.toLong() == page.lineCount.toLong()
        ) {
            "History snapshot range does not match its content. Refresh history."
        }
        require(page.lines.size <= ScrollbackRange.MAX_SCROLLBACK_LINES) {
            "History snapshot page exceeds ${ScrollbackRange.MAX_SCROLLBACK_LINES} lines."
        }
        require(page.sourceTotalLines >= page.totalLines) {
            "History snapshot source total is invalid. Refresh history."
        }
        require(page.hasOlder == (page.rangeStart > 0)) {
            "History snapshot returned inconsistent older-page state. Refresh history."
        }
        require(!page.hasOlder || page.nextBefore == page.rangeStart) {
            "History snapshot returned an invalid continuation cursor. Refresh history."
        }
        return page
    }

    private data class SnapshotPage(
        val snapshotId: String,
        val rangeStart: Int,
        val rangeEnd: Int,
        val hasOlder: Boolean,
        val lineCount: Int,
        val captureMode: String,
        val totalLines: Int,
        val sourceTotalLines: Int,
        val snapshotTruncated: Boolean,
        val nextBefore: Int?,
        val lines: List<String>,
    ) {
        fun asHistory(): ScrollbackHistory =
            if (lines.isEmpty()) ScrollbackHistory() else ScrollbackHistory().withPage(asScrollbackPage())

        fun asScrollbackPage(): ScrollbackPage = ScrollbackPage(
            range = ScrollbackRange(rangeStart, rangeEnd - 1),
            contentLines = lines,
        )
    }
}

data class TranscriptEntry(
    val index: Int,
    val type: String?,
    val rawJson: String,
)

data class TranscriptPage(
    val entries: List<TranscriptEntry>,
    val firstEntry: Int,
    val totalEntries: Int,
    val source: String,
) {
    init {
        require(firstEntry >= 0)
        require(totalEntries >= 0)
    }
}

data class TranscriptHistory(
    private val pages: List<TranscriptPage> = emptyList(),
) {
    val entries: List<TranscriptEntry>
        get() = pages
            .flatMap(TranscriptPage::entries)
            .associateBy { it.index }
            .toSortedMap()
            .values
            .toList()

    val beforeEntry: Int?
        get() = pages.minOfOrNull { it.firstEntry }

    val hasOlder: Boolean
        get() = (beforeEntry ?: 0) > 0

    fun withPage(page: TranscriptPage): TranscriptHistory =
        TranscriptHistory((pages.filterNot { it.firstEntry == page.firstEntry } + page).sortedBy { it.firstEntry })

    fun withCapture(capture: TranscriptCapture): TranscriptHistory {
        require(capture.ok) { capture.error?.message ?: "Transcript capture failed" }
        return withPage(
            TranscriptPage(
                entries = capture.entries.map {
                    TranscriptEntry(index = it.index, type = it.type, rawJson = it.rawJson)
                },
                firstEntry = capture.firstEntry,
                totalEntries = capture.totalEntries,
                source = capture.source.orEmpty(),
            ),
        )
    }

    fun filtered(query: String): List<TranscriptEntry> {
        val normalized = query.trim().lowercase(Locale.ROOT)
        return if (normalized.isEmpty()) entries else entries.filter {
            it.rawJson.lowercase(Locale.ROOT).contains(normalized)
        }
    }
}
