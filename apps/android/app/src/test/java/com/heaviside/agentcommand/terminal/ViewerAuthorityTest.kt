/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.terminal

import com.heaviside.agentcommand.data.NavigationResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ViewerAuthorityTest {
    @Test
    fun `lost focus acknowledgement reconciles through correlated viewer state`() {
        val authority = ViewerAuthority()
        val expected = ViewerTarget("%7", zoomed = true)

        authority.connecting(expected)
        authority.attached(readOnly = true)
        authority.beginFocus("focus-1")

        assertTrue(authority.beginViewerStateReconciliation("focus-1", "state-1"))
        assertEquals(
            ViewerResolution.Converged(expected),
            authority.resolve(
                NavigationResult(
                    requestId = "state-1",
                    ok = true,
                    paneId = "%7",
                    windowIndex = 2,
                    zoomed = true,
                    message = null,
                ),
            ),
        )
        assertEquals(expected, authority.authoritativeTarget)
        assertFalse(authority.canSendInput)

        assertTrue(authority.controllerChanged(paneId = "%7", hasControl = true))
        assertTrue(authority.canSendInput)
    }

    @Test
    fun `reconciled viewer state must match both pane and zoom`() {
        val authority = ViewerAuthority()
        val expected = ViewerTarget("%7", zoomed = true)

        authority.connecting(expected)
        authority.attached(readOnly = false)
        authority.beginFocus("focus-1")
        assertTrue(authority.beginViewerStateReconciliation("focus-1", "state-1"))

        assertEquals(
            ViewerResolution.Failed("Pane focus timed out; viewer is on %8 with zoom off."),
            authority.resolve(
                NavigationResult(
                    requestId = "state-1",
                    ok = true,
                    paneId = "%8",
                    windowIndex = 2,
                    zoomed = false,
                    message = null,
                ),
            ),
        )
        assertEquals(ViewerTarget("%8", zoomed = false), authority.authoritativeTarget)
        assertFalse(authority.canSendInput)
    }

    @Test
    fun `control status only unlocks input for the authoritative pane`() {
        val authority = ViewerAuthority()

        authority.connecting(ViewerTarget("%7", zoomed = false))
        authority.attached(readOnly = false)
        authority.beginFocus("focus-1", ViewerTarget("%8", zoomed = false))

        assertFalse(authority.controllerChanged(paneId = "%7", hasControl = true))
        assertTrue(authority.controllerChanged(paneId = "%8", hasControl = true))
        assertFalse(authority.canSendInput)
        assertEquals(
            ViewerResolution.Converged(ViewerTarget("%8", zoomed = false)),
            authority.resolve(
                NavigationResult(
                    requestId = "focus-1",
                    ok = true,
                    paneId = "%8",
                    windowIndex = 2,
                    zoomed = false,
                    message = null,
                ),
            ),
        )
        assertTrue(authority.canSendInput)
        assertFalse(authority.controllerChanged(paneId = "%7", hasControl = false))
        assertTrue(authority.canSendInput)
    }
}
