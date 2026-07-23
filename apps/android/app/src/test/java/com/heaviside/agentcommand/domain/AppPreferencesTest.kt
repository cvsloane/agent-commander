/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class AppPreferencesTest {
    @Test
    fun `non-secret preferences survive repository recreation without credential fields`() {
        val storage = InMemoryPreferenceStorage()
        val expected = AppPreferences(
            fontSizeSp = 17.5f,
            keyRailMode = KeyRailMode.EXPANDED,
            tmuxPrefixes = mapOf("host-b" to "C-b", "host-a" to "C-a"),
            lastValidatedTarget = ValidatedTmuxTarget(
                hostId = "host-a",
                sessionId = "session-a",
                paneId = "%7",
                tmuxTarget = "vault:2.3",
                validatedAtEpochMillis = 1_753_275_600_000,
            ),
        )

        AppPreferencesRepository(storage).save(expected)
        val restored = AppPreferencesRepository(storage).load()

        assertEquals(expected, restored)
        assertFalse(storage.value.orEmpty().contains("accessCode", ignoreCase = true))
        assertFalse(storage.value.orEmpty().contains("credential", ignoreCase = true))
        assertEquals(listOf("host-a", "host-b"), restored.tmuxPrefixes.keys.toList())

        AppPreferencesRepository(storage).clear()
        assertNull(storage.value)
        assertEquals(AppPreferences(), AppPreferencesRepository(storage).load())
    }

    private class InMemoryPreferenceStorage : PreferenceStorage {
        var value: String? = null

        override fun read(): String? = value

        override fun write(value: String) {
            this.value = value
        }

        override fun clear() {
            value = null
        }
    }
}
