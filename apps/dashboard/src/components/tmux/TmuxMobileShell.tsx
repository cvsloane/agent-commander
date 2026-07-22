'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject, type ReactNode } from 'react';
import { ArrowLeft, ListTree, Maximize2, MoreHorizontal, PanelsTopLeft, Plus, RefreshCw, Rows3, TerminalSquare } from 'lucide-react';
import type { Host, Session, SessionWithSnapshot } from '@agent-command/schema';
import { StatusBadge } from '@/components/StatusBadge';
import { MobileLaunchSheet } from '@/components/launch/MobileLaunchSheet';
import { getWindowHereLaunchContext } from '@/components/launch/windowHere';
import type { TerminalController } from '@/components/TerminalView';
import { terminalHostStore } from '@/components/terminal/terminalHostStore';
import { Button } from '@/components/ui/button';
import { useTmuxHostTopology } from '@/hooks/useTmuxTopology';
import type { FleetRosterGroup } from '@/lib/fleetRoster';
import { cn, getSessionDisplayName, isHostOnline } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { getMobileFocusNavigation } from './mobileFocus';
import { TmuxActionSheet } from './TmuxActionSheet';
import { TmuxQuickSwitchStrip } from './TmuxQuickSwitchStrip';
import { TmuxRoster } from './TmuxRoster';
import { TmuxPaneSwitcher } from './TmuxPaneSwitcher';
import {
  ALL_TMUX_HOSTS_ID,
  type FleetRosterFilter,
} from '@/hooks/useTmuxRosterData';

type TmuxMobileMode = 'roster' | 'terminal' | 'actions';

export function PersistentTerminalRegion({
  visible,
  fullBleed = false,
  children,
}: {
  visible: boolean;
  fullBleed?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      hidden={!visible}
      aria-hidden={!visible}
      className={cn(
        'space-y-3',
        visible && 'command-center-mode-view',
        fullBleed && 'flex min-h-0 flex-1 flex-col space-y-0',
        !visible && 'hidden'
      )}
    >
      {children}
    </div>
  );
}

export function PersistentSessionTerminal({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  return <Fragment key={sessionId}>{children}</Fragment>;
}

interface TmuxMobileShellProps {
  hosts: Host[];
  selectedHostId: string;
  selectedHost?: Host;
  allHostsSelected: boolean;
  partialHostFailureCount: number;
  onSelectHost: (hostId: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  activeFilter: FleetRosterFilter;
  onFilterChange: (filter: FleetRosterFilter) => void;
  groups: FleetRosterGroup[];
  filteredSessions: SessionWithSnapshot[];
  quickSwitchSessions: SessionWithSnapshot[];
  sessionsLoading: boolean;
  sessionsError: unknown;
  sessionsFetching: boolean;
  hydrated: boolean;
  expandedClusterKey: string | null;
  onExpandedClusterKeyChange: (clusterKey: string | null) => void;
  selectedClusterKey: string | null;
  selectedWindowKey: string | null;
  selectedSessionId: string;
  selectedSession?: Session | null;
  selectedSessionHost?: Host;
  idlePending: boolean;
  terminating: boolean;
  onSelectSession: (sessionId: string) => Promise<boolean>;
  onRefresh: () => void;
  onIdleToggle: () => void;
  onSendTo: () => void;
  onOpenMcp: () => void;
  onTerminate: () => void;
  onLaunchChange: () => void;
  terminalControllerRef: MutableRefObject<TerminalController | null>;
  initialMode?: TmuxMobileMode;
  onAttachedModeChange?: (attached: boolean) => void;
  terminal: ReactNode;
  emptyTerminal: ReactNode;
}

export function TmuxMobileShell({
  hosts,
  selectedHostId,
  selectedHost,
  allHostsSelected,
  partialHostFailureCount,
  onSelectHost,
  query,
  onQueryChange,
  activeFilter,
  onFilterChange,
  groups,
  filteredSessions,
  quickSwitchSessions,
  sessionsLoading,
  sessionsError,
  sessionsFetching,
  hydrated,
  expandedClusterKey,
  onExpandedClusterKeyChange,
  selectedClusterKey,
  selectedWindowKey,
  selectedSessionId,
  selectedSession,
  selectedSessionHost,
  idlePending,
  terminating,
  onSelectSession,
  onRefresh,
  onIdleToggle,
  onSendTo,
  onOpenMcp,
  onTerminate,
  onLaunchChange,
  terminalControllerRef,
  initialMode = 'roster',
  onAttachedModeChange,
  terminal,
  emptyTerminal,
}: TmuxMobileShellProps) {
  const [mode, setMode] = useState<TmuxMobileMode>(initialMode);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [paneSwitcherOpen, setPaneSwitcherOpen] = useState(false);
  const previousSelectedSessionIdRef = useRef(selectedSessionId);
  const previousFocusTargetRef = useRef<string | null>(null);
  const focusRequestedRef = useRef(false);
  const focusCleanupTimerRef = useRef<number | null>(null);
  const autoFocusPane = useSettingsStore((state) => state.autoFocusPane);
  const setAutoFocusPane = useSettingsStore((state) => state.setAutoFocusPane);
  const topology = useTmuxHostTopology(selectedSession?.host_id ?? '');
  const terminalSnapshot = useSyncExternalStore(
    terminalHostStore.subscribe,
    terminalHostStore.getSnapshot,
    terminalHostStore.getServerSnapshot
  );

  useEffect(() => {
    if (previousSelectedSessionIdRef.current && !selectedSessionId && mode !== 'roster') {
      setMode('roster');
    }
    previousSelectedSessionIdRef.current = selectedSessionId;
  }, [mode, selectedSessionId]);

  useEffect(() => {
    if (initialMode === 'terminal' && selectedSessionId) {
      setMode('terminal');
    }
  }, [initialMode, selectedSessionId]);

  const terminalVisible = mode === 'terminal' || mode === 'actions';
  const attachedMode = terminalVisible && Boolean(selectedSessionId);
  const selectedTmuxSessionName = selectedSession?.tmux_session_name
    || selectedSession?.metadata?.tmux?.session_name
    || selectedSession?.tmux_target?.split(':')[0];
  const selectedTmuxSessionKey = selectedSession && selectedTmuxSessionName
    ? `${selectedSession.host_id}\u0000${selectedTmuxSessionName}`
    : undefined;
  const selectedTargetIndexes = selectedSession?.tmux_target?.match(/:(\d+)(?:\.(\d+))?$/);
  const selectedWindowIndex = selectedSession?.tmux_window_index
    ?? selectedSession?.metadata?.tmux?.window_index
    ?? (selectedTargetIndexes?.[1] === undefined ? undefined : Number(selectedTargetIndexes[1]));
  const selectedTopologyWindow = topology?.sessions
    .find((session) => session.sessionName === selectedTmuxSessionName)
    ?.windows.find((window) => window.windowIndex === selectedWindowIndex);
  const focusPaneCount = selectedTopologyWindow?.panes.length ?? 0;
  const focusZoomed = topology?.source === 'topology' && Boolean(selectedTopologyWindow?.zoomed);
  const focusTargetKey = selectedSession && selectedTmuxSessionName && selectedWindowIndex !== undefined
    ? `${selectedSession.host_id}:${selectedTmuxSessionName}:${selectedWindowIndex}:${selectedSession.tmux_pane_id ?? ''}`
    : null;
  const focusConnected = terminalSnapshot.status === 'connected'
    && terminalSnapshot.attachmentDescriptor?.tmuxSessionKey === selectedTmuxSessionKey
    && terminalSnapshot.navigation?.status !== 'pending';

  const sendFocus = useCallback(async (on: boolean) => {
    if (!selectedSession) return false;
    focusRequestedRef.current = on;
    const result = await terminalHostStore.focusWithinAttachment({
      sessionId: selectedSession.id,
      hostId: selectedSession.host_id,
      paneId: selectedSession.tmux_pane_id || undefined,
      tmuxSessionKey: selectedTmuxSessionKey,
      autoAttach: true,
    }, on);
    if (result.status === 'success') return true;
    focusRequestedRef.current = false;
    if (result.status === 'error') return { ok: false, message: result.message };
    if (result.status === 'unavailable') {
      return { ok: false, message: 'The terminal is still connecting.' };
    }
    return { ok: false, message: 'The selected pane changed before focus was confirmed.' };
  }, [selectedSession, selectedTmuxSessionKey]);
  const sendFocusRef = useRef(sendFocus);
  sendFocusRef.current = sendFocus;

  useEffect(() => {
    const navigation = getMobileFocusNavigation({
      autoFocusPane,
      connected: focusConnected,
      focusRequested: focusRequestedRef.current,
      paneCount: focusPaneCount,
      previousTargetKey: previousFocusTargetRef.current,
      targetKey: focusTargetKey,
      terminalVisible,
      zoomed: focusZoomed,
    });
    if (navigation?.op === 'zoom') {
      void sendFocus(navigation.on);
    }
    previousFocusTargetRef.current = terminalVisible ? focusTargetKey : null;
  }, [
    autoFocusPane,
    focusConnected,
    focusPaneCount,
    focusTargetKey,
    focusZoomed,
    sendFocus,
    terminalVisible,
  ]);

  useEffect(() => {
    if (focusCleanupTimerRef.current !== null) {
      window.clearTimeout(focusCleanupTimerRef.current);
      focusCleanupTimerRef.current = null;
    }
    return () => {
      focusCleanupTimerRef.current = window.setTimeout(() => {
        if (focusRequestedRef.current) {
          void sendFocusRef.current(false);
          focusRequestedRef.current = false;
        }
        focusCleanupTimerRef.current = null;
      }, 0);
    };
  }, []);

  const handleFocusToggle = useCallback(() => {
    const next = !(focusZoomed || focusRequestedRef.current);
    setAutoFocusPane(next);
    void sendFocus(next);
  }, [focusZoomed, sendFocus, setAutoFocusPane]);

  const handleLeaveTerminal = useCallback(() => {
    void sendFocus(false);
    terminalControllerRef.current?.resetTouchModes();
    setMode('roster');
  }, [sendFocus, terminalControllerRef]);

  const handleDetach = useCallback(() => {
    void sendFocus(false);
    terminalControllerRef.current?.resetTouchModes();
    terminalControllerRef.current?.detach();
  }, [sendFocus, terminalControllerRef]);

  useEffect(() => {
    onAttachedModeChange?.(attachedMode);
    const root = document.documentElement;
    if (attachedMode) root.setAttribute('data-mobile-terminal-attached', 'true');
    else root.removeAttribute('data-mobile-terminal-attached');
    return () => root.removeAttribute('data-mobile-terminal-attached');
  }, [attachedMode, onAttachedModeChange]);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    const selected = await onSelectSession(sessionId);
    if (selected) setMode('terminal');
    return selected;
  }, [onSelectSession]);

  const handleOpenActions = useCallback((sessionId: string) => {
    void onSelectSession(sessionId);
    setMode('actions');
  }, [onSelectSession]);

  const actionSheetOpen = mode === 'actions';
  const hostForStatus = selectedSessionHost || selectedHost;
  const selectedTitle = selectedSession ? getSessionDisplayName(selectedSession) : 'No pane selected';
  const selectedWindowName = selectedSession?.metadata?.tmux?.window_name
    || selectedSession?.tmux_target?.split(':')[1]?.split('.')[0]
    || 'window';
  const activeTerminalSnapshot = terminalSnapshot.descriptor?.sessionId === selectedSessionId
    ? terminalSnapshot
    : null;
  const connectionLabel = activeTerminalSnapshot?.status === 'connected' && activeTerminalSnapshot.readOnly
    ? 'Read-only'
    : activeTerminalSnapshot?.status === 'connected'
      ? 'Connected'
      : activeTerminalSnapshot?.status === 'connecting'
        ? 'Connecting'
        : activeTerminalSnapshot?.status === 'reconnecting'
          ? 'Reconnecting'
          : activeTerminalSnapshot?.status === 'error'
            ? 'Error'
            : 'Detached';
  const visibleConnectionLabel = terminalSnapshot.navigation?.status === 'pending'
    ? 'Switching'
    : terminalSnapshot.navigation?.status === 'error'
      ? 'Switch failed'
      : connectionLabel;
  const connectionTone = visibleConnectionLabel === 'Connected'
    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : visibleConnectionLabel === 'Read-only'
      ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : visibleConnectionLabel === 'Error' || visibleConnectionLabel === 'Switch failed'
        ? 'border-destructive/50 bg-destructive/10 text-destructive'
        : 'border-border bg-muted text-muted-foreground';
  const windowHere = useMemo(
    () => terminalVisible && selectedSession
      ? getWindowHereLaunchContext(selectedSession)
      : undefined,
    [selectedSession, terminalVisible]
  );

  return (
    <div className={cn(
      'space-y-3 pb-[env(safe-area-inset-bottom)] lg:hidden',
      attachedMode && 'fixed inset-0 z-50 flex h-dvh min-h-0 flex-col space-y-0 bg-background pb-0'
    )}>
      <div
        className={cn(
          'z-30 flex h-10 shrink-0 items-center gap-1 border-b bg-background/95 px-1 backdrop-blur',
          !attachedMode && 'hidden'
        )}
        data-testid="tmux-attached-status"
      >
        <button
          type="button"
          onClick={handleLeaveTerminal}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label="Back to tmux roster"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1 truncate px-1 text-xs font-medium">
          <span>{selectedTitle}</span>
          <span className="px-1 text-muted-foreground" aria-hidden="true">·</span>
          <span className="text-muted-foreground">{selectedWindowName}</span>
        </div>
        <span
          className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium', connectionTone)}
          role="status"
          title={terminalSnapshot.navigation?.message}
        >
          {visibleConnectionLabel}
        </span>
        <button
          type="button"
          onClick={handleFocusToggle}
          disabled={!focusConnected || focusPaneCount <= 1}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-40',
            focusZoomed && 'bg-primary/15 text-primary'
          )}
          aria-label={focusZoomed ? 'Exit pane focus' : 'Focus pane'}
          aria-pressed={focusZoomed}
          title={focusZoomed ? 'Exit pane focus' : 'Focus pane'}
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setPaneSwitcherOpen(true)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label="Open pane switcher"
          aria-expanded={paneSwitcherOpen}
        >
          <PanelsTopLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setMode('actions')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label="Open pane actions"
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className={cn(
        'sticky top-0 z-30 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur',
        attachedMode && 'hidden'
      )}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Rows3 className="h-4 w-4 text-primary" />
              <div className="text-sm font-semibold">tmux</div>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {mode === 'roster'
                ? allHostsSelected ? 'All online machines' : selectedHost?.name || 'Select host'
                : selectedSession?.tmux_target || selectedTitle}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="default"
              size="mobile-icon"
              onClick={() => setLaunchOpen(true)}
              aria-label="Launch agent"
            >
              <Plus className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="mobile-icon"
              onClick={onRefresh}
              aria-label="Refresh tmux roster"
            >
              <RefreshCw className={cn('h-4 w-4', sessionsFetching && 'animate-spin')} />
            </Button>
            <Button
              variant="ghost"
              size="mobile-icon"
              onClick={() => setMode('actions')}
              disabled={!selectedSession}
              aria-label="Open pane actions"
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1 rounded-md border bg-muted p-1">
          <button
            type="button"
            onClick={() => setMode('roster')}
            className={cn(
              'flex h-10 items-center justify-center gap-2 rounded px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              mode === 'roster' ? 'bg-background shadow-sm' : 'text-muted-foreground'
            )}
          >
            <ListTree className="h-4 w-4" />
            Roster
          </button>
          <button
            type="button"
            onClick={() => setMode('terminal')}
            disabled={!selectedSessionId}
            className={cn(
              'flex h-10 items-center justify-center gap-2 rounded px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              mode === 'terminal' ? 'bg-background shadow-sm' : 'text-muted-foreground'
            )}
          >
            <TerminalSquare className="h-4 w-4" />
            Terminal
          </button>
          <button
            type="button"
            onClick={() => setMode('actions')}
            disabled={!selectedSession}
            className={cn(
              'flex h-10 items-center justify-center gap-2 rounded px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              mode === 'actions' ? 'bg-background shadow-sm' : 'text-muted-foreground'
            )}
          >
            <MoreHorizontal className="h-4 w-4" />
            Actions
          </button>
        </div>
      </div>

      {mode === 'roster' && (
        <div className="command-center-mode-view space-y-3">
          <div className="-mx-4 overflow-x-auto px-4">
            <div className="flex min-w-max gap-2">
              <button
                type="button"
                onClick={() => onSelectHost(ALL_TMUX_HOSTS_ID)}
                disabled={!hosts.some((host) => isHostOnline(host.last_seen_at ?? null))}
                className={cn(
                  'inline-flex h-11 items-center gap-2 rounded-md border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  allHostsSelected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background disabled:opacity-50'
                )}
              >
                <span className="font-medium">All machines</span>
              </button>
              {hosts.map((host) => {
                const active = host.id === selectedHostId;
                const online = isHostOnline(host.last_seen_at ?? null);
                return (
                  <button
                    key={host.id}
                    type="button"
                    onClick={() => onSelectHost(host.id)}
                    className={cn(
                      'inline-flex h-11 items-center gap-2 rounded-md border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background'
                    )}
                  >
                    <span className={cn('h-2 w-2 rounded-full', online ? 'bg-emerald-500' : 'bg-muted-foreground')} />
                    <span className="font-medium">{host.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <TmuxRoster
            selectedHost={selectedHost}
            hosts={hosts}
            allHostsSelected={allHostsSelected}
            partialHostFailureCount={partialHostFailureCount}
            query={query}
            onQueryChange={onQueryChange}
            activeFilter={activeFilter}
            onFilterChange={onFilterChange}
            groups={groups}
            filteredSessions={filteredSessions}
            sessionsLoading={sessionsLoading}
            sessionsError={sessionsError}
            hydrated={hydrated}
            expandedClusterKey={expandedClusterKey}
            onExpandedClusterKeyChange={onExpandedClusterKeyChange}
            selectedClusterKey={selectedClusterKey}
            selectedWindowKey={selectedWindowKey}
            selectedSessionId={selectedSessionId}
            onSelectSession={handleSelectSession}
            onOpenActions={handleOpenActions}
          />
        </div>
      )}

      <PersistentTerminalRegion visible={terminalVisible} fullBleed={attachedMode}>
          {!attachedMode && (
          <TmuxQuickSwitchStrip
            sessions={quickSwitchSessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={handleSelectSession}
          />
          )}

          {!attachedMode && terminalVisible && selectedSession && (
            <div className="rounded-lg border bg-card px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{selectedTitle}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {selectedSession.tmux_target || selectedSession.cwd || hostForStatus?.name || 'tmux pane'}
                  </div>
                </div>
                <StatusBadge
                  status={selectedSession.status}
                  host={hostForStatus}
                  className="h-7 shrink-0 px-2 py-0 text-xs"
                />
              </div>
            </div>
          )}

          {selectedSessionId ? (
            <PersistentSessionTerminal sessionId={selectedSessionId}>
              {terminal}
            </PersistentSessionTerminal>
          ) : emptyTerminal}
      </PersistentTerminalRegion>

      <TmuxActionSheet
        open={actionSheetOpen}
        session={selectedSession}
        terminalControllerRef={terminalControllerRef}
        idlePending={idlePending}
        terminating={terminating}
        onClose={() => setMode(selectedSessionId ? 'terminal' : 'roster')}
        onDetach={handleDetach}
        onIdleToggle={onIdleToggle}
        onSendTo={onSendTo}
        onOpenMcp={onOpenMcp}
        onTerminate={onTerminate}
        onLaunchWindowHere={windowHere ? () => { setMode(selectedSessionId ? 'terminal' : 'roster'); setLaunchOpen(true); } : undefined}
        onSelectSession={handleSelectSession}
        onSetPaneFocus={sendFocus}
        paneFocusAvailable={focusConnected}
      />
      <TmuxPaneSwitcher
        open={paneSwitcherOpen}
        sessions={quickSwitchSessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={handleSelectSession}
        navigationError={terminalSnapshot.navigation?.status === 'error'
          ? terminalSnapshot.navigation.message
          : undefined}
        onClose={() => setPaneSwitcherOpen(false)}
      />
      <MobileLaunchSheet
        open={launchOpen}
        initialView={windowHere ? 'window' : 'new'}
        selectedHostId={selectedHostId}
        windowHere={windowHere}
        onClose={() => setLaunchOpen(false)}
        onLaunched={onLaunchChange}
      />
    </div>
  );
}
