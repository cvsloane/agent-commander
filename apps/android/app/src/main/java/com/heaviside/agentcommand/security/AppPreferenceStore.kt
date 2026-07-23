/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.security

import android.content.Context
import com.heaviside.agentcommand.domain.AppPreferences
import com.heaviside.agentcommand.domain.AppPreferencesRepository
import com.heaviside.agentcommand.domain.PreferenceStorage

class AppPreferenceStore(context: Context) {
    private val repository = AppPreferencesRepository(
        SharedPreferencesStorage(context.applicationContext),
    )

    fun load(): AppPreferences = repository.load()

    fun save(preferences: AppPreferences) {
        repository.save(preferences)
    }

    fun clear() {
        repository.clear()
    }

    private class SharedPreferencesStorage(context: Context) : PreferenceStorage {
        private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

        override fun read(): String? = preferences.getString(KEY_PREFERENCES, null)

        override fun write(value: String) {
            preferences.edit().putString(KEY_PREFERENCES, value).apply()
        }

        override fun clear() {
            preferences.edit().remove(KEY_PREFERENCES).apply()
        }
    }

    private companion object {
        const val PREFERENCES = "agent-command-private-preferences"
        const val KEY_PREFERENCES = "non-secret-ui-preferences"
    }
}
