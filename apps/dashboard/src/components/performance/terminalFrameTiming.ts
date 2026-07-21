import { beginTerminalFrameTiming } from '@/components/terminal/terminalFrameTiming';
import { isPerformanceTelemetryEnabled } from './isEnabled';

type BeginTerminalFrameTiming = typeof beginTerminalFrameTiming;

export function beginTerminalFrameTimingIfEnabled(
  byteLength: number,
  begin: BeginTerminalFrameTiming = beginTerminalFrameTiming
): (() => void) | null {
  if (!isPerformanceTelemetryEnabled()) return null;
  return begin(byteLength);
}
