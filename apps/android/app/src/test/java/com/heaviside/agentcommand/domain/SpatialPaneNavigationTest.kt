/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SpatialPaneNavigationTest {
    private val panes = listOf(
        TmuxPaneNode("%0", 0),
        TmuxPaneNode("%1", 1),
        TmuxPaneNode("%2", 2),
    )
    private val layout =
        "abcd,120x40,0,0{59x40,0,0,0,60x40,60,0[60x19,60,0,1,60x20,60,20,2]}"

    @Test
    fun `parses tmux leaves and selects the nearest overlapping half-plane`() {
        assertEquals(
            listOf(
                PaneRectangle("%0", 0, 0, 59, 40),
                PaneRectangle("%1", 60, 0, 60, 19),
                PaneRectangle("%2", 60, 20, 60, 20),
            ),
            parseTmuxWindowLayout(layout).values.toList(),
        )

        val targets = resolveDirectionalPaneTargets(panes, "%1", layout)
        assertEquals("%0", targets.getValue(PaneDirection.LEFT)?.paneId)
        assertEquals("%2", targets.getValue(PaneDirection.DOWN)?.paneId)
        assertNull(targets.getValue(PaneDirection.UP))
        assertNull(targets.getValue(PaneDirection.RIGHT))
    }

    @Test
    fun `incomplete layouts fall back to pane index neighbors without wrapping`() {
        val incomplete = "abcd,120x40,0,0{59x40,0,0,0,60x40,60,0,1}"
        val middle = resolveDirectionalPaneTargets(panes, "%1", incomplete)
        assertEquals("%0", middle.getValue(PaneDirection.LEFT)?.paneId)
        assertEquals("%0", middle.getValue(PaneDirection.UP)?.paneId)
        assertEquals("%2", middle.getValue(PaneDirection.DOWN)?.paneId)
        assertEquals("%2", middle.getValue(PaneDirection.RIGHT)?.paneId)

        val first = resolveDirectionalPaneTargets(panes, "%0", "")
        assertNull(first.getValue(PaneDirection.LEFT))
        assertNull(first.getValue(PaneDirection.UP))
        val last = resolveDirectionalPaneTargets(panes, "%2", "")
        assertNull(last.getValue(PaneDirection.DOWN))
        assertNull(last.getValue(PaneDirection.RIGHT))
    }
}
