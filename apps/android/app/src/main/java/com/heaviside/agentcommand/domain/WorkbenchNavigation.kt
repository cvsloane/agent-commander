/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.TmuxPane
import com.heaviside.agentcommand.terminal.ViewerTarget

sealed interface WorkbenchNavigationAction {
    data object AlreadyActive : WorkbenchNavigationAction
    data class FocusCandidate(val target: ViewerTarget) : WorkbenchNavigationAction
    data class FreshAttachment(val pane: TmuxPane) : WorkbenchNavigationAction
}

class WorkbenchNavigation(initialPane: TmuxPane? = null) {
    var activePane: TmuxPane? = initialPane
        private set
    var candidatePane: TmuxPane? = null
        private set
    private var candidateTarget: ViewerTarget? = null

    fun select(
        pane: TmuxPane,
        viewerAvailable: Boolean,
        zoomed: Boolean,
    ): WorkbenchNavigationAction {
        val active = activePane
        if (active?.hostId == pane.hostId && active.paneId == pane.paneId) {
            candidatePane = null
            candidateTarget = null
            return WorkbenchNavigationAction.AlreadyActive
        }
        val canReuseViewer = viewerAvailable &&
            active?.hostId == pane.hostId &&
            active.tmuxSessionName == pane.tmuxSessionName
        if (!canReuseViewer) {
            candidatePane = null
            candidateTarget = null
            return WorkbenchNavigationAction.FreshAttachment(pane)
        }
        val target = ViewerTarget(pane.paneId, zoomed)
        candidatePane = pane
        candidateTarget = target
        return WorkbenchNavigationAction.FocusCandidate(target)
    }

    fun confirm(target: ViewerTarget): TmuxPane? {
        if (target != candidateTarget) return null
        return candidatePane?.also {
            activePane = it
            candidatePane = null
            candidateTarget = null
        }
    }

    fun rejectCandidate() {
        candidatePane = null
        candidateTarget = null
    }

    fun attach(pane: TmuxPane) {
        activePane = pane
        candidatePane = null
        candidateTarget = null
    }

    fun clear() {
        activePane = null
        candidatePane = null
        candidateTarget = null
    }
}

data class LastTargetResolution(
    val pane: TmuxPane?,
    val preferences: AppPreferences,
)

object LastTargetPreference {
    fun resolve(
        preferences: AppPreferences,
        roster: TmuxRoster,
    ): LastTargetResolution {
        val target = preferences.lastValidatedTarget
            ?: return LastTargetResolution(null, preferences)
        val pane = roster.resolve(target)
        return if (pane == null) {
            LastTargetResolution(null, preferences.copy(lastValidatedTarget = null))
        } else {
            LastTargetResolution(pane, preferences)
        }
    }

    fun remember(
        preferences: AppPreferences,
        pane: TmuxPane,
        nowEpochMillis: Long,
    ): AppPreferences = preferences.copy(
        lastValidatedTarget = ValidatedTmuxTarget(
            hostId = pane.hostId,
            sessionId = pane.sessionId,
            paneId = pane.paneId,
            tmuxTarget = pane.target,
            validatedAtEpochMillis = nowEpochMillis,
        ),
    )
}
