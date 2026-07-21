import type { TmuxPaneTopologyView } from '@/stores/tmuxTopology';

export type PaneDirection = 'left' | 'up' | 'down' | 'right';

interface PaneRect {
  paneId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

const LAYOUT_LEAF = /(\d+)x(\d+),(\d+),(\d+),(\d+)/g;

export function parseTmuxWindowLayout(layout: string): Map<string, PaneRect> {
  const panes = new Map<string, PaneRect>();
  for (const match of layout.matchAll(LAYOUT_LEAF)) {
    const [, width, height, left, top, paneNumber] = match;
    if (!width || !height || !left || !top || paneNumber === undefined) continue;
    const paneId = `%${paneNumber}`;
    panes.set(paneId, {
      paneId,
      left: Number(left),
      top: Number(top),
      width: Number(width),
      height: Number(height),
    });
  }
  return panes;
}

function intervalGap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number) {
  if (firstEnd < secondStart) return secondStart - firstEnd;
  if (secondEnd < firstStart) return firstStart - secondEnd;
  return 0;
}

function spatialScore(current: PaneRect, candidate: PaneRect, direction: PaneDirection) {
  const currentCenterX = current.left + current.width / 2;
  const currentCenterY = current.top + current.height / 2;
  const candidateCenterX = candidate.left + candidate.width / 2;
  const candidateCenterY = candidate.top + candidate.height / 2;
  const horizontal = direction === 'left' || direction === 'right';
  const inDirection = direction === 'left'
    ? candidateCenterX < currentCenterX
    : direction === 'right'
      ? candidateCenterX > currentCenterX
      : direction === 'up'
        ? candidateCenterY < currentCenterY
        : candidateCenterY > currentCenterY;
  if (!inDirection) return null;
  const primaryDistance = horizontal
    ? Math.abs(candidateCenterX - currentCenterX)
    : Math.abs(candidateCenterY - currentCenterY);
  const perpendicularGap = horizontal
    ? intervalGap(
        current.top,
        current.top + current.height,
        candidate.top,
        candidate.top + candidate.height
      )
    : intervalGap(
        current.left,
        current.left + current.width,
        candidate.left,
        candidate.left + candidate.width
      );
  return [perpendicularGap > 0 ? 1 : 0, primaryDistance, perpendicularGap] as const;
}

function compareScore(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function findSpatialPane(
  panes: TmuxPaneTopologyView[],
  currentPaneId: string | undefined,
  layout: string,
  direction: PaneDirection
): TmuxPaneTopologyView | undefined {
  const geometry = parseTmuxWindowLayout(layout);
  const current = currentPaneId ? geometry.get(currentPaneId) : undefined;
  if (!current || !panes.every((pane) => geometry.has(pane.paneId))) return undefined;
  return panes
    .filter((pane) => pane.paneId !== currentPaneId)
    .flatMap((pane) => {
      const score = spatialScore(current, geometry.get(pane.paneId)!, direction);
      return score ? [{ pane, score }] : [];
    })
    .sort((left, right) => compareScore(left.score, right.score))[0]?.pane;
}

export function resolveDirectionalPaneTargets(
  panes: TmuxPaneTopologyView[],
  currentPaneId: string | undefined,
  layout: string
): Record<PaneDirection, TmuxPaneTopologyView | undefined> {
  const currentIndex = panes.findIndex((pane) => pane.paneId === currentPaneId);
  const previous = currentIndex > 0 ? panes[currentIndex - 1] : undefined;
  const next = currentIndex >= 0 && currentIndex < panes.length - 1 ? panes[currentIndex + 1] : undefined;
  const geometry = parseTmuxWindowLayout(layout);
  const hasKnownLayout = Boolean(
    currentPaneId
    && geometry.has(currentPaneId)
    && panes.every((pane) => geometry.has(pane.paneId))
  );
  if (!hasKnownLayout) {
    return { left: previous, up: previous, down: next, right: next };
  }
  return {
    left: findSpatialPane(panes, currentPaneId, layout, 'left'),
    up: findSpatialPane(panes, currentPaneId, layout, 'up'),
    down: findSpatialPane(panes, currentPaneId, layout, 'down'),
    right: findSpatialPane(panes, currentPaneId, layout, 'right'),
  };
}
