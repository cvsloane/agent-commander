/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import org.json.JSONArray
import org.json.JSONObject

object ClaudeTranscriptFormatter {
    private val skippedEntries = setOf(
        "system",
        "meta",
        "progress",
        "summary",
        "file-history-snapshot",
        "queue-operation",
    )
    private val skippedContent = setOf("thinking", "system", "meta", "progress", "tool_result")

    fun format(entries: List<TranscriptEntry>): String = entries
        .flatMap { formatEntry(it.rawJson) }
        .joinToString("\n")

    private fun formatEntry(raw: String): List<String> {
        val entry = runCatching { JSONObject(raw) }.getOrNull() ?: return listOf(raw)
        val type = entry.optString("type").lowercase()
        if (type in skippedEntries || entry.optBoolean("isMeta") || entry.optBoolean("is_meta")) {
            return emptyList()
        }
        if (type == "tool_use") return listOf(formatTool(entry))
        val message = entry.optJSONObject("message")
        val role = message?.optString("role").orEmpty()
            .ifBlank { entry.optString("role").ifBlank { type } }
            .lowercase()
        val content = message?.opt("content") ?: entry.opt("content")
        return when (role) {
            "user" -> textContent(content).takeIf { it.isNotBlank() }
                ?.lineSequence()
                ?.mapIndexed { index, line -> "${if (index == 0) "❯ " else "  "}$line" }
                ?.toList()
                .orEmpty()
            "assistant" -> assistantContent(content)
            else -> emptyList()
        }
    }

    private fun assistantContent(content: Any?): List<String> {
        if (content is String) return content.lines()
        if (content !is JSONArray) return emptyList()
        return buildList {
            for (index in 0 until content.length()) {
                when (val block = content.opt(index)) {
                    is String -> addAll(block.lines())
                    is JSONObject -> {
                        val type = block.optString("type").lowercase()
                        when {
                            type in skippedContent -> Unit
                            type == "tool_use" -> add(formatTool(block))
                            type == "text" || (type.isBlank() && block.has("text")) ->
                                addAll(block.optString("text").lines())
                        }
                    }
                }
            }
        }
    }

    private fun textContent(content: Any?): String = when (content) {
        is String -> content
        is JSONArray -> buildList {
            for (index in 0 until content.length()) {
                when (val block = content.opt(index)) {
                    is String -> add(block)
                    is JSONObject -> if (block.optString("type") == "text") add(block.optString("text"))
                }
            }
        }.joinToString("\n")
        else -> ""
    }

    private fun formatTool(tool: JSONObject): String {
        val name = tool.optString("name")
            .ifBlank { tool.optString("tool_name") }
            .ifBlank { tool.optString("tool") }
            .ifBlank { "tool" }
        val input = tool.opt("input") ?: tool.opt("tool_input")
        val summary = when (input) {
            is String -> input
            is JSONObject -> listOf("command", "query", "prompt", "path", "pattern", "description", "url")
                .firstNotNullOfOrNull { key -> input.optString(key).takeIf { it.isNotBlank() } }
                ?: input.toString()
            else -> ""
        }.replace(Regex("\\s+"), " ").trim().take(80)
        return "⏺ $name${summary.takeIf { it.isNotBlank() }?.let { " $it" }.orEmpty()}"
    }
}
