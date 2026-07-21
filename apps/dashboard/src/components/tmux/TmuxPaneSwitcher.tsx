'use client';

import { X } from 'lucide-react';
import type { SessionWithSnapshot } from '@agent-command/schema';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn, getSessionDisplayName } from '@/lib/utils';
import { useUIStore } from '@/stores/ui';
import { getPaneSnapshotPreview, getThumbnailSwitcherPanes } from './paneSwitcher';

function paneStatus(session: SessionWithSnapshot): { label: string; className: string } {
  switch (session.status) {
    case 'WAITING_FOR_APPROVAL':
      return { label: 'Approval', className: 'border-amber-400/50 bg-amber-400/15 text-amber-200' };
    case 'WAITING_FOR_INPUT':
      return { label: 'Waiting', className: 'border-amber-400/50 bg-amber-400/15 text-amber-200' };
    case 'RUNNING':
    case 'STARTING':
      return { label: 'Running', className: 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200' };
    case 'ERROR':
      return { label: 'Error', className: 'border-red-400/50 bg-red-400/15 text-red-200' };
    default:
      return { label: 'Idle', className: 'border-white/15 bg-white/5 text-white/60' };
  }
}

interface TmuxPaneSwitcherProps {
  open: boolean;
  sessions: SessionWithSnapshot[];
  selectedSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onClose: () => void;
}

export function TmuxPaneSwitcher({
  open,
  sessions,
  selectedSessionId,
  onSelectSession,
  onClose,
}: TmuxPaneSwitcherProps) {
  const recentSessions = useUIStore((state) => state.recentSessions);
  const panes = getThumbnailSwitcherPanes(recentSessions, sessions, selectedSessionId);

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent
        side="bottom"
        hideClose
        className="max-h-[82dvh] gap-0 overflow-hidden rounded-t-2xl border-white/10 bg-zinc-950 p-0 pb-[env(safe-area-inset-bottom)] text-white lg:hidden"
        data-testid="tmux-pane-switcher"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <SheetTitle className="text-sm text-white">Switch pane</SheetTitle>
            <SheetDescription className="text-xs text-white/55">
              Recent and waiting panes · live capture previews
            </SheetDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-white hover:bg-white/10 hover:text-white"
            onClick={onClose}
            aria-label="Close pane switcher"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="grid max-h-[calc(82dvh-4.5rem)] grid-cols-2 gap-2 overflow-y-auto p-3">
          {panes.length === 0 ? (
            <div className="col-span-2 py-12 text-center text-sm text-white/55">
              No live panes available.
            </div>
          ) : panes.map((session) => {
            const selected = session.id === selectedSessionId;
            const status = paneStatus(session);
            const preview = getPaneSnapshotPreview(session.latest_snapshot?.capture_text);
            return (
              <button
                key={session.id}
                type="button"
                className={cn(
                  'min-h-36 overflow-hidden rounded-lg border bg-black text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-400',
                  selected ? 'border-sky-400 ring-1 ring-sky-400/50' : 'border-white/15 hover:border-white/30'
                )}
                aria-current={selected ? 'true' : undefined}
                onClick={() => {
                  onSelectSession(session.id);
                  onClose();
                }}
              >
                <div className="flex items-center gap-2 border-b border-white/10 px-2.5 py-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                    {getSessionDisplayName(session)}
                  </span>
                  <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', status.className)}>
                    {status.label}
                  </span>
                </div>
                <pre className="h-24 overflow-hidden whitespace-pre-wrap break-all px-2.5 py-2 font-mono text-[9px] leading-4 text-white/65">
                  {preview || 'No capture yet'}
                </pre>
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
