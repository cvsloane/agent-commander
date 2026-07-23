/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.ScrollbackCapture
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

    fun older(pageLines: Int = DEFAULT_PAGE_LINES): ScrollbackRange {
        require(pageLines in 1..MAX_SCROLLBACK_LINES)
        val olderEnd = startLine - 1
        return ScrollbackRange(olderEnd - pageLines + 1, olderEnd)
    }

    companion object {
        const val DEFAULT_PAGE_LINES = 500
        const val MAX_SCROLLBACK_LINES = 5_000

        fun initial(pageLines: Int = DEFAULT_PAGE_LINES): ScrollbackRange {
            require(pageLines in 1..MAX_SCROLLBACK_LINES)
            return ScrollbackRange(-pageLines, -1)
        }
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
        get() = pages
            .flatMap(ScrollbackPage::numberedLines)
            .associateBy { it.lineNumber }
            .toSortedMap()
            .values
            .toList()

    fun withPage(page: ScrollbackPage): ScrollbackHistory =
        ScrollbackHistory((pages.filterNot { it.range == page.range } + page).sortedBy { it.range.startLine })

    fun withCapture(range: ScrollbackRange, capture: ScrollbackCapture): ScrollbackHistory {
        require(capture.ok) { capture.error?.message ?: "Scrollback capture failed" }
        return withPage(ScrollbackPage(range, capture.lines))
    }

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
