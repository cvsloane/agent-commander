'use client';

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type MutableRefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Columns2, X } from 'lucide-react';
import type { Session } from '@agent-command/schema';
import { TerminalView, type TerminalController } from '@/components/TerminalView';
import { PersistentTerminalSlot } from '@/components/terminal/PersistentTerminalHost';
import { terminalHostStore } from '@/components/terminal/terminalHostStore';
import { TerminalAttentionOverlay } from '@/components/orchestrator/TerminalAttentionOverlay';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/useHydrated';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getLetterboxDimensions, type TerminalGridDimensions } from '@/hooks/terminalGrid';
import { getSession } from '@/lib/api';
import { getSessionDisplayName } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { getTmuxViewerSessionKey } from '@/hooks/tmuxNavigation';
import { useTmuxTopologyStore } from '@/stores/tmuxTopology';
import { TmuxPaneControls } from './TmuxPaneControls';
import { TmuxWindowStrip } from './TmuxWindowStrip';
import type { OrchestratorItem } from '@/stores/orchestrator';
import { PromptComposer, type PromptComposerHandle } from './PromptComposer';

interface TmuxTerminalWorkspaceProps {
  primarySession: Session;
  autoAttachPrimary?: boolean;
  hideCollapsedPrompt?: boolean;
  primaryControllerRef?: MutableRefObject<TerminalController | null>;
  onAttentionRespond?: (item: OrchestratorItem) => void;
  onSendToOtherSession?: (targetSessionId: string) => void;
  onSelectSession?: (sessionId: string) => void | boolean | Promise<boolean>;
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
  hideCollapsedPrompt = false,
  primaryControllerRef,
  onAttentionRespond,
  onSendToOtherSession,
  onSelectSession,
}: TmuxTerminalWorkspaceProps) {
  const promptComposerRef = useRef<PromptComposerHandle>(null);
  const terminalHostSnapshot = useSyncExternalStore(
    terminalHostStore.subscribe,
    terminalHostStore.getSnapshot,
    terminalHostStore.getServerSnapshot
  );
  const hydrated = useHydrated();
  const belowDesktop = useIsMobile(1024);
  const rememberedSecondaryId = useSettingsStore(
    (state) => state.tmuxSecondaryByPrimary[primarySession.id] ?? ''
  );
  const setSecondary = useSettingsStore((state) => state.setTmuxSecondary);
  const rosterSessions = useTmuxTopologyStore(
    (state) => state.rosterByHost[primarySession.host_id]
  );
  const hostTopology = useTmuxTopologyStore((state) => state.hosts[primarySession.host_id]);
  // Freeze letterbox dims for the lifetime of a session attachment: deriving
  // them from LIVE topology creates a feedback loop (our own attach pins the
  // window size, topology reports the new layout, dims change, the terminal
  // remounts, detach releases the pin, dims flip back — attach/detach forever).
  const frozenLetterboxRef = useRef<{ key: string; dims: TerminalGridDimensions | undefined } | null>(null);
  const primaryLetterbox = useMemo(() => {
    const attachmentKey = `${primarySession.id}\u0000${primarySession.tmux_pane_id || ''}`;
    if (frozenLetterboxRef.current?.key !== attachmentKey) {
      frozenLetterboxRef.current = {
        key: attachmentKey,
        dims: getLetterboxDimensions(hostTopology, primarySession),
      };
    }
    return frozenLetterboxRef.current.dims;
    // Topology churn is deliberately excluded: dims are frozen per attachment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primarySession.id, primarySession.tmux_pane_id]);
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
  const readOnly = terminalHostSnapshot.descriptor?.sessionId === primarySession.id
    && terminalHostSnapshot.readOnly;
  const interactionBlocked = terminalHostSnapshot.navigation?.status === 'pending';
  const primaryTmuxSessionKey = getTmuxViewerSessionKey(primarySession);
  const paneFocusAvailable = terminalHostSnapshot.status === 'connected'
    && terminalHostSnapshot.attachmentDescriptor?.tmuxSessionKey === primaryTmuxSessionKey
    && !interactionBlocked;
  const setPrimaryPaneFocus = useCallback(async (focused: boolean) => {
    const result = await terminalHostStore.focusWithinAttachment({
      sessionId: primarySession.id,
      hostId: primarySession.host_id,
      paneId: primarySession.tmux_pane_id || undefined,
      tmuxSessionKey: getTmuxViewerSessionKey(primarySession),
      autoAttach: true,
    }, focused);
    if (result.status === 'success') return true;
    if (result.status === 'error') return { ok: false, message: result.message };
    if (result.status === 'unavailable') {
      return { ok: false, message: 'The terminal is still connecting.' };
    }
    return { ok: false, message: 'The selected pane changed before focus was confirmed.' };
  }, [primarySession]);

  return (
    <div
      className={belowDesktop
        ? 'flex h-full min-h-0 flex-col'
        : 'flex h-full min-h-[420px] flex-col'}
      data-testid="tmux-terminal-workspace"
      data-terminal-workspace
    >
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
          <TmuxWindowStrip session={primarySession} onSelectSession={onSelectSession} />
          <TmuxPaneControls
            session={primarySession}
            onSelectSession={onSelectSession}
            onSetPaneFocus={setPrimaryPaneFocus}
            paneFocusAvailable={paneFocusAvailable}
          />
          <div className="relative min-h-0 flex-1">
            <PersistentTerminalSlot
              sessionId={primarySession.id}
              hostId={primarySession.host_id}
              paneId={primarySession.tmux_pane_id || undefined}
              tmuxSessionKey={getTmuxViewerSessionKey(primarySession)}
              autoAttach={autoAttachPrimary || showSecondary}
              letterbox={primaryLetterbox}
              preferLocalChat={primarySession.provider === 'claude_code'}
              controllerRef={primaryControllerRef}
              className="h-full"
            />
            <TerminalAttentionOverlay
              sessionId={primarySession.id}
              readOnly={readOnly}
              onRespond={(item) => {
                promptComposerRef.current?.openAndFocus();
                onAttentionRespond?.(item);
              }}
            />
          </div>
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
                  hostId={secondarySession.host_id}
                  paneId={secondarySession.tmux_pane_id || undefined}
                  tmuxSessionKey={getTmuxViewerSessionKey(secondarySession)}
                  autoAttach
                  preferLocalChat={secondarySession.provider === 'claude_code'}
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
      <PromptComposer
        ref={promptComposerRef}
        session={primarySession}
        readOnly={readOnly}
        interactionBlocked={interactionBlocked}
        hideCollapsed={hideCollapsedPrompt && primarySession.provider !== 'claude_code'}
        onSendToOtherSession={onSendToOtherSession}
      />
    </div>
  );
}
