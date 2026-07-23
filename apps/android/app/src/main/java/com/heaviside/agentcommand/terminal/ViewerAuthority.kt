/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.terminal

import com.heaviside.agentcommand.data.NavigationResult

data class ViewerTarget(
    val paneId: String,
    val zoomed: Boolean,
)

enum class TerminalConnectionState {
    DETACHED,
    CONNECTING,
    ATTACHED,
    FAILED,
}

enum class ControllerOwnership {
    UNKNOWN,
    READ_ONLY,
    CONTROL,
}

sealed interface ViewerResolution {
    data object Ignored : ViewerResolution
    data class Converged(val target: ViewerTarget) : ViewerResolution
    data class Failed(val message: String) : ViewerResolution
}

class ViewerAuthority {
    var connectionState = TerminalConnectionState.DETACHED
        private set
    var controllerOwnership = ControllerOwnership.UNKNOWN
        private set
    var desiredTarget: ViewerTarget? = null
        private set
    var authoritativeTarget: ViewerTarget? = null
        private set
    var failureMessage: String? = null
        private set

    private var pendingNavigation: PendingNavigation? = null
    private var pendingControllerConfirmation: ControllerConfirmation? = null
    private var viewerConverged = false

    val hasPendingNavigation: Boolean
        get() = pendingNavigation != null

    val canSendInput: Boolean
        get() = connectionState == TerminalConnectionState.ATTACHED &&
            controllerOwnership == ControllerOwnership.CONTROL &&
            viewerConverged &&
            authoritativeTarget != null &&
            authoritativeTarget == desiredTarget &&
            pendingNavigation == null

    fun connecting(target: ViewerTarget) {
        connectionState = TerminalConnectionState.CONNECTING
        controllerOwnership = ControllerOwnership.UNKNOWN
        desiredTarget = target
        authoritativeTarget = null
        pendingNavigation = null
        pendingControllerConfirmation = null
        viewerConverged = false
        failureMessage = null
    }

    fun attached(readOnly: Boolean) {
        connectionState = TerminalConnectionState.ATTACHED
        desiredTarget?.let { target ->
            controllerChanged(target.paneId, !readOnly)
        }
    }

    fun controllerChanged(paneId: String, hasControl: Boolean): Boolean {
        if (paneId.isBlank()) return false
        val confirmation = ControllerConfirmation(
            paneId = paneId,
            ownership = if (hasControl) ControllerOwnership.CONTROL else ControllerOwnership.READ_ONLY,
        )
        if (pendingNavigation != null && desiredTarget?.paneId == paneId) {
            pendingControllerConfirmation = confirmation
            return true
        }
        if (viewerConverged && authoritativeTarget?.paneId == paneId) {
            controllerOwnership = confirmation.ownership
            return true
        }
        if (
            pendingNavigation == null &&
            authoritativeTarget == null &&
            desiredTarget?.paneId == paneId
        ) {
            controllerOwnership = confirmation.ownership
            return true
        }
        return false
    }

    fun beginFocus(requestId: String, target: ViewerTarget = requireNotNull(desiredTarget)) {
        desiredTarget = target
        pendingNavigation = PendingNavigation(requestId, reconcilingTimedOutFocus = false)
        pendingControllerConfirmation = null
        controllerOwnership = ControllerOwnership.UNKNOWN
        authoritativeTarget = null
        viewerConverged = false
        failureMessage = null
    }

    fun beginViewerStateReconciliation(focusRequestId: String, viewerStateRequestId: String): Boolean {
        if (pendingNavigation?.requestId != focusRequestId) return false
        pendingNavigation = PendingNavigation(viewerStateRequestId, reconcilingTimedOutFocus = true)
        return true
    }

    fun resolve(result: NavigationResult): ViewerResolution {
        val pending = pendingNavigation
        if (result.requestId != pending?.requestId) return ViewerResolution.Ignored
        pendingNavigation = null
        val reportedTarget = result.paneId?.let { paneId ->
            result.zoomed?.let { zoomed -> ViewerTarget(paneId, zoomed) }
        }
        authoritativeTarget = reportedTarget
        val expected = desiredTarget
        viewerConverged = result.ok && expected != null && reportedTarget == expected
        val resolution = if (viewerConverged) {
            val convergedTarget = requireNotNull(expected)
            controllerOwnership = pendingControllerConfirmation
                ?.takeIf { it.paneId == convergedTarget.paneId }
                ?.ownership
                ?: ControllerOwnership.UNKNOWN
            ViewerResolution.Converged(convergedTarget)
        } else {
            controllerOwnership = ControllerOwnership.UNKNOWN
            ViewerResolution.Failed(
                when {
                    pending.reconcilingTimedOutFocus && !result.message.isNullOrBlank() ->
                        "Pane focus timed out; ${result.message}"
                    !result.message.isNullOrBlank() -> result.message
                    pending.reconcilingTimedOutFocus && reportedTarget != null ->
                        "Pane focus timed out; viewer is on ${reportedTarget.paneId} with zoom " +
                            "${if (reportedTarget.zoomed) "on" else "off"}."
                    else -> "Tmux did not confirm the selected pane and zoom state."
                },
            )
        }
        pendingControllerConfirmation = null
        failureMessage = (resolution as? ViewerResolution.Failed)?.message
        return resolution
    }

    fun failPending(requestId: String, message: String): ViewerResolution {
        if (pendingNavigation?.requestId != requestId) return ViewerResolution.Ignored
        pendingNavigation = null
        pendingControllerConfirmation = null
        controllerOwnership = ControllerOwnership.UNKNOWN
        failureMessage = message
        return ViewerResolution.Failed(message)
    }

    fun detached() {
        connectionState = TerminalConnectionState.DETACHED
        controllerOwnership = ControllerOwnership.UNKNOWN
        authoritativeTarget = null
        pendingNavigation = null
        pendingControllerConfirmation = null
        viewerConverged = false
        failureMessage = null
    }

    fun failed() {
        connectionState = TerminalConnectionState.FAILED
        controllerOwnership = ControllerOwnership.UNKNOWN
        authoritativeTarget = null
        pendingNavigation = null
        pendingControllerConfirmation = null
        viewerConverged = false
        failureMessage = null
    }

    private data class PendingNavigation(
        val requestId: String,
        val reconcilingTimedOutFocus: Boolean,
    )

    private data class ControllerConfirmation(
        val paneId: String,
        val ownership: ControllerOwnership,
    )
}
