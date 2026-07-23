/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

import org.json.JSONObject

enum class KeyRailMode {
    FIXED,
    EXPANDED,
}

data class ValidatedTmuxTarget(
    val hostId: String,
    val sessionId: String,
    val paneId: String,
    val tmuxTarget: String,
    val validatedAtEpochMillis: Long,
) {
    init {
        require(hostId.isNotBlank())
        require(sessionId.isNotBlank())
        require(paneId.isNotBlank())
        require(tmuxTarget.isNotBlank())
        require(validatedAtEpochMillis >= 0)
    }
}

data class AppPreferences(
    val fontSizeSp: Float = DEFAULT_FONT_SIZE_SP,
    val keyRailMode: KeyRailMode = KeyRailMode.FIXED,
    val tmuxPrefixes: Map<String, String> = emptyMap(),
    val lastValidatedTarget: ValidatedTmuxTarget? = null,
) {
    init {
        require(fontSizeSp in MIN_FONT_SIZE_SP..MAX_FONT_SIZE_SP)
        require(tmuxPrefixes.all { (hostId, prefix) -> hostId.isNotBlank() && prefix.isNotBlank() })
    }

    companion object {
        const val DEFAULT_FONT_SIZE_SP = 14f
        const val MIN_FONT_SIZE_SP = 8f
        const val MAX_FONT_SIZE_SP = 32f
    }
}

interface PreferenceStorage {
    fun read(): String?
    fun write(value: String)
    fun clear()
}

class AppPreferencesRepository(
    private val storage: PreferenceStorage,
) {
    fun load(): AppPreferences =
        storage.read()?.let { runCatching { decode(it) }.getOrNull() } ?: AppPreferences()

    fun save(preferences: AppPreferences) {
        storage.write(encode(preferences))
    }

    fun clear() {
        storage.clear()
    }

    internal companion object {
        fun encode(preferences: AppPreferences): String {
            val prefixes = JSONObject()
            preferences.tmuxPrefixes.toSortedMap().forEach(prefixes::put)
            return JSONObject()
                .put("font_size_sp", preferences.fontSizeSp.toDouble())
                .put("key_rail_mode", preferences.keyRailMode.name)
                .put("tmux_prefixes", prefixes)
                .apply {
                    preferences.lastValidatedTarget?.let { target ->
                        put(
                            "last_validated_target",
                            JSONObject()
                                .put("host_id", target.hostId)
                                .put("session_id", target.sessionId)
                                .put("pane_id", target.paneId)
                                .put("tmux_target", target.tmuxTarget)
                                .put("validated_at_epoch_ms", target.validatedAtEpochMillis),
                        )
                    }
                }
                .toString()
        }

        fun decode(raw: String): AppPreferences {
            val payload = JSONObject(raw)
            val prefixPayload = payload.optJSONObject("tmux_prefixes") ?: JSONObject()
            val prefixes = prefixPayload.keys().asSequence()
                .sorted()
                .associateWith { prefixPayload.getString(it) }
            val target = payload.optJSONObject("last_validated_target")?.let {
                ValidatedTmuxTarget(
                    hostId = it.getString("host_id"),
                    sessionId = it.getString("session_id"),
                    paneId = it.getString("pane_id"),
                    tmuxTarget = it.getString("tmux_target"),
                    validatedAtEpochMillis = it.getLong("validated_at_epoch_ms"),
                )
            }
            return AppPreferences(
                fontSizeSp = payload.optDouble(
                    "font_size_sp",
                    AppPreferences.DEFAULT_FONT_SIZE_SP.toDouble(),
                ).toFloat(),
                keyRailMode = runCatching {
                    KeyRailMode.valueOf(payload.optString("key_rail_mode", KeyRailMode.FIXED.name))
                }.getOrDefault(KeyRailMode.FIXED),
                tmuxPrefixes = prefixes,
                lastValidatedTarget = target,
            )
        }
    }
}
