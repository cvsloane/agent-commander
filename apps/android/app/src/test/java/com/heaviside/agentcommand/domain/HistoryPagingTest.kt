/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.ScrollbackCapture
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class HistoryPagingTest {
    @Test
    fun `scrollback pages remain ordered and support deterministic filter and contiguous copy`() {
        val newestRange = ScrollbackRange.initial(pageLines = 3)
        val olderRange = newestRange.older(pageLines = 3)
        val history = ScrollbackHistory()
            .withPage(ScrollbackPage(newestRange, listOf("new-1", "new-2", "new-3")))
            .withPage(ScrollbackPage(olderRange, listOf("old-1", "old-2", "old-3")))

        assertEquals(-6, olderRange.startLine)
        assertEquals(-4, olderRange.endLine)
        assertEquals(
            listOf("old-1", "old-2", "old-3", "new-1", "new-2", "new-3"),
            history.lines.map { it.text },
        )
        assertEquals(listOf("old-1", "old-2", "old-3"), history.filtered("OLD").map { it.text })
        assertEquals("old-3\nnew-1\nnew-2", history.copyRange(-4, -2))
        assertEquals("new-2\nnew-3", history.copyLast(2))
    }

    @Test
    fun `transcript pages prepend by entry index and expose the next older cursor`() {
        val history = TranscriptHistory()
            .withPage(
                TranscriptPage(
                    entries = listOf(
                        TranscriptEntry(2, "assistant", """{"type":"assistant","text":"new answer"}"""),
                        TranscriptEntry(3, "user", """{"type":"user","text":"new question"}"""),
                    ),
                    firstEntry = 2,
                    totalEntries = 4,
                    source = "hook",
                ),
            )
            .withPage(
                TranscriptPage(
                    entries = listOf(
                        TranscriptEntry(0, "user", """{"type":"user","text":"old question"}"""),
                        TranscriptEntry(1, "assistant", """{"type":"assistant","text":"old answer"}"""),
                    ),
                    firstEntry = 0,
                    totalEntries = 4,
                    source = "hook",
                ),
            )

        assertEquals(listOf(0, 1, 2, 3), history.entries.map { it.index })
        assertEquals(listOf(0, 1), history.filtered("old").map { it.index })
        assertEquals(0, history.beforeEntry)
        assertEquals(false, history.hasOlder)
    }

    @Test
    fun `reader pages backward from live history and searches locally without reordering`() {
        val reader = ScrollbackReaderState(pageLines = 2)

        assertEquals(ScrollbackRange(-2, -1), reader.nextRange)
        reader.accept(
            reader.nextRange!!,
            ScrollbackCapture("new", true, listOf("compile passed", "release ready"), false),
        )
        assertEquals(ScrollbackRange(-4, -3), reader.nextRange)
        reader.accept(
            reader.nextRange!!,
            ScrollbackCapture("old", true, listOf("older note", "compile started"), false),
        )
        reader.query = "compile"

        assertEquals(
            listOf("compile started", "compile passed"),
            reader.visibleLines.map { it.text },
        )

        reader.accept(
            reader.nextRange!!,
            ScrollbackCapture("end", true, emptyList(), false),
        )
        assertFalse(reader.canLoadOlder)
        assertEquals(null, reader.nextRange)
    }

    @Test
    fun `reader accepts one stable full snapshot without offering moving-offset pagination`() {
        val reader = ScrollbackReaderState(pageLines = 2)

        reader.acceptSnapshot(
            ScrollbackCapture(
                cmdId = "snapshot",
                ok = true,
                lines = listOf("oldest available", "middle", "current"),
                truncated = true,
            ),
        )

        assertEquals(listOf("oldest available", "middle", "current"), reader.allLines.map { it.text })
        assertFalse(reader.canLoadOlder)
        assertEquals(null, reader.nextRange)
    }
}
