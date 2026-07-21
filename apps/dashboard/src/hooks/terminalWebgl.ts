import type { XTerminal } from '@/components/terminal/types';
import { recordPerformanceMetric, type PerformanceMetric } from '@/lib/sessionsPerf';

export const TERMINAL_WEBGL_RETRY_DELAY_MS = 500;

interface Disposable {
  dispose: () => void;
}

interface TerminalWebglAddon extends Disposable {
  onContextLoss: (listener: () => void) => Disposable;
}

interface TerminalWebglDependencies {
  schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
  report: (metric: PerformanceMetric) => void;
}

const defaultDependencies: TerminalWebglDependencies = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (timer) => clearTimeout(timer),
  report: recordPerformanceMetric,
};

export function installResilientTerminalWebgl(
  terminal: Pick<XTerminal, 'loadAddon'>,
  createAddon: () => TerminalWebglAddon,
  dependencies: Partial<TerminalWebglDependencies> = {}
): () => void {
  const deps = { ...defaultDependencies, ...dependencies };
  let activeAddon: TerminalWebglAddon | null = null;
  let lossSubscription: Disposable | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retried = false;
  let disposed = false;
  let fallbackReported = false;

  const reportFallback = (reason: string) => {
    if (fallbackReported) return;
    fallbackReported = true;
    deps.report({
      name: 'terminal.webgl_permanent_fallback',
      value: 1,
      unit: 'score',
      attributes: {
        renderer: 'dom',
        reason,
        retry_attempted: true,
      },
    });
  };

  const disposeActive = () => {
    lossSubscription?.dispose();
    lossSubscription = null;
    activeAddon?.dispose();
    activeAddon = null;
  };

  const activate = () => {
    const addon = createAddon();
    const subscription = addon.onContextLoss(() => {
      if (disposed || activeAddon !== addon) return;
      disposeActive();
      if (retried) {
        reportFallback('context_loss_after_retry');
        return;
      }
      retried = true;
      retryTimer = deps.schedule(() => {
        retryTimer = null;
        if (disposed) return;
        try {
          activate();
        } catch {
          disposeActive();
          reportFallback('retry_failed');
        }
      }, TERMINAL_WEBGL_RETRY_DELAY_MS);
    });
    try {
      terminal.loadAddon(addon as unknown as Parameters<XTerminal['loadAddon']>[0]);
    } catch (error) {
      subscription.dispose();
      addon.dispose();
      throw error;
    }
    activeAddon = addon;
    lossSubscription = subscription;
  };

  activate();
  return () => {
    disposed = true;
    if (retryTimer !== null) deps.cancel(retryTimer);
    retryTimer = null;
    disposeActive();
  };
}
