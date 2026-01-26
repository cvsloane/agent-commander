'use client';

import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { Pencil, Check, X, GitBranch, Folder, Clock, Coins, Moon, Sun, Power } from 'lucide-react';
import type { Session, SessionWithSnapshot, Host } from '@agent-command/schema';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusBadge } from '@/components/StatusBadge';
import { cn, formatRelativeTime, getProviderConfig, getRepoNameFromSession, getSessionDisplayName } from '@/lib/utils';
import { bulkOperateSessions, updateSession } from '@/lib/api';
import { markSessionCardRender } from '@/lib/sessionsPerf';
import { useSessionStore } from '@/stores/session';
import { useNotifications } from '@/stores/notifications';
import { useUsageStore, formatTokens, formatCost } from '@/stores/usage';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useSessionIdle } from '@/hooks/useSessionIdle';
import { useHydrated } from '@/hooks/useHydrated';

interface SessionCardProps {
  session: SessionWithSnapshot;
  groupName?: string;
  host?: Host | null;
  selectionMode?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
  showSnapshotPreview?: boolean;
}

const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const MAX_SNAPSHOT_PREVIEW_CHARS = 20000;

function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}

export const SessionCard = memo(function SessionCard({
  session,
  groupName,
  host,
  selectionMode = false,
  isSelected = false,
  onSelect,
  showSnapshotPreview = true,
}: SessionCardProps) {
  markSessionCardRender();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [originalTitle, setOriginalTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateSessions = useSessionStore((state) => state.updateSessions);
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const sessionUsage = useUsageStore((state) => state.getSessionUsage(session.id));
  const isMobile = useIsMobile();
  const { setSessionIdle, isSessionIdlePending } = useSessionIdle();
  const [isTerminating, setIsTerminating] = useState(false);
  const hydrated = useHydrated();

  const providerConfig = getProviderConfig(session.provider);
  const lastActivity = session.last_activity_at || session.updated_at;
  const tmuxMeta = (session.metadata?.tmux || {}) as {
    session_name?: string;
    window_name?: string;
  };
  const windowName = tmuxMeta.window_name?.trim();
  const sessionName = tmuxMeta.session_name?.trim();
  const tmuxLabel = session.tmux_target || (sessionName && windowName ? `${sessionName}:${windowName}` : '');
  const statusDetail = session.metadata?.status_detail
    || session.metadata?.approval?.summary
    || session.metadata?.approval?.reason
    || (session.status === 'WAITING_FOR_APPROVAL'
      ? 'Approval requested'
      : session.status === 'WAITING_FOR_INPUT'
        ? 'Input required'
        : '');
  const displayTitle = getSessionDisplayName(session);
  const repoName = getRepoNameFromSession(session);
  const folderName = repoName || session.cwd?.split('/').pop() || '';
  const gitStatus = session.metadata?.git_status;
  const gitStatusInline = (() => {
    if (!gitStatus) return '';
    const parts: string[] = [];
    if (gitStatus.ahead) parts.push(`↑${gitStatus.ahead}`);
    if (gitStatus.behind) parts.push(`↓${gitStatus.behind}`);
    return parts.join(' ');
  })();
  const gitStatusSummary = (() => {
    if (!gitStatus) return '';
    const parts: string[] = [];
    if (gitStatus.ahead) parts.push(`${gitStatus.ahead} ahead`);
    if (gitStatus.behind) parts.push(`${gitStatus.behind} behind`);
    if (gitStatus.staged) parts.push(`${gitStatus.staged} staged`);
    if (gitStatus.unstaged) parts.push(`${gitStatus.unstaged} unstaged`);
    if (gitStatus.untracked) parts.push(`${gitStatus.untracked} untracked`);
    if (gitStatus.unmerged) parts.push(`${gitStatus.unmerged} conflicts`);
    return parts.join(' • ');
  })();
  const snapshotText = useMemo(() => {
    if (!showSnapshotPreview) return '';
    const raw = session.latest_snapshot?.capture_text;
    if (!raw) return '';
    const trimmed = raw.length > MAX_SNAPSHOT_PREVIEW_CHARS
      ? raw.slice(-MAX_SNAPSHOT_PREVIEW_CHARS)
      : raw;
    return trimmed.includes('\x1b') ? stripAnsi(trimmed) : trimmed;
  }, [session.latest_snapshot?.capture_text, showSnapshotPreview]);
  const snapshotPreview = useMemo(() => {
    if (!snapshotText) return '';
    return snapshotText.split('\n').slice(-3).join('\n');
  }, [snapshotText]);
  const contextParts = [
    providerConfig.name,
    groupName ? `Group: ${groupName}` : null,
    repoName,
  ].filter(Boolean) as string[];

  const usageSummary = (() => {
    if (!sessionUsage) return '';
    const parts: string[] = [];
    if (sessionUsage.total_tokens != null) {
      parts.push(formatTokens(sessionUsage.total_tokens));
    } else if (sessionUsage.context_used_tokens != null) {
      parts.push(formatTokens(sessionUsage.context_used_tokens));
    } else if (sessionUsage.session_utilization_percent != null) {
      parts.push(`${Math.round(sessionUsage.session_utilization_percent)}% used`);
    } else if (sessionUsage.context_left_percent != null) {
      parts.push(`${Math.round(sessionUsage.context_left_percent)}% left`);
    }
    if (sessionUsage.estimated_cost_cents != null) {
      parts.push(formatCost(sessionUsage.estimated_cost_cents));
    }
    return parts.join(' · ');
  })();
  const hasUsage = !!usageSummary;
  const isManualIdle = !!session.idled_at;
  const idlePending = isSessionIdlePending(session.id);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEditing = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (selectionMode) return;
    const initial = session.title || displayTitle;
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
      const result = await updateSession(session.id, { title: next });
      updateSessions([result.session]);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update session title:', error);
    } finally {
      setIsSaving(false);
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

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    onSelect?.(session.id, e.target.checked);
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const handleIdleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (idlePending) return;
    try {
      await setSessionIdle(session.id, !isManualIdle);
    } catch (error) {
      console.error('Failed to update idle state:', error);
    }
  };

  const handleTerminate = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTerminating) return;
    setIsTerminating(true);
    try {
      await bulkOperateSessions('terminate', [session.id]);
      updateSessions([
        { ...session, archived_at: new Date().toISOString() } as Session,
      ]);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      notifications.success('Session terminated', displayTitle);
    } catch (error) {
      console.error('Failed to terminate session:', error);
      notifications.error('Failed to terminate session', (error as Error).message);
    } finally {
      setIsTerminating(false);
    }
  };

  const toggleSelected = () => {
    onSelect?.(session.id, !isSelected);
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (selectionMode) {
      e.preventDefault();
      toggleSelected();
      return;
    }
  };

  const handleCardKeyDown = (e: React.KeyboardEvent) => {
    if (selectionMode) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSelected();
      }
      return;
    }
  };

  const cardContent = (
    <CardContent className={cn('p-4', isMobile && 'p-3')}>
      {/* Header: Provider pill + Status badge */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          {/* Selection checkbox */}
          {selectionMode && (
            <div onClick={handleCheckboxClick} className="shrink-0">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={handleCheckboxChange}
                className={cn(
                  'rounded border-gray-300 text-primary focus:ring-primary cursor-pointer',
                  isMobile ? 'h-5 w-5' : 'h-4 w-4'
                )}
              />
            </div>
          )}

          {/* Provider pill with icon and name */}
          <div className={cn(
            'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium',
            providerConfig.bgColor,
            providerConfig.color
          )}>
            <span className="font-mono font-bold">{providerConfig.icon}</span>
            <span>{providerConfig.name}</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleIdleToggle}
            disabled={idlePending}
            title={isManualIdle ? 'Wake session' : 'Mark idle'}
          >
            {isManualIdle ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={handleTerminate}
            disabled={isTerminating}
            title="Terminate session"
          >
            <Power className="h-4 w-4" />
          </Button>
          <StatusBadge status={session.status} host={host} />
        </div>
      </div>

      {/* Title - prominent and editable */}
      <div className="mb-2">
        {isEditing ? (
          <div className="flex items-center gap-2" onClick={(e) => e.preventDefault()}>
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              disabled={isSaving}
              className="flex-1 px-2 py-1 text-sm font-semibold bg-background border rounded focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); saveTitle(); }}
              disabled={isSaving}
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancelEditing(); }}
              disabled={isSaving}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 group min-w-0">
            <h3 className="font-semibold text-base truncate">{displayTitle}</h3>
            {!selectionMode && (
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'opacity-0 group-hover:opacity-100 transition-opacity',
                  isMobile ? 'h-8 w-8 opacity-100' : 'h-6 w-6'
                )}
                onClick={startEditing}
              >
                <Pencil className={cn(isMobile ? 'h-4 w-4' : 'h-3 w-3')} />
              </Button>
            )}
          </div>
        )}
      </div>

      {contextParts.length > 0 && (
        <div className="text-xs text-muted-foreground mb-2 truncate">
          {contextParts.join(' · ')}
        </div>
      )}

      {tmuxLabel && (
        <div className="text-xs text-muted-foreground mb-2 font-mono truncate">
          {tmuxLabel}
        </div>
      )}

      {/* Context: branch, folder, usage, time - with icons */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3 flex-wrap">
        {session.git_branch && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 truncate max-w-[120px] cursor-default">
                <GitBranch className="h-3 w-3 shrink-0" />
                <span className="truncate">{session.git_branch}</span>
                {gitStatusInline && (
                  <span className="text-[10px] text-muted-foreground">{gitStatusInline}</span>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs space-y-1">
                <p>{session.git_branch}</p>
                {gitStatusSummary && <p className="text-muted-foreground">{gitStatusSummary}</p>}
                {gitStatus?.upstream && (
                  <p className="text-muted-foreground">upstream: {gitStatus.upstream}</p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
        {folderName && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 truncate max-w-[120px] cursor-default">
                <Folder className="h-3 w-3 shrink-0" />
                <span className="truncate">{folderName}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{session.cwd}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {sessionUsage && hasUsage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 shrink-0 cursor-default">
                <Coins className="h-3 w-3" />
                <span>{usageSummary}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs">
                {sessionUsage.input_tokens != null && (
                  <p>Input: {formatTokens(sessionUsage.input_tokens)}</p>
                )}
                {sessionUsage.output_tokens != null && (
                  <p>Output: {formatTokens(sessionUsage.output_tokens)}</p>
                )}
                {sessionUsage.total_tokens != null && (
                  <p>Total: {formatTokens(sessionUsage.total_tokens)}</p>
                )}
                {sessionUsage.context_used_tokens != null &&
                  sessionUsage.context_total_tokens != null && (
                    <p>
                      Context: {formatTokens(sessionUsage.context_used_tokens)} / {formatTokens(sessionUsage.context_total_tokens)}
                    </p>
                  )}
                {sessionUsage.context_left_percent != null && (
                  <p>Context left: {Math.round(sessionUsage.context_left_percent)}%</p>
                )}
                {sessionUsage.estimated_cost_cents != null && (
                  <p>Cost: {formatCost(sessionUsage.estimated_cost_cents)}</p>
                )}
                {sessionUsage.session_utilization_percent != null && (
                  <p>Session: {Math.round(sessionUsage.session_utilization_percent)}% used</p>
                )}
                {sessionUsage.session_left_percent != null && (
                  <p>Session: {Math.round(sessionUsage.session_left_percent)}% left</p>
                )}
                {sessionUsage.session_reset_text && (
                  <p>Session resets: {sessionUsage.session_reset_text}</p>
                )}
                {sessionUsage.weekly_utilization_percent != null && (
                  <p>Weekly: {Math.round(sessionUsage.weekly_utilization_percent)}% used</p>
                )}
                {sessionUsage.weekly_left_percent != null && (
                  <p>Weekly: {Math.round(sessionUsage.weekly_left_percent)}% left</p>
                )}
                {sessionUsage.weekly_reset_text && (
                  <p>Weekly resets: {sessionUsage.weekly_reset_text}</p>
                )}
                {sessionUsage.weekly_sonnet_utilization_percent != null && (
                  <p>Sonnet: {Math.round(sessionUsage.weekly_sonnet_utilization_percent)}% used</p>
                )}
                {sessionUsage.weekly_sonnet_reset_text && (
                  <p>Sonnet resets: {sessionUsage.weekly_sonnet_reset_text}</p>
                )}
                {sessionUsage.weekly_opus_utilization_percent != null && (
                  <p>Opus: {Math.round(sessionUsage.weekly_opus_utilization_percent)}% used</p>
                )}
                {sessionUsage.weekly_opus_reset_text && (
                  <p>Opus resets: {sessionUsage.weekly_opus_reset_text}</p>
                )}
                {sessionUsage.five_hour_left_percent != null && (
                  <p>5h left: {Math.round(sessionUsage.five_hour_left_percent)}%</p>
                )}
                {sessionUsage.five_hour_reset_text && (
                  <p>5h resets: {sessionUsage.five_hour_reset_text}</p>
                )}
                {sessionUsage.reported_at && (
                  <p suppressHydrationWarning>
                    Updated: {hydrated ? new Date(sessionUsage.reported_at).toLocaleString() : '—'}
                  </p>
                )}
                {sessionUsage.raw_usage_line && (
                  <p className="text-muted-foreground break-words">
                    Raw: {sessionUsage.raw_usage_line}
                  </p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
        <div className="flex items-center gap-1 shrink-0">
          <Clock className="h-3 w-3" />
          <span suppressHydrationWarning>
            {hydrated ? formatRelativeTime(lastActivity) : '—'}
          </span>
        </div>
      </div>

      {statusDetail && (session.status === 'WAITING_FOR_APPROVAL' || session.status === 'WAITING_FOR_INPUT') && (
        <div className="text-xs text-muted-foreground">
          Waiting: <span className="text-foreground">{statusDetail}</span>
        </div>
      )}

      {/* Terminal-style snapshot preview */}
      {showSnapshotPreview && session.latest_snapshot && (
        <div className="p-2 bg-slate-950/80 rounded-md border border-slate-800">
          <pre
            className="text-xs text-slate-200 line-clamp-2 font-mono whitespace-pre-wrap break-words overflow-hidden"
            style={{ overflowWrap: 'anywhere' }}
          >
            {snapshotPreview}
          </pre>
        </div>
      )}
    </CardContent>
  );

  const card = (
    <Card
      className={cn(
        'hover:border-primary/50 transition-colors cursor-pointer',
        isManualIdle && 'opacity-60 border-dashed'
      )}
      data-session-card
      data-session-id={session.id}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role={selectionMode ? 'button' : undefined}
      tabIndex={selectionMode ? 0 : undefined}
    >
      {cardContent}
    </Card>
  );

  if (selectionMode || isEditing) {
    return card;
  }

  return (
    <a href={`/sessions/${session.id}`} className="block">
      {card}
    </a>
  );
});
