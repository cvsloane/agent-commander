'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Check, X, Plug, Send, ChevronLeft, Moon, Sun, Power } from 'lucide-react';
import Link from 'next/link';
import { assignSessionGroup, updateSession } from '@/lib/api';
import { SessionWorkbench } from '@/components/session/SessionWorkbench';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { getProviderIcon, getSessionDisplayName } from '@/lib/utils';
import { MCPManagerModal, useMCPManager } from '@/components/mcp/MCPManagerModal';
import { SendToSessionDialog } from '@/components/SendToSessionDialog';
import { useSessionDetail } from '@/hooks/useSessionDetail';
import { useTerminateSession } from '@/hooks/useTerminateSession';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useSessionIdle } from '@/hooks/useSessionIdle';
import { cn } from '@/lib/utils';

export default function SessionDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const sessionId = params.id as string;

  // Check for view=terminal URL parameter
  const initialView = searchParams.get('view') === 'terminal' ? 'terminal' : 'console';

  // Inline editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [originalTitle, setOriginalTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // MCP Manager
  const mcpManager = useMCPManager();

  // Send to Session Dialog
  const [sendToDialogOpen, setSendToDialogOpen] = useState(false);
  const [sendToTargetId, setSendToTargetId] = useState<string | undefined>(undefined);

  // Console/Terminal view toggle - initialized from URL param
  const [viewMode, setViewMode] = useState<'console' | 'terminal'>(initialView);
  const isMobile = useIsMobile();
  const { setSessionIdle, isSessionIdlePending } = useSessionIdle();
  const { terminateSession, isTerminating } = useTerminateSession();

  const handleSendToFromLinks = (targetSessionId: string) => {
    setSendToTargetId(targetSessionId);
    setSendToDialogOpen(true);
  };

  const handleCloseSendToDialog = () => {
    setSendToDialogOpen(false);
    setSendToTargetId(undefined);
  };

  const handleTerminate = async () => {
    if (!data?.session) return;
    if (isTerminating) return;
    const confirmTerminate = window.confirm(
      `Terminate "${getSessionDisplayName(data.session)}"? This will archive the session.`
    );
    if (!confirmTerminate) return;
    try {
      await terminateSession(data.session);
    } catch (error) {
      console.error('Failed to terminate session:', error);
    }
  };

  const queryClient = useQueryClient();
  const { data, host, isLoading, error, refetch } = useSessionDetail(sessionId);

  // Sync view mode when URL parameter changes
  useEffect(() => {
    const urlView = searchParams.get('view');
    setViewMode(urlView === 'terminal' ? 'terminal' : 'console');
  }, [searchParams]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEditing = () => {
    const session = data?.session;
    const displayTitle = session?.title || session?.git_branch || 'Untitled Session';
    const initial = session?.title || displayTitle;
    setEditValue(initial);
    setOriginalTitle(initial);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditValue('');
    setOriginalTitle('');
  };

  const saveTitle = async () => {
    const next = editValue.trim();
    const original = originalTitle.trim();
    if (!next || next === original) {
      cancelEditing();
      return;
    }

    setIsSaving(true);
    try {
      await updateSession(sessionId, { title: next });
      await refetch();
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update session title:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignGroup = async (groupId: string | null) => {
    try {
      await assignSessionGroup(sessionId, groupId);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    } catch (error) {
      console.error('Failed to assign session to group:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
    }
  };

  // Global keyboard shortcut for MCP Manager
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Don't trigger if modifiers are pressed
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      // 'M' to open MCP Manager
      if (e.key === 'M' && e.shiftKey) {
        e.preventDefault();
        if (data?.session) {
          mcpManager.open(sessionId, data.session.repo_root || undefined);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [data?.session, sessionId, mcpManager]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto w-full max-w-7xl px-3 py-4 text-center sm:px-4 sm:py-6">
        <p className="text-destructive mb-4">Failed to load session</p>
        <Button size="mobile" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const { session, snapshot, events } = data;
  const tmuxMeta = session.metadata?.tmux as { session_name?: string; window_name?: string } | undefined;
  const windowName = tmuxMeta?.window_name?.trim();
  const tmuxLabel = session.tmux_target || (tmuxMeta?.session_name && windowName ? `${tmuxMeta.session_name}:${windowName}` : '');
  const isManualIdle = !!session.idled_at;
  const idlePending = isSessionIdlePending(sessionId);

  const handleIdleToggle = async () => {
    if (idlePending) return;
    try {
      await setSessionIdle(sessionId, !isManualIdle);
    } catch (error) {
      console.error('Failed to update idle state:', error);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
      {/* Header */}
      <div className={cn(
        'flex items-start justify-between mb-6',
        isMobile && 'flex-col gap-3 mb-4'
      )}>
        <div className="flex items-center gap-3 w-full">
          {/* Back button on mobile */}
          {isMobile && (
            <Link href="/sessions">
              <Button variant="ghost" size="mobile-icon" className="shrink-0" aria-label="Back to sessions">
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </Button>
            </Link>
          )}

          <div className={cn(
            'rounded-full bg-muted flex items-center justify-center font-mono font-bold shrink-0',
            isMobile ? 'w-10 h-10 text-lg' : 'w-12 h-12 text-xl'
          )}>
            {getProviderIcon(session.provider)}
          </div>

          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isSaving}
                  className={cn(
                    'h-11 min-w-0 flex-1 rounded border bg-background px-2 font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isMobile ? 'text-lg' : 'text-2xl'
                  )}
                />
                <Button
                  variant="ghost"
                  size="mobile-icon"
                  onClick={saveTitle}
                  disabled={isSaving}
                  aria-label="Save session title"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="mobile-icon"
                  onClick={cancelEditing}
                  disabled={isSaving}
                  aria-label="Cancel title editing"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h1 className={cn(
                  'font-bold truncate',
                  isMobile ? 'text-lg' : 'text-2xl'
                )}>
                  {getSessionDisplayName(session)}
                </h1>
                {!isMobile && (
                  <Button
                    variant="ghost"
                    size="mobile-icon"
                    onClick={startEditing}
                    className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    aria-label="Edit session title"
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
            )}
            <div className={cn(
              'flex items-center gap-2 text-muted-foreground',
              isMobile ? 'text-xs' : 'text-sm'
            )}>
              <span className="truncate max-w-[200px]">{session.cwd}</span>
              {session.git_branch && (
                <>
                  <span>•</span>
                  <span className="truncate max-w-[100px]">{session.git_branch}</span>
                </>
              )}
            </div>
            {tmuxLabel && !isMobile && (
              <div className="text-xs text-muted-foreground font-mono mt-1">
                {tmuxLabel}
              </div>
            )}
          </div>

          {/* Status badge on desktop */}
          {!isMobile && (
            <StatusBadge
              status={session.status}
              host={host}
              className="text-xs h-8 px-3 py-0 leading-none shrink-0 self-start"
            />
          )}
        </div>

        {/* Action buttons */}
        <div className={cn(
          'flex items-center gap-2',
          isMobile && 'w-full justify-between'
        )}>
          {isMobile && (
            <StatusBadge status={session.status} host={host} className="text-xs h-10 px-3 py-0 leading-none" />
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="mobile"
              onClick={handleIdleToggle}
              disabled={idlePending}
              className="gap-1"
              title={isManualIdle ? 'Wake session' : 'Mark idle'}
              aria-label={isManualIdle ? 'Wake session' : 'Mark session idle'}
            >
              {isManualIdle ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
              {!isMobile && (isManualIdle ? 'Wake' : 'Idle')}
            </Button>
            <Button
              variant="outline"
              size="mobile"
              onClick={() => setSendToDialogOpen(true)}
              className="gap-1"
              aria-label="Send content to another session"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {!isMobile && 'Send to...'}
            </Button>
            <Button
              variant="outline"
              size="mobile"
              onClick={() => mcpManager.open(sessionId, session.repo_root || undefined)}
              className="gap-1"
              aria-label="Manage MCP servers"
            >
              <Plug className="h-4 w-4" aria-hidden="true" />
              {!isMobile && 'MCP'}
            </Button>
            <Button
              variant="outline"
              size="mobile"
              onClick={handleTerminate}
              disabled={isTerminating}
              className="gap-1 text-destructive hover:text-destructive"
              title="Terminate session"
              aria-label="Terminate session"
            >
              <Power className="h-4 w-4" aria-hidden="true" />
              {!isMobile && 'Terminate'}
            </Button>
            {isMobile && (
              <Button
                variant="ghost"
                size="mobile-icon"
                onClick={startEditing}
                aria-label="Edit session title"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <SessionWorkbench
        session={session}
        snapshot={snapshot}
        events={events}
        onAssignGroup={handleAssignGroup}
        onSendToLinkedSession={handleSendToFromLinks}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {/* MCP Manager Modal */}
      {mcpManager.sessionId && (
        <MCPManagerModal
          isOpen={mcpManager.isOpen}
          onClose={mcpManager.close}
          sessionId={mcpManager.sessionId}
          repoRoot={mcpManager.repoRoot}
        />
      )}

      {/* Send to Session Dialog */}
      <SendToSessionDialog
        isOpen={sendToDialogOpen}
        onClose={handleCloseSendToDialog}
        sourceSession={session}
        initialTargetSessionId={sendToTargetId}
      />
    </div>
  );
}
