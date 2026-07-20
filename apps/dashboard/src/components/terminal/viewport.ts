export function calculateTerminalViewportHeight(
  viewport: { height: number; offsetTop: number },
  containerTop: number,
  reservedBottom = 0
): number {
  const topInsideViewport = Math.max(0, containerTop - viewport.offsetTop);
  return Math.max(0, Math.floor(viewport.height - topInsideViewport - reservedBottom));
}

export function calculateKeyboardInset(
  layoutHeight: number,
  viewport: { height: number; offsetTop: number }
): number {
  return Math.max(0, Math.floor(layoutHeight - viewport.height - viewport.offsetTop));
}

export function canFitTerminalElement(element: {
  clientWidth: number;
  clientHeight: number;
}): boolean {
  return element.clientWidth > 0 && element.clientHeight > 0;
}
