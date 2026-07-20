'use client';

import { useEffect, useMemo, type MutableRefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Columns2, X } from 'lucide-react';
import type { Session } from '@agent-command/schema';
import { TerminalView, type TerminalController } from '@/components/TerminalView';
import { PersistentTerminalSlot } from '@/components/terminal/PersistentTerminalHost';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/useHydrated';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getSession } from '@/lib/api';
import { getSessionDisplayName } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useTmuxTopologyStore } from '@/stores/tmuxTopology';
import { TmuxPaneControls } from './TmuxPaneControls';
import { TmuxWindowStrip } from './TmuxWindowStrip';

interface TmuxTerminalWorkspaceProps {
  primarySession: Session;
  autoAttachPrimary?: boolean;
  primaryControllerRef?: MutableRefObject<TerminalController | null>;
}

function TerminalLabel({
  label,
  session,
  onClose,
}: {
  label: string;
  session: Session;
  onClose?: () => void;
}) {
  return (
    <div className="flex min-h-9 items-center gap-2 border-b bg-muted/30 px-2">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {getSessionDisplayName(session)}
      </span>
      {onClose && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onClose}
          aria-label="Close secondary terminal"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

export function TmuxTerminalWorkspace({
  primarySession,
  autoAttachPrimary = false,
  primaryControllerRef,
}: TmuxTerminalWorkspaceProps) {
  const hydrated = useHydrated();
  const belowDesktop = useIsMobile(1024);
  const rememberedSecondaryId = useSettingsStore(
    (state) => state.tmuxSecondaryByPrimary[primarySession.id] ?? ''
  );
  const setSecondary = useSettingsStore((state) => state.setTmuxSecondary);
  const rosterSessions = useTmuxTopologyStore(
    (state) => state.rosterByHost[primarySession.host_id]
  );
  const options = useMemo(
    () =>
      (rosterSessions ?? []).filter(
        (session) =>
          session.id !== primarySession.id && Boolean(session.tmux_pane_id) && !session.archived_at
      ),
    [primarySession.id, rosterSessions]
  );
  const secondaryId = hydrated && !belowDesktop ? rememberedSecondaryId : '';
  const {
    data: secondaryDetail,
    isLoading: secondaryLoading,
    isError: secondaryError,
  } = useQuery({
    queryKey: ['session', secondaryId],
    queryFn: () => getSession(secondaryId),
    enabled: Boolean(secondaryId),
  });
  const secondarySession = secondaryDetail?.session;

  useEffect(() => {
    if (!rosterSessions || !rememberedSecondaryId) return;
    if (options.some((session) => session.id === rememberedSecondaryId)) return;
    setSecondary(primarySession.id, null);
  }, [options, primarySession.id, rememberedSecondaryId, rosterSessions, setSecondary]);

  const showSecondary = Boolean(secondaryId);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="tmux-terminal-workspace">
      <div className="hidden min-h-10 items-center gap-2 border-b bg-background px-2 lg:flex">
        <Columns2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <label htmlFor={`secondary-terminal-${primarySession.id}`} className="text-xs font-medium">
          Two-up
        </label>
        <select
          id={`secondary-terminal-${primarySession.id}`}
          value={rememberedSecondaryId}
          onChange={(event) => setSecondary(primarySession.id, event.target.value || null)}
          className="h-8 min-w-0 max-w-sm flex-1 rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary"
          aria-label="Secondary terminal"
        >
          <option value="">Single terminal</option>
          {options.map((session) => (
            <option key={session.id} value={session.id}>
              {getSessionDisplayName(session)} · {session.tmux_target || session.tmux_pane_id}
            </option>
          ))}
        </select>
        {showSecondary && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setSecondary(primarySession.id, null)}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Close second
          </Button>
        )}
      </div>

      <div
        className={
          showSecondary ? 'grid min-h-0 flex-1 lg:grid-cols-2 lg:divide-x' : 'min-h-0 flex-1'
        }
      >
        <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label="Primary terminal">
          {showSecondary && <TerminalLabel label="Primary" session={primarySession} />}
          <TmuxWindowStrip session={primarySession} />
          <TmuxPaneControls session={primarySession} />
          <PersistentTerminalSlot
            sessionId={primarySession.id}
            paneId={primarySession.tmux_pane_id || undefined}
            autoAttach={autoAttachPrimary || showSecondary}
            controllerRef={primaryControllerRef}
            className="flex-1"
          />
        </section>

        {showSecondary && (
          <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label="Secondary terminal">
            {secondarySession ? (
              <>
                <TerminalLabel
                  label="Secondary"
                  session={secondarySession}
                  onClose={() => setSecondary(primarySession.id, null)}
                />
                <TmuxWindowStrip session={secondarySession} />
                <TmuxPaneControls session={secondarySession} />
                <TerminalView
                  sessionId={secondarySession.id}
                  paneId={secondarySession.tmux_pane_id || undefined}
                  autoAttach
                  className="flex-1"
                />
              </>
            ) : (
              <div
                className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground"
                role="status"
              >
                {secondaryError
                  ? 'The secondary terminal could not be loaded.'
                  : secondaryLoading
                    ? 'Loading secondary terminal…'
                    : 'Secondary terminal unavailable.'}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
