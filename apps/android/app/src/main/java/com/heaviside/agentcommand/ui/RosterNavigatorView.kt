/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.ui

import android.content.Context
import android.graphics.Color
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.widget.doAfterTextChanged
import com.heaviside.agentcommand.data.TmuxPane
import com.heaviside.agentcommand.domain.RosterFilter
import com.heaviside.agentcommand.domain.TmuxPaneNode
import com.heaviside.agentcommand.domain.TmuxRoster
import kotlin.math.roundToInt

class RosterNavigatorView(
    context: Context,
    private val onPaneSelected: (TmuxPane) -> Unit,
) : LinearLayout(context) {
    private val expandedSessions = mutableSetOf<String>()
    private val query = EditText(context)
    private val onlineOnly = CheckBox(context)
    private val content = LinearLayout(context)
    private var roster = TmuxRoster(emptyList())
    private var activePaneId: String? = null

    init {
        orientation = VERTICAL
        setBackgroundColor(BACKGROUND)

        query.apply {
            hint = "Search host, session, status, path, or snapshot"
            inputType = InputType.TYPE_CLASS_TEXT
            setSingleLine()
            setTextColor(Color.WHITE)
            setHintTextColor(MUTED)
            contentDescription = "Filter tmux workbench"
            doAfterTextChanged { render() }
        }
        addView(query, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        onlineOnly.apply {
            text = "Online hosts only"
            setTextColor(MUTED)
            isChecked = false
            setOnCheckedChangeListener { _, _ -> render() }
        }
        addView(onlineOnly, LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        content.orientation = VERTICAL
        addView(
            ScrollView(context).apply {
                isFillViewport = true
                addView(
                    content,
                    ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                    ),
                )
            },
            LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
        )
    }

    fun update(roster: TmuxRoster, activePaneId: String? = this.activePaneId) {
        this.roster = roster
        this.activePaneId = activePaneId
        render()
    }

    private fun render() {
        content.removeAllViews()
        val filterText = query.text?.toString().orEmpty()
        val filtered = roster.filtered(
            RosterFilter(query = filterText, onlineOnly = onlineOnly.isChecked),
        )
        if (filtered.hosts.isEmpty()) {
            content.addView(label("No matching tmux targets.", MUTED, 14f, horizontal = 16))
            return
        }
        filtered.hosts.forEach { hostNode ->
            val host = hostNode.host
            content.addView(
                label(
                    buildString {
                        append(if (host.online) "● " else "○ ")
                        append(host.name)
                        append(if (host.online) " · online" else " · offline")
                        host.agentVersion?.let { append(" · $it") }
                    },
                    if (host.online) ONLINE else MUTED,
                    17f,
                    horizontal = 12,
                    top = 10,
                ),
            )
            if (hostNode.sessions.isEmpty()) {
                content.addView(label("No tmux sessions reported.", MUTED, 13f, horizontal = 24))
            }
            hostNode.sessions.forEach { session ->
                val sessionKey = "${host.id}\u0000${session.name}"
                val forcedOpen = filterText.isNotBlank()
                val expanded = forcedOpen || sessionKey in expandedSessions
                val paneCount = session.windows.sumOf { it.panes.size }
                val sessionButton = Button(context).apply {
                    isAllCaps = false
                    gravity = Gravity.START or Gravity.CENTER_VERTICAL
                    text = buildString {
                        append(if (expanded) "▾  " else "▸  ")
                        append(session.name)
                        append(" · ${session.windows.size} windows · $paneCount panes")
                        session.attachedClients?.let { append(" · $it clients") }
                    }
                    contentDescription = "${if (expanded) "Collapse" else "Expand"} tmux session ${session.name}"
                    setOnClickListener {
                        if (expanded) expandedSessions.remove(sessionKey) else expandedSessions.add(sessionKey)
                        render()
                    }
                }
                content.addView(
                    sessionButton,
                    LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        setMargins(dp(12), 0, dp(8), 0)
                    },
                )
                if (!expanded) return@forEach
                session.windows.forEach { window ->
                    val windowFlags = buildList {
                        if (window.active == true) add("active")
                        if (window.zoomed == true) add("zoomed")
                        if (window.bell == true) add("bell")
                        if (window.activity == true) add("activity")
                    }
                    val windowPane = window.panes.firstOrNull { it.active == true && it.attachable }?.pane
                        ?: window.panes.firstOrNull { it.attachable }?.pane
                    content.addView(
                        Button(context).apply {
                            isAllCaps = false
                            gravity = Gravity.START or Gravity.CENTER_VERTICAL
                            text = "Window ${window.index}: ${window.name}" +
                                windowFlags.takeIf { it.isNotEmpty() }?.joinToString(" · ", prefix = " · ").orEmpty()
                            isEnabled = host.online && windowPane != null
                            contentDescription = if (isEnabled) {
                                "Open window ${window.index} ${window.name}"
                            } else {
                                "Window ${window.index} ${window.name} has no attachable pane"
                            }
                            setOnClickListener { windowPane?.let(onPaneSelected) }
                        },
                        LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            setMargins(dp(28), dp(4), dp(8), 0)
                        },
                    )
                    window.panes.forEach { paneNode ->
                        content.addView(paneButton(host.online, paneNode), paneLayout())
                    }
                }
            }
        }
    }

    private fun paneButton(hostOnline: Boolean, node: TmuxPaneNode): Button {
        val pane = node.pane
        val title = pane?.title?.ifBlank { null } ?: node.liveTitle?.ifBlank { null } ?: node.paneId
        val contextLine = listOfNotNull(
            pane?.status?.lowercase()?.takeIf { it.isNotBlank() },
            pane?.provider?.takeIf { it.isNotBlank() },
            node.currentCommand?.takeIf { it.isNotBlank() } ?: pane?.currentCommand?.takeIf { it.isNotBlank() },
            node.currentPath?.takeIf { it.isNotBlank() } ?: pane?.cwd?.takeIf { it.isNotBlank() },
        ).joinToString(" · ")
        val activityLine = listOfNotNull(
            "pane ${node.paneIndex} ${node.paneId}",
            "active".takeIf { node.active == true },
            pane?.lastActivityAt?.let { "activity $it" },
            pane?.attentionReason?.takeIf { it.isNotBlank() },
        ).joinToString(" · ")
        val preview = pane?.latestSnapshot?.captureText
            ?.replace(Regex("\\s+"), " ")
            ?.trim()
            ?.take(180)
            ?.takeIf { it.isNotBlank() }
        return Button(context).apply {
            isAllCaps = false
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            text = buildString {
                append(if (pane?.paneId == activePaneId) "✓  " else "    ")
                append(title)
                if (contextLine.isNotBlank()) append("\n$contextLine")
                append("\n$activityLine")
                preview?.let { append("\n$it") }
                if (!node.attachable) append("\nLive topology only · waiting for attach identity")
                if (!hostOnline) append("\nHost is offline")
            }
            isEnabled = node.attachable && hostOnline
            contentDescription = if (isEnabled) {
                "Open $title, $activityLine"
            } else {
                "$title is not currently attachable"
            }
            setOnClickListener { pane?.let(onPaneSelected) }
        }
    }

    private fun paneLayout() =
        LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            setMargins(dp(40), 0, dp(8), dp(4))
        }

    private fun label(
        value: String,
        color: Int,
        size: Float,
        horizontal: Int,
        top: Int = 0,
    ) = TextView(context).apply {
        text = value
        textSize = size
        setTextColor(color)
        setPadding(dp(horizontal), dp(top), dp(8), dp(6))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).roundToInt()

    private companion object {
        val BACKGROUND = Color.rgb(9, 9, 11)
        val MUTED = Color.rgb(161, 161, 170)
        val ONLINE = Color.rgb(74, 222, 128)
    }
}
