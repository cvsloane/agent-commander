/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.terminal

enum class TerminalKey {
    ESCAPE,
    TAB,
    SHIFT_TAB,
    UP,
    DOWN,
    LEFT,
    RIGHT,
    PAGE_UP,
    PAGE_DOWN,
    HOME,
    END,
    ENTER,
}

object TerminalKeyEncoder {
    fun encode(key: TerminalKey, applicationCursorMode: Boolean = false): String = when (key) {
        TerminalKey.ESCAPE -> "\u001b"
        TerminalKey.TAB -> "\t"
        TerminalKey.SHIFT_TAB -> "\u001b[Z"
        TerminalKey.UP -> if (applicationCursorMode) "\u001bOA" else "\u001b[A"
        TerminalKey.DOWN -> if (applicationCursorMode) "\u001bOB" else "\u001b[B"
        TerminalKey.RIGHT -> if (applicationCursorMode) "\u001bOC" else "\u001b[C"
        TerminalKey.LEFT -> if (applicationCursorMode) "\u001bOD" else "\u001b[D"
        TerminalKey.PAGE_UP -> "\u001b[5~"
        TerminalKey.PAGE_DOWN -> "\u001b[6~"
        TerminalKey.HOME -> if (applicationCursorMode) "\u001bOH" else "\u001b[H"
        TerminalKey.END -> if (applicationCursorMode) "\u001bOF" else "\u001b[F"
        TerminalKey.ENTER -> "\r"
    }

    fun tmuxPrefix(configured: String): String {
        val trimmed = configured.trim()
        val controlCharacter = when {
            trimmed.matches(Regex("(?i)c-[a-z@\\[\\\\\\]\\^_]")) -> trimmed.last()
            trimmed.matches(Regex("(?i)ctrl\\+[a-z@\\[\\\\\\]\\^_]")) -> trimmed.last()
            trimmed.matches(Regex("\\^[@a-zA-Z\\[\\\\\\]\\^_]")) -> trimmed.last()
            else -> return configured
        }
        return controlCode(controlCharacter.code)?.toString() ?: configured
    }

    internal fun controlCode(codePoint: Int): Char? = when (codePoint) {
        in 'a'.code..'z'.code -> (codePoint - 'a'.code + 1).toChar()
        in 'A'.code..'Z'.code -> (codePoint - 'A'.code + 1).toChar()
        '@'.code -> 0.toChar()
        '['.code -> 27.toChar()
        '\\'.code -> 28.toChar()
        ']'.code -> 29.toChar()
        '^'.code -> 30.toChar()
        '_'.code -> 31.toChar()
        else -> null
    }
}
