/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.terminal

import org.junit.Assert.assertEquals
import org.junit.Test

class TerminalScrollRoutingTest {
    @Test
    fun `normal history stays local while alternate screen scroll requires control`() {
        assertEquals(
            TerminalScrollRoute.LOCAL_HISTORY,
            resolveTerminalScrollRoute(alternateScreen = false, hasControl = false),
        )
        assertEquals(
            TerminalScrollRoute.REMOTE_NAVIGATION,
            resolveTerminalScrollRoute(alternateScreen = true, hasControl = true),
        )
        assertEquals(
            TerminalScrollRoute.REMOTE_NAVIGATION,
            resolveTerminalScrollRoute(
                alternateScreen = false,
                mouseTracking = true,
                hasControl = true,
            ),
        )
        assertEquals(
            TerminalScrollRoute.BLOCKED,
            resolveTerminalScrollRoute(alternateScreen = true, hasControl = false),
        )
    }
}
