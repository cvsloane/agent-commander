/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.Host
import com.heaviside.agentcommand.data.TmuxPane
import com.heaviside.agentcommand.data.TmuxTopologyEvent
import com.heaviside.agentcommand.data.Topology
import java.util.Locale

data class TmuxRoster(
    val hosts: List<TmuxHostNode>,
) {
    val panes: List<TmuxPane>
        get() = hosts.flatMap { host ->
            host.sessions.flatMap { session ->
                session.windows.flatMap { window -> window.panes.mapNotNull { it.pane } }
            }
        }

    fun findPane(hostId: String, paneId: String): TmuxPane? =
        hosts.firstOrNull { it.host.id == hostId }
            ?.sessions
            ?.asSequence()
            ?.flatMap { it.windows.asSequence() }
            ?.flatMap { it.panes.asSequence() }
            ?.firstOrNull { it.paneId == paneId }
            ?.pane

    fun resolve(target: ValidatedTmuxTarget): TmuxPane? =
        findPane(target.hostId, target.paneId)?.takeIf {
            it.sessionId == target.sessionId && it.target == target.tmuxTarget
        }

    fun withTopology(event: TmuxTopologyEvent): TmuxRoster = copy(
        hosts = hosts.map { host ->
            if (host.host.id != event.hostId) {
                return@map host
            }
            val durablePanes = host.sessions
                .flatMap { it.windows }
                .flatMap { it.panes }
                .mapNotNull { it.pane }
                .associateBy { it.paneId }
            host.copy(
                sessions = event.sessions
                    .sortedWith(compareBy({ it.name.lowercase(Locale.ROOT) }, { it.name }))
                    .map { liveSession ->
                        TmuxSessionNode(
                            name = liveSession.name,
                            attached = liveSession.attached,
                            attachedClients = liveSession.attachedClients,
                            windows = liveSession.windows
                                .sortedWith(compareBy({ it.index }, { it.name }))
                                .map { liveWindow ->
                                    TmuxWindowNode(
                                        index = liveWindow.index,
                                        name = liveWindow.name,
                                        active = liveWindow.active,
                                        zoomed = liveWindow.zoomed,
                                        layout = liveWindow.layout,
                                        bell = liveWindow.bell,
                                        activity = liveWindow.activity,
                                        panes = liveWindow.panes
                                            .sortedWith(compareBy({ it.index }, { it.paneId }))
                                            .map { livePane ->
                                                TmuxPaneNode(
                                                    paneId = livePane.paneId,
                                                    paneIndex = livePane.index,
                                                    pane = durablePanes[livePane.paneId],
                                                    active = livePane.active,
                                                    width = livePane.width,
                                                    height = livePane.height,
                                                    liveTitle = livePane.title,
                                                    currentCommand = livePane.currentCommand,
                                                    currentPath = livePane.currentPath,
                                                )
                                            },
                                    )
                                },
                        )
                    },
            )
        },
    )

    fun filtered(filter: RosterFilter): TmuxRoster {
        val terms = filter.query
            .trim()
            .lowercase(Locale.ROOT)
            .split(Regex("\\s+"))
            .filter { it.isNotEmpty() }
        val providers = filter.providers.mapTo(mutableSetOf()) { it.lowercase(Locale.ROOT) }
        val statuses = filter.statuses.mapTo(mutableSetOf()) { it.lowercase(Locale.ROOT) }

        return TmuxRoster(
            hosts.mapNotNull { hostNode ->
                if (filter.onlineOnly && !hostNode.host.online) return@mapNotNull null
                if (filter.hostIds.isNotEmpty() && hostNode.host.id !in filter.hostIds) return@mapNotNull null
                val sessions = hostNode.sessions.mapNotNull { session ->
                    val windows = session.windows.mapNotNull { window ->
                        val panes = window.panes.filter { paneNode ->
                            val pane = paneNode.pane
                            val providerMatches =
                                providers.isEmpty() ||
                                    pane?.provider?.lowercase(Locale.ROOT) in providers
                            val statusMatches =
                                statuses.isEmpty() ||
                                    pane?.status?.lowercase(Locale.ROOT) in statuses
                            providerMatches && statusMatches &&
                                matchesTerms(terms, hostNode.host, session, window, paneNode)
                        }
                        window.copy(panes = panes).takeIf { panes.isNotEmpty() }
                    }
                    session.copy(windows = windows).takeIf { windows.isNotEmpty() }
                }
                val hostOnlyMatch = hostNode.sessions.isEmpty() &&
                    providers.isEmpty() &&
                    statuses.isEmpty() &&
                    terms.all { term ->
                        hostNode.host.name.lowercase(Locale.ROOT).contains(term) ||
                            hostNode.host.id.lowercase(Locale.ROOT).contains(term)
                    }
                hostNode.copy(sessions = sessions).takeIf { sessions.isNotEmpty() || hostOnlyMatch }
            },
        )
    }

    companion object {
        fun from(topology: Topology): TmuxRoster {
            val panesByHost = topology.panes.groupBy { it.hostId }
            val knownHostIds = topology.hosts.mapTo(mutableSetOf()) { it.id }
            val inferredHosts = topology.panes
                .filterNot { it.hostId in knownHostIds }
                .map { Host(it.hostId, it.hostName) }
                .distinctBy { it.id }
            val hosts = (topology.hosts + inferredHosts)
                .sortedWith(compareBy<Host>({ it.name.lowercase(Locale.ROOT) }, { it.id }))
                .map { host -> TmuxHostNode(host, groupSessions(panesByHost[host.id].orEmpty())) }
            return TmuxRoster(hosts)
        }

        private fun groupSessions(panes: List<TmuxPane>): List<TmuxSessionNode> =
            panes.groupBy { it.tmuxSessionName }
                .toSortedMap(compareBy<String>({ it.lowercase(Locale.ROOT) }, { it }))
                .map { (sessionName, sessionPanes) ->
                    TmuxSessionNode(
                        name = sessionName,
                        windows = sessionPanes.groupBy { it.windowIndex }
                            .toSortedMap()
                            .map { (windowIndex, windowPanes) ->
                                TmuxWindowNode(
                                    index = windowIndex,
                                    name = windowPanes
                                        .sortedWith(compareBy<TmuxPane>({ it.paneIndex }, { it.paneId }))
                                        .first()
                                        .windowName,
                                    panes = windowPanes
                                        .sortedWith(compareBy<TmuxPane>({ it.paneIndex }, { it.paneId }))
                                        .map {
                                            TmuxPaneNode(
                                                paneId = it.paneId,
                                                paneIndex = it.paneIndex,
                                                pane = it,
                                            )
                                        },
                                )
                            },
                    )
                }

        private fun matchesTerms(
            terms: List<String>,
            host: Host,
            session: TmuxSessionNode,
            window: TmuxWindowNode,
            paneNode: TmuxPaneNode,
        ): Boolean {
            if (terms.isEmpty()) return true
            val pane = paneNode.pane
            val searchable = listOfNotNull(
                host.name,
                host.id,
                session.name,
                window.name,
                window.index.toString(),
                paneNode.paneId,
                paneNode.paneIndex.toString(),
                paneNode.liveTitle,
                paneNode.currentCommand,
                paneNode.currentPath,
                pane?.sessionId,
                pane?.title,
                pane?.status,
                pane?.provider,
                pane?.target,
                pane?.cwd,
                pane?.repoRoot,
                pane?.gitBranch,
                pane?.attentionReason,
                pane?.statusDetail,
                pane?.currentCommand,
                pane?.latestSnapshot?.captureText,
            ).joinToString("\n").lowercase(Locale.ROOT)
            return terms.all(searchable::contains)
        }
    }
}

data class RosterFilter(
    val query: String = "",
    val hostIds: Set<String> = emptySet(),
    val providers: Set<String> = emptySet(),
    val statuses: Set<String> = emptySet(),
    val onlineOnly: Boolean = false,
)

data class TmuxHostNode(
    val host: Host,
    val sessions: List<TmuxSessionNode>,
)

data class TmuxSessionNode(
    val name: String,
    val windows: List<TmuxWindowNode>,
    val attached: Boolean? = null,
    val attachedClients: Int? = null,
)

data class TmuxWindowNode(
    val index: Int,
    val name: String,
    val panes: List<TmuxPaneNode>,
    val active: Boolean? = null,
    val zoomed: Boolean? = null,
    val layout: String? = null,
    val bell: Boolean? = null,
    val activity: Boolean? = null,
)

data class TmuxPaneNode(
    val paneId: String,
    val paneIndex: Int,
    val pane: TmuxPane? = null,
    val active: Boolean? = null,
    val width: Int? = null,
    val height: Int? = null,
    val liveTitle: String? = null,
    val currentCommand: String? = null,
    val currentPath: String? = null,
) {
    val attachable: Boolean
        get() = pane != null
}
