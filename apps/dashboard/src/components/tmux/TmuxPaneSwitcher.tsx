'use client';

import { AlertCircle, Loader2, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionWithSnapshot } from '@agent-command/schema';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn, getSessionDisplayName } from '@/lib/utils';
import { useUIStore } from '@/stores/ui';
import {
  filterThumbnailPanes,
  getPaneSnapshotFreshness,
  getPaneSnapshotPreview,
  getPaneSwitcherGroup,
  getThumbnailSwitcherPanes,
} from './paneSwitcher';

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
  onSelectSession: (sessionId: string) => Promise<boolean>;
  navigationError?: string;
  onClose: () => void;
}

export function TmuxPaneSwitcher({
  open,
  sessions,
  selectedSessionId,
  onSelectSession,
  onClose,
  navigationError,
}: TmuxPaneSwitcherProps) {
  const recentSessions = useUIStore((state) => state.recentSessions);
  const panes = getThumbnailSwitcherPanes(recentSessions, sessions, selectedSessionId);
  const [switchingSessionId, setSwitchingSessionId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const errorMessage = localError || navigationError;
  const filteredPanes = useMemo(() => filterThumbnailPanes(panes, query), [panes, query]);
  const groupedPanes = useMemo(() => {
    const groups = new Map<string, { label: string; panes: SessionWithSnapshot[] }>();
    for (const pane of filteredPanes) {
      const group = getPaneSwitcherGroup(pane);
      const current = groups.get(group.key);
      if (current) current.panes.push(pane);
      else groups.set(group.key, { label: group.label, panes: [pane] });
    }
    return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
  }, [filteredPanes]);
  const selectPane = useCallback(async (session: SessionWithSnapshot) => {
    if (switchingSessionId) return;
    setLocalError(null);
    setSwitchingSessionId(session.id);
    try {
      const switched = await onSelectSession(session.id);
      if (switched) onClose();
      else setLocalError('The pane did not switch. Your current pane is still active.');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'The pane could not be switched.');
    } finally {
      setSwitchingSessionId(null);
    }
  }, [onClose, onSelectSession, switchingSessionId]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setLocalError(null);
      return;
    }
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const index = Number(event.key) - 1;
      const pane = filteredPanes[index];
      if (!pane || index < 0 || index > 8) return;
      event.preventDefault();
      void selectPane(pane);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [filteredPanes, open, selectPane]);

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
              Current tmux panes · recent and waiting previews
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
        {errorMessage && (
          <div className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-red-400/30 bg-red-950/70 px-3 py-2 text-xs text-red-100" role="alert">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}
        <label className="relative mx-3 mt-3 block">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-white/40" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, target, or capture"
            className="h-9 w-full rounded-md border border-white/15 bg-white/5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-sky-400 focus:ring-1 focus:ring-sky-400"
            aria-label="Search panes"
          />
        </label>
        <div className="max-h-[calc(82dvh-7.5rem)] space-y-4 overflow-y-auto p-3">
          {panes.length === 0 ? (
            <div className="py-12 text-center text-sm text-white/55">No live panes available.</div>
          ) : filteredPanes.length === 0 ? (
            <div className="py-12 text-center text-sm text-white/55">
              No panes match “{query}”.
            </div>
          ) : groupedPanes.map((group) => (
            <section key={group.key} aria-label={group.label}>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/45">
                {group.label}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {group.panes.map((session) => {
            const selected = session.id === selectedSessionId;
            const status = paneStatus(session);
            const preview = getPaneSnapshotPreview(session.latest_snapshot?.capture_text);
            const freshness = getPaneSnapshotFreshness(session.latest_snapshot?.created_at);
            const shortcutIndex = filteredPanes.findIndex((candidate) => candidate.id === session.id);
            return (
              <button
                key={session.id}
                type="button"
                className={cn(
                  'min-h-36 overflow-hidden rounded-lg border bg-black text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-400',
                  selected ? 'border-sky-400 ring-1 ring-sky-400/50' : 'border-white/15 hover:border-white/30'
                )}
                aria-current={selected ? 'true' : undefined}
                aria-busy={switchingSessionId === session.id}
                disabled={switchingSessionId !== null}
                onClick={() => void selectPane(session)}
              >
                <div className="flex items-center gap-2 border-b border-white/10 px-2.5 py-2">
                  {shortcutIndex < 9 && (
                    <kbd className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white/20 text-[9px] text-white/55">
                      {shortcutIndex + 1}
                    </kbd>
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                    {getSessionDisplayName(session)}
                  </span>
                  {switchingSessionId === session.id && (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-label="Switching pane" />
                  )}
                  <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', status.className)}>
                    {status.label}
                  </span>
                </div>
                <pre className="h-20 overflow-hidden whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[9px] leading-4 text-white/65">
                  {preview || 'No capture yet'}
                </pre>
                <div className="flex items-center justify-between border-t border-white/10 px-2.5 py-1.5 text-[9px] text-white/40">
                  <span className="truncate font-mono">{session.tmux_target || session.tmux_pane_id}</span>
                  <span className={freshness.stale ? 'text-amber-200/70' : 'text-emerald-200/70'}>
                    {freshness.label}
                  </span>
                </div>
              </button>
            );
                })}
              </div>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
