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
        viewerConverged = false
        failureMessage = null
    }

    fun attached(readOnly: Boolean) {
        connectionState = TerminalConnectionState.ATTACHED
        controllerChanged(!readOnly)
    }

    fun controllerChanged(hasControl: Boolean) {
        controllerOwnership = if (hasControl) ControllerOwnership.CONTROL else ControllerOwnership.READ_ONLY
    }

    fun beginFocus(requestId: String, target: ViewerTarget = requireNotNull(desiredTarget)) {
        desiredTarget = target
        pendingNavigation = PendingNavigation(requestId, reconcilingTimedOutFocus = false)
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
            ViewerResolution.Converged(requireNotNull(expected))
        } else {
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
        failureMessage = (resolution as? ViewerResolution.Failed)?.message
        return resolution
    }

    fun failPending(requestId: String, message: String): ViewerResolution {
        if (pendingNavigation?.requestId != requestId) return ViewerResolution.Ignored
        pendingNavigation = null
        failureMessage = message
        return ViewerResolution.Failed(message)
    }

    fun detached() {
        connectionState = TerminalConnectionState.DETACHED
        controllerOwnership = ControllerOwnership.UNKNOWN
        authoritativeTarget = null
        pendingNavigation = null
        viewerConverged = false
        failureMessage = null
    }

    fun failed() {
        connectionState = TerminalConnectionState.FAILED
        controllerOwnership = ControllerOwnership.UNKNOWN
        authoritativeTarget = null
        pendingNavigation = null
        viewerConverged = false
        failureMessage = null
    }

    private data class PendingNavigation(
        val requestId: String,
        val reconcilingTimedOutFocus: Boolean,
    )
}
