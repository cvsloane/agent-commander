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
    val online: Boolean = false,
    val lastHeartbeatAt: String? = null,
    val lastSeenAt: String? = null,
    val agentVersion: String? = null,
    val capabilities: HostCapabilities = HostCapabilities(),
)

data class HostCapabilities(
    val tmux: Boolean = false,
    val terminal: Boolean = false,
    val spawn: Boolean = false,
    val kill: Boolean = false,
)

data class TmuxSnapshot(
    val createdAt: String,
    val captureText: String,
    val captureHash: String,
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
    val cwd: String? = null,
    val repoRoot: String? = null,
    val gitBranch: String? = null,
    val attentionReason: String? = null,
    val statusDetail: String? = null,
    val lastActivityAt: String? = null,
    val updatedAt: String? = null,
    val unmanaged: Boolean? = null,
    val currentCommand: String? = null,
    val panePid: Long? = null,
    val latestSnapshot: TmuxSnapshot? = null,
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
