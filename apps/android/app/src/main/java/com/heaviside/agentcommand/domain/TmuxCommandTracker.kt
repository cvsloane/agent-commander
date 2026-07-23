/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.ApiError
import com.heaviside.agentcommand.data.CommandDispatchAcceptance
import com.heaviside.agentcommand.data.CommandResultEvent
import com.heaviside.agentcommand.data.TmuxTopologyEvent

enum class TmuxCommandTruth {
    COMMAND_RESULT,
    TOPOLOGY,
}

sealed interface TmuxCommandState {
    val cmdId: String

    data class Pending(
        override val cmdId: String,
        val hostId: String,
        val sessionId: String,
    ) : TmuxCommandState

    data class Succeeded(
        override val cmdId: String,
        val source: TmuxCommandTruth,
        val resultJson: String? = null,
    ) : TmuxCommandState

    data class Failed(
        override val cmdId: String,
        val error: ApiError,
    ) : TmuxCommandState
}

sealed interface TopologyExpectation {
    fun matches(event: TmuxTopologyEvent): Boolean

    data class PanePresent(val paneId: String) : TopologyExpectation {
        override fun matches(event: TmuxTopologyEvent): Boolean =
            event.sessions.any { session ->
                session.windows.any { window -> window.panes.any { it.paneId == paneId } }
            }
    }

    data class PaneAbsent(val paneId: String) : TopologyExpectation {
        override fun matches(event: TmuxTopologyEvent): Boolean =
            event.sessions.none { session ->
                session.windows.any { window -> window.panes.any { it.paneId == paneId } }
            }
    }

    data class WindowPresent(
        val sessionName: String,
        val windowIndex: Int,
        val name: String? = null,
    ) : TopologyExpectation {
        override fun matches(event: TmuxTopologyEvent): Boolean =
            event.sessions.firstOrNull { it.name == sessionName }
                ?.windows
                ?.any { it.index == windowIndex && (name == null || it.name == name) } == true
    }

    data class WindowAbsent(
        val sessionName: String,
        val windowIndex: Int,
    ) : TopologyExpectation {
        override fun matches(event: TmuxTopologyEvent): Boolean {
            val session = event.sessions.firstOrNull { it.name == sessionName } ?: return true
            return session.windows.none { it.index == windowIndex }
        }
    }

    data class ActiveWindow(
        val sessionName: String,
        val windowIndex: Int,
    ) : TopologyExpectation {
        override fun matches(event: TmuxTopologyEvent): Boolean =
            event.sessions.firstOrNull { it.name == sessionName }
                ?.windows
                ?.any { it.index == windowIndex && it.active } == true
    }

    data class ActivePane(val paneId: String) : TopologyExpectation {
        override fun matches(event: TmuxTopologyEvent): Boolean =
            event.sessions.any { session ->
                session.windows.any { window ->
                    window.panes.any { it.paneId == paneId && it.active }
                }
            }
    }

    data class WindowZoomed(
        val sessionName: String,
        val windowIndex: Int,
        val zoomed: Boolean,
    ) : TopologyExpectation {
        override fun matches(event: TmuxTopologyEvent): Boolean =
            event.sessions.firstOrNull { it.name == sessionName }
                ?.windows
                ?.any { it.index == windowIndex && it.zoomed == zoomed } == true
    }
}

class TmuxCommandTracker {
    private data class PendingCommand(
        val state: TmuxCommandState.Pending,
        val expectation: TopologyExpectation?,
    )

    private val pending = linkedMapOf<String, PendingCommand>()
    private val earlyResults = linkedMapOf<String, CommandResultEvent>()

    @Synchronized
    fun register(
        acceptance: CommandDispatchAcceptance,
        hostId: String,
        sessionId: String,
        expectation: TopologyExpectation? = null,
    ): TmuxCommandState {
        val command = PendingCommand(
            TmuxCommandState.Pending(acceptance.cmdId, hostId, sessionId),
            expectation,
        )
        val early = earlyResults.remove(acceptance.cmdId)
        if (early != null && correlates(command, early)) return resolve(command, early)
        pending[acceptance.cmdId] = command
        return command.state
    }

    @Synchronized
    fun observe(event: CommandResultEvent): TmuxCommandState? {
        val command = pending[event.cmdId]
        if (command == null) {
            earlyResults[event.cmdId] = event
            while (earlyResults.size > MAX_EARLY_RESULTS) {
                earlyResults.remove(earlyResults.keys.first())
            }
            return null
        }
        if (!correlates(command, event)) return null
        pending.remove(event.cmdId)
        return resolve(command, event)
    }

    @Synchronized
    fun observe(event: TmuxTopologyEvent): List<TmuxCommandState.Succeeded> {
        val completed = pending.values
            .filter {
                it.state.hostId == event.hostId &&
                    it.expectation?.matches(event) == true
            }
            .map {
                TmuxCommandState.Succeeded(it.state.cmdId, TmuxCommandTruth.TOPOLOGY)
            }
        completed.forEach { pending.remove(it.cmdId) }
        return completed
    }

    @Synchronized
    fun pendingCommands(): List<TmuxCommandState.Pending> = pending.values.map { it.state }

    @Synchronized
    fun failPending(error: ApiError): List<TmuxCommandState.Failed> {
        val failed = pending.values.map { TmuxCommandState.Failed(it.state.cmdId, error) }
        pending.clear()
        earlyResults.clear()
        return failed
    }

    private fun correlates(command: PendingCommand, event: CommandResultEvent): Boolean =
        command.state.hostId == event.hostId &&
            (event.sessionId == null || command.state.sessionId == event.sessionId)

    private fun resolve(
        command: PendingCommand,
        event: CommandResultEvent,
    ): TmuxCommandState = if (event.ok) {
        TmuxCommandState.Succeeded(
            command.state.cmdId,
            TmuxCommandTruth.COMMAND_RESULT,
            event.resultJson,
        )
    } else {
        TmuxCommandState.Failed(
            command.state.cmdId,
            event.error ?: ApiError("command_failed", "The tmux command failed"),
        )
    }

    private companion object {
        const val MAX_EARLY_RESULTS = 50
    }
}
