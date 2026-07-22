/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.data

data class SavedCredentials(
    val endpoint: String,
    val accessCode: String,
) {
    override fun toString(): String =
        "SavedCredentials(endpoint=$endpoint, accessCode=<redacted>)"
}

data class Host(
    val id: String,
    val name: String,
)

data class TmuxPane(
    val sessionId: String,
    val hostId: String,
    val hostName: String,
    val title: String,
    val status: String,
    val provider: String,
    val paneId: String,
    val target: String,
    val tmuxSessionName: String,
    val windowName: String,
    val windowIndex: Int,
    val paneIndex: Int,
) {
    fun rosterLabel(): String = buildString {
        append(hostName)
        append("  ·  ")
        append(tmuxSessionName)
        append(':')
        append(windowIndex)
        append('.')
        append(paneIndex)
        append("\n")
        append(title)
        append("  ·  ")
        append(status.lowercase())
    }
}

data class Topology(
    val hosts: List<Host>,
    val panes: List<TmuxPane>,
)

data class NavigationResult(
    val requestId: String,
    val ok: Boolean,
    val paneId: String?,
    val windowIndex: Int?,
    val zoomed: Boolean?,
    val message: String?,
)
