/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.AttentionChangedEvent

/**
 * Decides which attention changes are worth interrupting the operator for.
 *
 * Kept free of Android types so the rules are unit-testable. The control plane
 * emits an attention change on every transition, including back to "working",
 * so posting one notification per event would produce a stream of noise and
 * train the operator to swipe them away.
 */
class AttentionNotificationPolicy(
    /** Sessions the operator is currently looking at do not need a notification. */
    private val isForeground: () -> Boolean = { false },
) {
    /** Last reason notified per session, so repeats are suppressed. */
    private val lastNotified = mutableMapOf<String, String>()

    /** A session the user is actively viewing; excluded while in foreground. */
    var visibleSessionId: String? = null

    data class Notification(
        val sessionId: String,
        val title: String,
        val body: String,
    )

    fun onAttentionChanged(event: AttentionChangedEvent): Notification? {
        // Cleared attention is not an interruption, but it must reset the dedupe
        // state so the next block on the same session notifies again.
        if (!event.needsAttention) {
            lastNotified.remove(event.sessionId)
            return null
        }

        val reason = event.attentionReason ?: return null

        // Never interrupt for the pane already on screen.
        if (isForeground() && visibleSessionId == event.sessionId) return null

        // The control plane re-emits attention on unrelated session updates;
        // only a change of reason is a new thing to say.
        if (lastNotified[event.sessionId] == reason) return null
        lastNotified[event.sessionId] = reason

        return Notification(
            sessionId = event.sessionId,
            title = titleFor(reason),
            body = event.question?.takeIf { it.isNotBlank() } ?: bodyFor(reason),
        )
    }

    fun forget(sessionId: String) {
        lastNotified.remove(sessionId)
    }

    fun reset() {
        lastNotified.clear()
    }

    private fun titleFor(reason: String): String = when (reason.lowercase()) {
        "waiting_for_approval", "approval" -> "Approval needed"
        "waiting_for_input", "input" -> "Input needed"
        "error" -> "Agent error"
        else -> "Agent needs attention"
    }

    private fun bodyFor(reason: String): String = when (reason.lowercase()) {
        "waiting_for_approval", "approval" -> "An agent is waiting for you to approve a tool call."
        "waiting_for_input", "input" -> "An agent is waiting for your input."
        "error" -> "An agent stopped with an error."
        else -> reason
    }
}
