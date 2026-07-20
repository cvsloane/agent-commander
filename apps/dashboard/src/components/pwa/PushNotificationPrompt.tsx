'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { BellRing, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePushSubscription } from '@/hooks/usePushSubscription';

const DISMISSED_KEY = 'agent-command:push-prompt-dismissed-v1';

export function PushNotificationPrompt() {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const { state, subscribe, refresh } = usePushSubscription();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY) === 'true');
    } catch {
      setDismissed(false);
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // Restricted storage should not prevent dismissal for this render.
    }
  };

  const visibleStatus = ['permission-required', 'unsubscribed', 'subscribing', 'unavailable', 'error'];
  if (!isMobile || dismissed || pathname.startsWith('/settings') || !visibleStatus.includes(state.status)) {
    return null;
  }

  const busy = state.status === 'subscribing';
  return (
    <aside
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 rounded-xl border bg-background/95 p-4 shadow-2xl backdrop-blur md:hidden"
      aria-labelledby="push-prompt-title"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-cyan-500/10 text-cyan-500">
          <BellRing className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="push-prompt-title" className="text-sm font-semibold">Stay reachable from your phone</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
            {state.status === 'unavailable' || state.status === 'error'
              ? state.error
              : 'Get approvals, waiting-input prompts, and failed-run alerts when the app is closed.'}
          </p>
          <div className="mt-3 flex gap-2">
            {['unavailable', 'error'].includes(state.status) ? (
              <Button size="sm" variant="outline" onClick={() => void refresh()}>
                Check again
              </Button>
            ) : (
              <Button size="sm" onClick={() => void subscribe()} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enable push
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={dismiss}>Not now</Button>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={dismiss} aria-label="Dismiss push prompt">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </aside>
  );
}
