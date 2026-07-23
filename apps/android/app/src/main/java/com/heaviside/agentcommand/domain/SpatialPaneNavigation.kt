/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.domain

enum class PaneDirection {
    LEFT,
    UP,
    DOWN,
    RIGHT,
}

data class PaneRectangle(
    val paneId: String,
    val left: Int,
    val top: Int,
    val width: Int,
    val height: Int,
)

private data class SpatialScore(
    val noPerpendicularOverlap: Int,
    val primaryDistance: Double,
    val perpendicularGap: Int,
)

private val layoutLeaf = Regex("(\\d+)x(\\d+),(\\d+),(\\d+),(\\d+)")

fun parseTmuxWindowLayout(layout: String): Map<String, PaneRectangle> {
    val panes = linkedMapOf<String, PaneRectangle>()
    layoutLeaf.findAll(layout).forEach { match ->
        val width = match.groupValues[1].toInt()
        val height = match.groupValues[2].toInt()
        val left = match.groupValues[3].toInt()
        val top = match.groupValues[4].toInt()
        val paneId = "%${match.groupValues[5]}"
        panes[paneId] = PaneRectangle(paneId, left, top, width, height)
    }
    return panes
}

fun resolveDirectionalPaneTargets(
    panes: List<TmuxPaneNode>,
    currentPaneId: String?,
    layout: String,
): Map<PaneDirection, TmuxPaneNode?> {
    val ordered = panes.sortedWith(compareBy({ it.paneIndex }, { it.paneId }))
    val currentIndex = ordered.indexOfFirst { it.paneId == currentPaneId }
    val previous = ordered.getOrNull(currentIndex - 1)
    val next = if (currentIndex >= 0) ordered.getOrNull(currentIndex + 1) else null
    val geometry = parseTmuxWindowLayout(layout)
    val hasCompleteLayout = currentPaneId != null &&
        geometry.containsKey(currentPaneId) &&
        panes.all { geometry.containsKey(it.paneId) }
    if (!hasCompleteLayout) {
        return mapOf(
            PaneDirection.LEFT to previous,
            PaneDirection.UP to previous,
            PaneDirection.DOWN to next,
            PaneDirection.RIGHT to next,
        )
    }
    return PaneDirection.entries.associateWith { direction ->
        findSpatialPane(panes, requireNotNull(currentPaneId), geometry, direction)
    }
}

private fun findSpatialPane(
    panes: List<TmuxPaneNode>,
    currentPaneId: String,
    geometry: Map<String, PaneRectangle>,
    direction: PaneDirection,
): TmuxPaneNode? {
    val current = geometry.getValue(currentPaneId)
    return panes.asSequence()
        .filter { it.paneId != currentPaneId }
        .mapNotNull { pane ->
            spatialScore(current, geometry.getValue(pane.paneId), direction)
                ?.let { score -> pane to score }
        }
        .sortedWith(
            compareBy<Pair<TmuxPaneNode, SpatialScore>>(
                { it.second.noPerpendicularOverlap },
                { it.second.primaryDistance },
                { it.second.perpendicularGap },
                { it.first.paneIndex },
                { it.first.paneId },
            ),
        )
        .firstOrNull()
        ?.first
}

private fun spatialScore(
    current: PaneRectangle,
    candidate: PaneRectangle,
    direction: PaneDirection,
): SpatialScore? {
    val currentCenterX = current.left + current.width / 2.0
    val currentCenterY = current.top + current.height / 2.0
    val candidateCenterX = candidate.left + candidate.width / 2.0
    val candidateCenterY = candidate.top + candidate.height / 2.0
    val horizontal = direction == PaneDirection.LEFT || direction == PaneDirection.RIGHT
    val inDirection = when (direction) {
        PaneDirection.LEFT -> candidateCenterX < currentCenterX
        PaneDirection.RIGHT -> candidateCenterX > currentCenterX
        PaneDirection.UP -> candidateCenterY < currentCenterY
        PaneDirection.DOWN -> candidateCenterY > currentCenterY
    }
    if (!inDirection) return null
    val primaryDistance = if (horizontal) {
        kotlin.math.abs(candidateCenterX - currentCenterX)
    } else {
        kotlin.math.abs(candidateCenterY - currentCenterY)
    }
    val perpendicularGap = if (horizontal) {
        intervalGap(
            current.top,
            current.top + current.height,
            candidate.top,
            candidate.top + candidate.height,
        )
    } else {
        intervalGap(
            current.left,
            current.left + current.width,
            candidate.left,
            candidate.left + candidate.width,
        )
    }
    return SpatialScore(
        noPerpendicularOverlap = if (perpendicularGap > 0) 1 else 0,
        primaryDistance = primaryDistance,
        perpendicularGap = perpendicularGap,
    )
}

private fun intervalGap(
    firstStart: Int,
    firstEnd: Int,
    secondStart: Int,
    secondEnd: Int,
): Int = when {
    firstEnd < secondStart -> secondStart - firstEnd
    secondEnd < firstStart -> firstStart - secondEnd
    else -> 0
}
