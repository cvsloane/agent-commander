/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.terminal

import org.junit.Assert.assertEquals
import org.junit.Test

class TerminalKeyEncoderTest {
    @Test
    fun `practical rail keys encode to terminal control sequences`() {
        assertEquals("\u001b", TerminalKeyEncoder.encode(TerminalKey.ESCAPE))
        assertEquals("\t", TerminalKeyEncoder.encode(TerminalKey.TAB))
        assertEquals("\u001b[Z", TerminalKeyEncoder.encode(TerminalKey.SHIFT_TAB))
        assertEquals("\u001b[A", TerminalKeyEncoder.encode(TerminalKey.UP))
        assertEquals("\u001b[B", TerminalKeyEncoder.encode(TerminalKey.DOWN))
        assertEquals("\u001b[D", TerminalKeyEncoder.encode(TerminalKey.LEFT))
        assertEquals("\u001b[C", TerminalKeyEncoder.encode(TerminalKey.RIGHT))
        assertEquals("\u001b[5~", TerminalKeyEncoder.encode(TerminalKey.PAGE_UP))
        assertEquals("\u001b[6~", TerminalKeyEncoder.encode(TerminalKey.PAGE_DOWN))
        assertEquals("\u001b[H", TerminalKeyEncoder.encode(TerminalKey.HOME))
        assertEquals("\u001b[F", TerminalKeyEncoder.encode(TerminalKey.END))
        assertEquals("\r", TerminalKeyEncoder.encode(TerminalKey.ENTER))
    }

    @Test
    fun `application cursor mode and configured tmux prefixes encode predictably`() {
        assertEquals("\u001bOA", TerminalKeyEncoder.encode(TerminalKey.UP, applicationCursorMode = true))
        assertEquals("\u001bOH", TerminalKeyEncoder.encode(TerminalKey.HOME, applicationCursorMode = true))
        assertEquals("\u0002", TerminalKeyEncoder.tmuxPrefix("C-b"))
        assertEquals("\u0001", TerminalKeyEncoder.tmuxPrefix("ctrl+a"))
        assertEquals("\u001b", TerminalKeyEncoder.tmuxPrefix("^["))
        assertEquals("custom", TerminalKeyEncoder.tmuxPrefix("custom"))
    }
}
