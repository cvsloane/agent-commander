/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import com.heaviside.agentcommand.data.AttentionChangedEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class AttentionNotificationPolicyTest {

    private fun event(
        sessionId: String = "session-1",
        reason: String? = "WAITING_FOR_APPROVAL",
        question: String? = null,
    ) = AttentionChangedEvent(
        timestamp = "2026-07-26T18:00:00Z",
        sessionId = sessionId,
        attentionReason = reason,
        question = question,
    )

    @Test
    fun `notifies when an agent becomes blocked`() {
        val policy = AttentionNotificationPolicy()
        val notification = policy.onAttentionChanged(event())

        assertNotNull(notification)
        assertEquals("Approval needed", notification!!.title)
        assertEquals("session-1", notification.sessionId)
    }

    @Test
    fun `prefers the agent's own question as the body`() {
        val policy = AttentionNotificationPolicy()
        val notification = policy.onAttentionChanged(
            event(reason = "WAITING_FOR_INPUT", question = "Which database should I migrate?"),
        )

        assertEquals("Which database should I migrate?", notification?.body)
    }

    // The control plane re-emits attention on unrelated session updates. Posting
    // one notification per event would train the operator to ignore them.
    @Test
    fun `suppresses a repeat of the same reason`() {
        val policy = AttentionNotificationPolicy()

        assertNotNull(policy.onAttentionChanged(event()))
        assertNull(policy.onAttentionChanged(event()))
        assertNull(policy.onAttentionChanged(event()))
    }

    @Test
    fun `notifies again when the reason changes`() {
        val policy = AttentionNotificationPolicy()

        assertNotNull(policy.onAttentionChanged(event(reason = "WAITING_FOR_APPROVAL")))
        val second = policy.onAttentionChanged(event(reason = "ERROR"))

        assertNotNull(second)
        assertEquals("Agent error", second!!.title)
    }

    @Test
    fun `clearing attention is not itself an interruption`() {
        val policy = AttentionNotificationPolicy()
        policy.onAttentionChanged(event())

        assertNull(policy.onAttentionChanged(event(reason = null)))
    }

    // After an agent unblocks and blocks again on the same reason, the operator
    // still needs to know -- the dedupe state must reset when attention clears.
    @Test
    fun `notifies again after attention clears and returns`() {
        val policy = AttentionNotificationPolicy()

        assertNotNull(policy.onAttentionChanged(event()))
        policy.onAttentionChanged(event(reason = null))
        assertNotNull(policy.onAttentionChanged(event()))
    }

    @Test
    fun `does not interrupt for the pane already on screen`() {
        val policy = AttentionNotificationPolicy(isForeground = { true })
        policy.visibleSessionId = "session-1"

        assertNull(policy.onAttentionChanged(event(sessionId = "session-1")))
        // A different session in the background is still worth reporting.
        assertNotNull(policy.onAttentionChanged(event(sessionId = "session-2")))
    }

    @Test
    fun `notifies for the visible session while backgrounded`() {
        val policy = AttentionNotificationPolicy(isForeground = { false })
        policy.visibleSessionId = "session-1"

        assertNotNull(policy.onAttentionChanged(event(sessionId = "session-1")))
    }

    @Test
    fun `tracks sessions independently`() {
        val policy = AttentionNotificationPolicy()

        assertNotNull(policy.onAttentionChanged(event(sessionId = "a")))
        assertNotNull(policy.onAttentionChanged(event(sessionId = "b")))
        assertNull(policy.onAttentionChanged(event(sessionId = "a")))
    }

    @Test
    fun `maps known reasons to readable titles`() {
        val policy = AttentionNotificationPolicy()

        assertEquals(
            "Input needed",
            policy.onAttentionChanged(event(sessionId = "s1", reason = "WAITING_FOR_INPUT"))?.title,
        )
        assertEquals(
            "Agent needs attention",
            policy.onAttentionChanged(event(sessionId = "s2", reason = "something_else"))?.title,
        )
    }
}
