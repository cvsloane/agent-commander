/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.data

sealed interface UiStreamEvent {
    val timestamp: String
}

data class CommandResultEvent(
    override val timestamp: String,
    val hostId: String,
    val cmdId: String,
    val sessionId: String?,
    val ok: Boolean,
    val resultJson: String? = null,
    val error: ApiError? = null,
) : UiStreamEvent

data class TmuxTopologyEvent(
    override val timestamp: String,
    val hostId: String,
    val reason: String,
    val sessions: List<TmuxTopologySession>,
) : UiStreamEvent

data class TmuxTopologySession(
    val name: String,
    val attached: Boolean,
    val attachedClients: Int?,
    val windows: List<TmuxTopologyWindow>,
)

data class TmuxTopologyWindow(
    val index: Int,
    val name: String,
    val active: Boolean,
    val zoomed: Boolean,
    val layout: String,
    val bell: Boolean,
    val activity: Boolean,
    val panes: List<TmuxTopologyPane>,
)

data class TmuxTopologyPane(
    val paneId: String,
    val index: Int,
    val active: Boolean,
    val width: Int,
    val height: Int,
    val title: String,
    val currentCommand: String,
    val currentPath: String,
)
