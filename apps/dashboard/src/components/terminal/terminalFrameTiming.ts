import { recordPerformanceMetric, type PerformanceMetric } from '@/lib/sessionsPerf';

export const TERMINAL_FRAME_TIMING_SAMPLE_RATE = 0.01;

interface TerminalFrameTimingDependencies {
  now: () => number;
  random: () => number;
  schedulePaint: (callback: FrameRequestCallback) => number;
  report: (metric: PerformanceMetric) => void;
}

const defaultDependencies: TerminalFrameTimingDependencies = {
  now: () => performance.now(),
  random: Math.random,
  schedulePaint: (callback) => window.requestAnimationFrame(callback),
  report: recordPerformanceMetric,
};

export function beginTerminalFrameTiming(
  byteLength: number,
  dependencies: Partial<TerminalFrameTimingDependencies> = {}
): (() => void) | null {
  const deps = { ...defaultDependencies, ...dependencies };
  if (deps.random() >= TERMINAL_FRAME_TIMING_SAMPLE_RATE) return null;

  const receivedAt = deps.now();
  let completed = false;
  return () => {
    if (completed) return;
    completed = true;
    deps.schedulePaint(() => {
      deps.report({
        name: 'terminal.frame_to_paint',
        value: Math.max(0, deps.now() - receivedAt),
        unit: 'ms',
        attributes: {
          bytes: byteLength,
          sample_rate: TERMINAL_FRAME_TIMING_SAMPLE_RATE,
        },
      });
    });
  };
}
