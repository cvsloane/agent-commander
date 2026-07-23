/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.Host
import com.heaviside.agentcommand.data.TmuxPane
import com.heaviside.agentcommand.data.TmuxSnapshot
import com.heaviside.agentcommand.data.Topology
import com.heaviside.agentcommand.data.TmuxTopologyEvent
import com.heaviside.agentcommand.data.TmuxTopologyPane
import com.heaviside.agentcommand.data.TmuxTopologySession
import com.heaviside.agentcommand.data.TmuxTopologyWindow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TmuxRosterTest {
    @Test
    fun `groups the global roster deterministically by host session window and pane`() {
        val topology = Topology(
            hosts = listOf(
                Host("host-b", "Beta"),
                Host("host-a", "Alpha"),
            ),
            panes = listOf(
                pane("session-3", "host-b", "Beta", "agents", "review", 2, 1, "%31"),
                pane("session-2", "host-a", "Alpha", "vault", "shell", 1, 1, "%21"),
                pane("session-1", "host-a", "Alpha", "vault", "shell", 1, 0, "%20"),
            ),
        )

        val roster = TmuxRoster.from(topology)

        assertEquals(listOf("Alpha", "Beta"), roster.hosts.map { it.host.name })
        assertEquals(listOf("vault"), roster.hosts.first().sessions.map { it.name })
        assertEquals(listOf(1), roster.hosts.first().sessions.first().windows.map { it.index })
        assertEquals(
            listOf("%20", "%21"),
            roster.hosts.first().sessions.first().windows.first().panes.map { it.pane.paneId },
        )
        assertEquals("session-1", roster.findPane("host-a", "%20")?.sessionId)
    }

    @Test
    fun `search and filters preserve matching ancestor hierarchy and snapshot context`() {
        val matching = pane("session-1", "host-a", "Alpha", "vault", "code", 1, 0, "%20")
            .copy(
                provider = "claude",
                latestSnapshot = TmuxSnapshot(
                    createdAt = "2026-07-23T12:00:00Z",
                    captureText = "Release verification is ready",
                    captureHash = "snapshot-hash",
                ),
            )
        val roster = TmuxRoster.from(
            Topology(
                hosts = listOf(Host("host-a", "Alpha", online = true), Host("host-b", "Beta")),
                panes = listOf(
                    matching,
                    pane("session-2", "host-b", "Beta", "agents", "shell", 0, 0, "%30"),
                ),
            ),
        )

        val filtered = roster.filtered(
            RosterFilter(query = "release ready", providers = setOf("CLAUDE"), onlineOnly = true),
        )

        assertEquals(listOf("Alpha"), filtered.hosts.map { it.host.name })
        assertEquals(listOf("vault"), filtered.hosts.single().sessions.map { it.name })
        assertEquals(listOf("%20"), filtered.panes.map { it.paneId })
        assertEquals("Release verification is ready", filtered.panes.single().latestSnapshot?.captureText)
    }

    @Test
    fun `a restored target is accepted only when every stable coordinate still matches`() {
        val roster = TmuxRoster.from(
            Topology(
                hosts = listOf(Host("host-a", "Alpha")),
                panes = listOf(pane("session-1", "host-a", "Alpha", "vault", "code", 1, 0, "%20")),
            ),
        )
        val valid = ValidatedTmuxTarget("host-a", "session-1", "%20", "vault:1.0", 1)
        val stale = valid.copy(paneId = "%99")

        assertEquals("session-1", roster.resolve(valid)?.sessionId)
        assertEquals(null, roster.resolve(stale))
    }

    @Test
    fun `live topology enriches roster activity without replacing pane status or snapshot metadata`() {
        val rosterPane = pane("session-1", "host-a", "Alpha", "vault", "code", 1, 0, "%20")
            .copy(
                status = "WAITING_FOR_INPUT",
                latestSnapshot = TmuxSnapshot("2026-07-23T12:00:00Z", "Keep this preview", "hash"),
            )
        val roster = TmuxRoster.from(
            Topology(listOf(Host("host-a", "Alpha")), listOf(rosterPane)),
        )

        val enriched = roster.withTopology(
            TmuxTopologyEvent(
                timestamp = "2026-07-23T12:01:00Z",
                hostId = "host-a",
                reason = "poll",
                sessions = listOf(
                    TmuxTopologySession(
                        name = "vault",
                        attached = true,
                        attachedClients = 2,
                        windows = listOf(
                            TmuxTopologyWindow(
                                index = 1,
                                name = "code",
                                active = true,
                                zoomed = true,
                                layout = "layout",
                                bell = true,
                                activity = true,
                                panes = listOf(
                                    TmuxTopologyPane(
                                        paneId = "%20",
                                        index = 0,
                                        active = true,
                                        width = 120,
                                        height = 40,
                                        title = "Live title",
                                        currentCommand = "claude",
                                        currentPath = "/home/cvsloane/SloaneVault",
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
            ),
        )

        val window = enriched.hosts.single().sessions.single().windows.single()
        assertTrue(window.active == true && window.zoomed == true && window.bell == true)
        assertEquals(2, enriched.hosts.single().sessions.single().attachedClients)
        assertEquals(true, window.panes.single().active)
        assertEquals("WAITING_FOR_INPUT", window.panes.single().pane.status)
        assertEquals("Keep this preview", window.panes.single().pane.latestSnapshot?.captureText)
    }

    private fun pane(
        sessionId: String,
        hostId: String,
        hostName: String,
        tmuxSessionName: String,
        windowName: String,
        windowIndex: Int,
        paneIndex: Int,
        paneId: String,
    ) = TmuxPane(
        sessionId = sessionId,
        hostId = hostId,
        hostName = hostName,
        title = "$tmuxSessionName-$paneId",
        status = "RUNNING",
        provider = "codex",
        paneId = paneId,
        target = "$tmuxSessionName:$windowIndex.$paneIndex",
        tmuxSessionName = tmuxSessionName,
        windowName = windowName,
        windowIndex = windowIndex,
        paneIndex = paneIndex,
    )
}
