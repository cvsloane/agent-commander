'use client';

import { useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Rows3 } from 'lucide-react';
import { assignSessionGroup } from '@/lib/api';
import { useSessionDetail } from '@/hooks/useSessionDetail';
import { useSessionIdle } from '@/hooks/useSessionIdle';
import { useTerminateSession } from '@/hooks/useTerminateSession';
import { MCPManagerModal, useMCPManager } from '@/components/mcp/MCPManagerModal';
import { SendToSessionDialog } from '@/components/SendToSessionDialog';
import type { TerminalController } from '@/components/TerminalView';
import { SessionWorkbench } from '@/components/session/SessionWorkbench';
import { TmuxDesktopShell } from '@/components/tmux/TmuxDesktopShell';
import { TmuxMobileShell } from '@/components/tmux/TmuxMobileShell';
import { TmuxWorkbenchHeader } from '@/components/tmux/TmuxWorkbenchHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, getSessionDisplayName } from '@/lib/utils';
import { useHydrated } from '@/hooks/useHydrated';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTmuxRosterData } from '@/hooks/useTmuxRosterData';

export default function TmuxPageClient() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();
  const isMobileLayout = useIsMobile(1024);
  const mcpManager = useMCPManager();
  const terminalControllerRef = useRef<TerminalController | null>(null);
  const { setSessionIdle, isSessionIdlePending } = useSessionIdle();
  const { terminateSession, isTerminating } = useTerminateSession();
  const [workbenchViewMode, setWorkbenchViewMode] = useState<'console' | 'terminal'>('terminal');
  const [sendToDialogOpen, setSendToDialogOpen] = useState(false);
  const [sendToTargetId, setSendToTargetId] = useState<string | undefined>(undefined);
  const terminalModeRequested = searchParams.get('mode') === 'terminal';
  const autoAttachRequested = searchParams.get('attach') === '1';
  const {
    query,
    activeFilter,
    updateTmuxParams,
    hostsLoading,
    tmuxHosts,
    selectedHostId,
    selectedHost,
    sessionsLoading,
    sessionsError,
    sessionsFetching,
    filteredSessions,
    groups,
    allHostsSelected,
    partialHostFailureCount,
    selectedSessionId,
    selectedClusterKey,
    selectedWindowKey,
    expandedClusterKey,
    setExpandedClusterKey,
    refreshRoster,
    invalidateRoster,
    selectHost,
    selectSession,
  } = useTmuxRosterData();

  const {
    data: sessionDetailData,
    session: selectedSession,
    snapshot,
    events,
    host: selectedSessionHost,
    isLoading: selectedSessionLoading,
    refetch: refetchSelectedSession,
  } = useSessionDetail(selectedSessionId || null);

  const handleRefresh = useCallback(() => {
    refreshRoster();
    if (selectedSessionId) {
      void refetchSelectedSession();
    }
  }, [refetchSelectedSession, refreshRoster, selectedSessionId]);

  const handleAssignGroup = async (groupId: string | null) => {
    if (!selectedSessionId) return;
    try {
      await assignSessionGroup(selectedSessionId, groupId);
      await refetchSelectedSession();
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      invalidateRoster();
    } catch (error) {
      console.error('Failed to assign session to group:', error);
    }
  };

  const handleSendToFromLinks = (targetSessionId: string) => {
    setSendToTargetId(targetSessionId);
    setSendToDialogOpen(true);
  };

  const handleCloseSendToDialog = () => {
    setSendToDialogOpen(false);
    setSendToTargetId(undefined);
  };

  const handleIdleToggle = async () => {
    if (!selectedSession || !selectedSessionId) return;
    const pending = isSessionIdlePending(selectedSessionId);
    if (pending) return;
    try {
      await setSessionIdle(selectedSessionId, !selectedSession.idled_at);
      await refetchSelectedSession();
      invalidateRoster();
    } catch (error) {
      console.error('Failed to update idle state:', error);
    }
  };

  const handleTerminate = async () => {
    if (!selectedSession || isTerminating) return;
    const confirmed = window.confirm(
      `Terminate "${getSessionDisplayName(selectedSession)}"? This will archive the session.`
    );
    if (!confirmed) return;
    try {
      await terminateSession(selectedSession);
      invalidateRoster();
    } catch (error) {
      console.error('Failed to terminate session:', error);
    }
  };

  const emptyWorkbench = (
    <Card>
      <CardHeader>
        <CardTitle>tmux Workbench</CardTitle>
        <CardDescription>Choose a tmux pane from the roster to open it here.</CardDescription>
      </CardHeader>
    </Card>
  );

  const loadingWorkbench = (
    <Card>
      <CardContent className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </CardContent>
    </Card>
  );

  const renderWorkbench = (options?: { mobileTerminalOnly?: boolean }) => {
    if (!selectedSessionId) {
      return emptyWorkbench;
    }
    if (selectedSessionLoading || !selectedSession || !sessionDetailData) {
      return loadingWorkbench;
    }

    return (
      <>
        {!options?.mobileTerminalOnly && (
          <TmuxWorkbenchHeader
            session={selectedSession}
            host={selectedSessionHost || selectedHost}
            idlePending={isSessionIdlePending(selectedSession.id)}
            terminating={isTerminating}
            onIdleToggle={handleIdleToggle}
            onSendTo={() => setSendToDialogOpen(true)}
            onOpenMcp={() => mcpManager.open(selectedSession.id, selectedSession.repo_root || undefined)}
            onTerminate={handleTerminate}
          />
        )}

        <SessionWorkbench
          session={selectedSession}
          snapshot={snapshot}
          events={events}
          onAssignGroup={handleAssignGroup}
          onSendToLinkedSession={handleSendToFromLinks}
          viewMode={workbenchViewMode}
          onViewModeChange={setWorkbenchViewMode}
          initialView="terminal"
          showDetails={!options?.mobileTerminalOnly}
          terminalCardClassName={options?.mobileTerminalOnly ? 'h-[calc(100dvh-15rem)] min-h-[420px]' : undefined}
          autoAttachTerminal={autoAttachRequested}
          terminalControllerRef={terminalControllerRef}
        />
      </>
    );
  };

  if (!hostsLoading && tmuxHosts.length === 0) {
    return (
      <div className="container mx-auto px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-xl">
              <Rows3 className="h-5 w-5 text-primary" />
              tmux
            </CardTitle>
            <CardDescription>
              No tmux-capable hosts are registered yet. Connect an `agentd` host with tmux support to use the tmux manager.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 py-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Rows3 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">tmux</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Work from the machine’s live tmux windows directly. Sessions and automation remain available as separate operator views.
          </p>
        </div>
        <Button variant="outline" onClick={handleRefresh} className="gap-2 self-start">
          <RefreshCw className={cn('h-4 w-4', sessionsFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {isMobileLayout ? (
        <TmuxMobileShell
          hosts={tmuxHosts}
          selectedHostId={selectedHostId}
          selectedHost={selectedHost}
          allHostsSelected={allHostsSelected}
          partialHostFailureCount={partialHostFailureCount}
          onSelectHost={selectHost}
          query={query}
          onQueryChange={(nextQuery) => updateTmuxParams({ q: nextQuery || null })}
          activeFilter={activeFilter}
          onFilterChange={(nextFilter) => updateTmuxParams({ filter: nextFilter === 'all' ? null : nextFilter })}
          groups={groups}
          filteredSessions={filteredSessions}
          sessionsLoading={sessionsLoading}
          sessionsError={sessionsError}
          sessionsFetching={sessionsFetching}
          hydrated={hydrated}
          expandedClusterKey={expandedClusterKey}
          onExpandedClusterKeyChange={setExpandedClusterKey}
          selectedClusterKey={selectedClusterKey}
          selectedWindowKey={selectedWindowKey}
          selectedSessionId={selectedSessionId}
          selectedSession={selectedSession}
          selectedSessionHost={selectedSessionHost || selectedHost}
          idlePending={selectedSession ? isSessionIdlePending(selectedSession.id) : false}
          terminating={isTerminating}
          onSelectSession={selectSession}
          onRefresh={handleRefresh}
          onIdleToggle={handleIdleToggle}
          onSendTo={() => setSendToDialogOpen(true)}
          onOpenMcp={() => selectedSession && mcpManager.open(selectedSession.id, selectedSession.repo_root || undefined)}
          onTerminate={handleTerminate}
          onLaunchChange={handleRefresh}
          terminalControllerRef={terminalControllerRef}
          initialMode={terminalModeRequested && selectedSessionId ? 'terminal' : 'roster'}
          terminal={renderWorkbench({ mobileTerminalOnly: true })}
          emptyTerminal={emptyWorkbench}
        />
      ) : (
        <TmuxDesktopShell
          hosts={tmuxHosts}
          selectedHostId={selectedHostId}
          selectedHost={selectedHost}
          allHostsSelected={allHostsSelected}
          partialHostFailureCount={partialHostFailureCount}
          onSelectHost={selectHost}
          query={query}
          onQueryChange={(nextQuery) => updateTmuxParams({ q: nextQuery || null })}
          activeFilter={activeFilter}
          onFilterChange={(nextFilter) => updateTmuxParams({ filter: nextFilter === 'all' ? null : nextFilter })}
          groups={groups}
          filteredSessions={filteredSessions}
          sessionsLoading={sessionsLoading}
          sessionsError={sessionsError}
          hydrated={hydrated}
          expandedClusterKey={expandedClusterKey}
          onExpandedClusterKeyChange={setExpandedClusterKey}
          selectedClusterKey={selectedClusterKey}
          selectedWindowKey={selectedWindowKey}
          selectedSessionId={selectedSessionId}
          onSelectSession={selectSession}
          workbench={renderWorkbench()}
        />
      )}

      {mcpManager.sessionId && (
        <MCPManagerModal
          isOpen={mcpManager.isOpen}
          onClose={mcpManager.close}
          sessionId={mcpManager.sessionId}
          repoRoot={mcpManager.repoRoot}
        />
      )}

      {selectedSession && (
        <SendToSessionDialog
          isOpen={sendToDialogOpen}
          onClose={handleCloseSendToDialog}
          sourceSession={selectedSession}
          initialTargetSessionId={sendToTargetId}
        />
      )}
    </div>
  );
}
