/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.terminal

enum class TerminalScrollRoute {
    LOCAL_HISTORY,
    REMOTE_NAVIGATION,
    BLOCKED,
}

fun resolveTerminalScrollRoute(
    alternateScreen: Boolean,
    mouseTracking: Boolean = false,
    hasControl: Boolean,
): TerminalScrollRoute = when {
    !alternateScreen && !mouseTracking -> TerminalScrollRoute.LOCAL_HISTORY
    hasControl -> TerminalScrollRoute.REMOTE_NAVIGATION
    else -> TerminalScrollRoute.BLOCKED
}
