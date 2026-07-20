export function calculateTerminalViewportHeight(
  viewport: { height: number; offsetTop: number },
  containerTop: number
): number {
  const topInsideViewport = Math.max(0, containerTop - viewport.offsetTop);
  return Math.max(0, Math.floor(viewport.height - topInsideViewport));
}

export function canFitTerminalElement(element: {
  clientWidth: number;
  clientHeight: number;
}): boolean {
  return element.clientWidth > 0 && element.clientHeight > 0;
}
