/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import org.junit.Assert.assertEquals
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
}
