/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.ScrollbackCapture
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class HistoryPagingTest {
    @Test
    fun `scrollback pages remain ordered and support deterministic filter and contiguous copy`() {
        val newestRange = ScrollbackRange(3, 5)
        val olderRange = ScrollbackRange(0, 2)
        val history = ScrollbackHistory()
            .withPage(ScrollbackPage(newestRange, listOf("new-1", "new-2", "new-3")))
            .withPage(ScrollbackPage(olderRange, listOf("old-1", "old-2", "old-3")))

        assertEquals(0, olderRange.startLine)
        assertEquals(2, olderRange.endLine)
        assertEquals(
            listOf("old-1", "old-2", "old-3", "new-1", "new-2", "new-3"),
            history.lines.map { it.text },
        )
        assertEquals(listOf("old-1", "old-2", "old-3"), history.filtered("OLD").map { it.text })
        assertEquals("old-3\nnew-1\nnew-2", history.copyRange(2, 4))
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
    fun `reader accepts only contiguous pages from one immutable snapshot`() {
        val reader = ScrollbackReaderState(pageLines = 2)

        reader.acceptInitial(
            snapshotCapture(
                cmdId = "new",
                snapshotId = "snapshot-a",
                start = 2,
                end = 4,
                lines = listOf("compile passed", "release ready"),
                hasOlder = true,
                totalLines = 4,
            ),
        )
        val cursor = reader.nextSnapshotPage!!
        assertEquals("snapshot-a", cursor.snapshotId)
        assertEquals(2, cursor.beforeLine)
        assertEquals("Copy loaded", reader.copyAllLabel)
        reader.acceptOlder(
            cursor,
            snapshotCapture(
                cmdId = "old",
                snapshotId = "snapshot-a",
                start = 0,
                end = 2,
                lines = listOf("older note", "compile started"),
                hasOlder = false,
                totalLines = 4,
            ),
        )
        reader.query = "compile"

        assertEquals(
            listOf("compile started", "compile passed"),
            reader.visibleLines.map { it.text },
        )
        assertEquals("release ready", reader.copyLast(1))
        assertEquals(
            "older note\ncompile started\ncompile passed\nrelease ready",
            reader.copyAll(),
        )
        assertFalse(reader.canLoadOlder)
        assertEquals(null, reader.nextSnapshotPage)
        assertEquals("Copy all", reader.copyAllLabel)
    }

    @Test
    fun `reader rejects token mismatches and gaps without mixing snapshot lines`() {
        val reader = ScrollbackReaderState(pageLines = 2)
        reader.acceptInitial(
            snapshotCapture(
                cmdId = "initial",
                snapshotId = "snapshot-a",
                start = 2,
                end = 3,
                lines = listOf("stable"),
                hasOlder = true,
                totalLines = 3,
            ),
        )
        val cursor = reader.nextSnapshotPage!!

        assertThrows(IllegalArgumentException::class.java) {
            reader.acceptOlder(
                cursor,
                snapshotCapture("wrong-token", "snapshot-b", 0, 2, listOf("wrong", "page"), false, 3),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            reader.acceptOlder(
                cursor,
                snapshotCapture("gap", "snapshot-a", 0, 1, listOf("gap"), false, 3),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            reader.acceptOlder(
                cursor,
                snapshotCapture("overlap", "snapshot-a", 1, 3, listOf("overlap", "stable"), true, 3),
            )
        }

        assertEquals(listOf("stable"), reader.allLines.map { it.text })
        assertEquals(cursor, reader.nextSnapshotPage)
        assertTrue(reader.canLoadOlder)

        reader.acceptInitial(
            snapshotCapture("refresh", "snapshot-b", 0, 1, listOf("refreshed"), false, 1),
        )
        assertEquals(listOf("refreshed"), reader.allLines.map { it.text })
        assertFalse(reader.canLoadOlder)
    }

    private fun snapshotCapture(
        cmdId: String,
        snapshotId: String,
        start: Int,
        end: Int,
        lines: List<String>,
        hasOlder: Boolean,
        totalLines: Int,
    ) = ScrollbackCapture(
        cmdId = cmdId,
        ok = true,
        lines = lines,
        truncated = false,
        snapshotId = snapshotId,
        rangeStart = start,
        rangeEnd = end,
        hasOlder = hasOlder,
        lineCount = lines.size,
        captureMode = "snapshot",
        totalLines = totalLines,
        sourceTotalLines = totalLines,
        snapshotTruncated = false,
        nextBefore = start.takeIf { hasOlder },
    )
}
