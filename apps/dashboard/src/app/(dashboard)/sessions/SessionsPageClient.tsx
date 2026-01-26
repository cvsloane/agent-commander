'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Keyboard, CheckSquare, Square, Archive, GripVertical, Download, Plus } from 'lucide-react';
import { DndContext, DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { SessionList } from '@/components/SessionList';
import { Button } from '@/components/ui/button';
import { BulkActionToolbar } from '@/components/BulkActionToolbar';
import { CommandPalette, useCommandPalette } from '@/components/search/CommandPalette';
import { ShortcutsHelp, useShortcutsHelp } from '@/components/shortcuts/ShortcutsHelp';
import { ImportOrphanPanesModal, useImportModal } from '@/components/import/ImportOrphanPanesModal';
import { SessionGenerator } from '@/components/session-generator';
import { getHosts, assignSessionGroup } from '@/lib/api';
import { setSessionsPerfEnabled, startSessionsPerfLogging, stopSessionsPerfLogging } from '@/lib/sessionsPerf';
import { useSessionStore } from '@/stores/session';

// Status filter shortcuts - apply when search input is not focused
const STATUS_SHORTCUTS: Record<string, string> = {
  '!': 'RUNNING',
  '@': 'WAITING_FOR_INPUT,WAITING_FOR_APPROVAL',
  '#': 'IDLE',
  '$': 'ERROR',
};
const WORKFLOW_STATUSES = 'RUNNING,STARTING,WAITING_FOR_INPUT,WAITING_FOR_APPROVAL,ERROR,IDLE';

export default function SessionsPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const needsAttention = searchParams.get('needs_attention') === 'true';
  const status = searchParams.get('status') || '';
  const view = searchParams.get('view') || 'workflow';
  const provider = searchParams.get('provider') || '';
  const hostId = searchParams.get('host_id') || '';
  const groupId = searchParams.get('group_id') || '';
  const ungrouped = searchParams.get('ungrouped') === 'true';
  const includeArchived = searchParams.get('include_archived') === 'true';
  const archivedOnly = searchParams.get('archived_only') === 'true';
  const q = searchParams.get('q') || '';
  const pageParam = Number(searchParams.get('page') || '1');
  const pageSizeParam = Number(searchParams.get('page_size') || '20');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const pageSize = [10, 20, 50].includes(pageSizeParam) ? pageSizeParam : 20;
  const perfEnabled = searchParams.get('perf') === '1';
  const disableRealtime = searchParams.get('nowebsocket') === '1';
  const showSnapshotPreview = searchParams.get('nosnapshot') !== '1';
  const [query, setQuery] = useState(q);
  const [totalSessions, setTotalSessions] = useState<number | null>(null);
  const isWorkflowView =
    view === 'workflow' &&
    !needsAttention &&
    !status &&
    !provider &&
    !hostId &&
    !groupId &&
    !ungrouped &&
    !includeArchived &&
    !archivedOnly &&
    !q;
  const effectiveStatus = isWorkflowView ? WORKFLOW_STATUSES : status;
  const sessionFilters = useMemo(
    () => ({
      needs_attention: needsAttention || undefined,
      status: effectiveStatus || undefined,
      provider: provider || undefined,
      host_id: hostId || undefined,
      group_id: groupId || undefined,
      ungrouped: ungrouped || undefined,
      include_archived: includeArchived || undefined,
      archived_only: archivedOnly || undefined,
      q: query || undefined,
    }),
    [
      needsAttention,
      effectiveStatus,
      provider,
      hostId,
      groupId,
      ungrouped,
      includeArchived,
      archivedOnly,
      query,
    ]
  );

  // Modal states
  const [showSpawnDialog, setShowSpawnDialog] = useState(false);

  // Selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { sessions, updateSessions } = useSessionStore();

  // Drag state
  const [dragEnabled, setDragEnabled] = useState(false);
  const previousDragEnabledRef = useRef(true);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement before drag starts
      },
    })
  );

  // Global features
  const commandPalette = useCommandPalette();
  const shortcutsHelp = useShortcutsHelp();
  const importModal = useImportModal();
  const queryClient = useQueryClient();

  const { data: hostData } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
  });

  const applyFilters = () => {
    const params = new URLSearchParams();
    if (view && view !== 'workflow') params.set('view', view);
    if (needsAttention) params.set('needs_attention', 'true');
    if (status) params.set('status', status);
    if (provider) params.set('provider', provider);
    if (hostId) params.set('host_id', hostId);
    if (groupId) params.set('group_id', groupId);
    if (ungrouped) params.set('ungrouped', 'true');
    if (includeArchived) params.set('include_archived', 'true');
    if (archivedOnly) params.set('archived_only', 'true');
    if (query) params.set('q', query);
    params.set('page', '1');
    params.set('page_size', String(pageSize));
    const queryString = params.toString();
    router.push(`/sessions${queryString ? `?${queryString}` : ''}`);
  };

  // Selection handlers
  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) {
        setSelectedIds(new Set());
        setDragEnabled(previousDragEnabledRef.current);
      } else {
        // Disable drag while in selection mode to avoid conflicts
        previousDragEnabledRef.current = dragEnabled;
        setDragEnabled(false);
      }
      return !prev;
    });
  }, [dragEnabled]);

  const handleSelectSession = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const newSelected = new Set(prev);
      if (selected) {
        newSelected.add(id);
      } else {
        newSelected.delete(id);
      }
      return newSelected;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === sessions.length) {
        return new Set();
      }
      return new Set(sessions.map((s) => s.id));
    });
  }, [sessions]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, []);

  const handleBulkOperationComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
    queryClient.invalidateQueries({ queryKey: ['groups'] });
  };

  // Drag-and-drop handlers
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || !active.data.current?.session) return;

    const sessionId = active.id as string;
    const targetGroupId = over.data.current?.groupId as string | null;
    const session = active.data.current.session;

    // Skip if already in this group
    if (session.group_id === targetGroupId) return;
    if (session.group_id === null && targetGroupId === null) return;

    try {
      const result = await assignSessionGroup(sessionId, targetGroupId);
      // Update the session in the store
      updateSessions([result.session]);
      // Refresh groups to update counts
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    } catch (error) {
      console.error('Failed to assign session to group:', error);
    }
  };

  const toggleDragMode = useCallback(() => {
    setDragEnabled((prev) => {
      const next = !prev;
      // Disable selection mode when enabling drag mode
      if (next) {
        setSelectionMode(false);
        setSelectedIds(new Set());
      }
      return next;
    });
  }, []);

  // Status filter shortcuts handler
  const handleStatusShortcut = useCallback((key: string) => {
    const statusFilter = STATUS_SHORTCUTS[key];
    if (!statusFilter) return;

    const params = new URLSearchParams(searchParams.toString());

    // Toggle: if current status matches, clear it; otherwise set it
    const currentStatus = params.get('status');
    if (currentStatus === statusFilter) {
      params.delete('status');
    } else {
      params.set('status', statusFilter);
    }

    router.push(`/sessions?${params.toString()}`);
  }, [searchParams, router]);

  // Global keyboard shortcuts for status filters
  useEffect(() => {
    if (!perfEnabled || typeof PerformanceObserver === 'undefined') return;
    let lastLog = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType !== 'longtask') continue;
        if (entry.duration < 50) continue;
        const now = Date.now();
        if (now - lastLog < 1000) continue;
        lastLog = now;
        console.log('[perf] longtask', {
          name: entry.name,
          duration: Math.round(entry.duration),
          startTime: Math.round(entry.startTime),
        });
      }
    });
    try {
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      return;
    }
    return () => observer.disconnect();
  }, [perfEnabled]);

  useEffect(() => {
    setSessionsPerfEnabled(perfEnabled);
    if (perfEnabled) {
      startSessionsPerfLogging();
      return () => stopSessionsPerfLogging();
    }
    stopSessionsPerfLogging();
    return undefined;
  }, [perfEnabled]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Don't trigger if modifiers are pressed (except shift)
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      // Check for status shortcuts
      if (STATUS_SHORTCUTS[e.key]) {
        e.preventDefault();
        handleStatusShortcut(e.key);
        return;
      }

      // Selection mode shortcuts
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        toggleSelectionMode();
        return;
      }

      if (e.key === 'a' && selectionMode) {
        e.preventDefault();
        handleSelectAll();
        return;
      }

      if (e.key === 'Escape' && selectionMode) {
        e.preventDefault();
        clearSelection();
        return;
      }

      if (e.key === 'Escape' && dragEnabled) {
        e.preventDefault();
        setDragEnabled(false);
        return;
      }

      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        toggleDragMode();
        return;
      }

      // Import shortcut
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        importModal.open();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleStatusShortcut,
    selectionMode,
    dragEnabled,
    importModal,
    handleSelectAll,
    toggleDragMode,
    toggleSelectionMode,
    clearSelection,
  ]);

  const pageContent = (
    <>
      <div className="h-full overflow-y-auto overflow-x-hidden">
        <div className="container mx-auto px-4 py-6 max-w-full">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
              <h1 className="text-2xl font-bold">Sessions</h1>
              <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                <Button
                  variant={selectionMode ? 'default' : 'outline'}
                  size="sm"
                  onClick={toggleSelectionMode}
                  className="gap-2"
                >
                  {selectionMode ? (
                    <CheckSquare className="h-4 w-4" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">Select</span>
                  <kbd className="hidden sm:inline px-1.5 py-0.5 text-xs bg-muted rounded">
                    s
                  </kbd>
                </Button>
                {selectionMode && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAll}
                    className="gap-2"
                  >
                    {selectedIds.size === sessions.length ? 'Deselect All' : 'Select All'}
                    <kbd className="hidden sm:inline px-1.5 py-0.5 text-xs bg-muted rounded">
                      a
                    </kbd>
                  </Button>
                )}
                <Button
                  variant={dragEnabled ? 'default' : 'outline'}
                  size="sm"
                  onClick={toggleDragMode}
                  className="gap-2"
                >
                  <GripVertical className="h-4 w-4" />
                  <span className="hidden sm:inline">Drag</span>
                  <kbd className="hidden sm:inline px-1.5 py-0.5 text-xs bg-muted rounded">
                    d
                  </kbd>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={commandPalette.open}
                  className="gap-2"
                >
                  <Search className="h-4 w-4" />
                  <span className="hidden sm:inline">Search</span>
                  <kbd className="hidden sm:inline px-1.5 py-0.5 text-xs bg-muted rounded">
                    /
                  </kbd>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={shortcutsHelp.open}
                  className="gap-2"
                >
                  <Keyboard className="h-4 w-4" />
                  <kbd className="hidden sm:inline px-1.5 py-0.5 text-xs bg-muted rounded">
                    ?
                  </kbd>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={importModal.open}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">Import</span>
                  <kbd className="hidden sm:inline px-1.5 py-0.5 text-xs bg-muted rounded">
                    i
                  </kbd>
                </Button>
                <Button
                  variant={isWorkflowView ? 'default' : 'outline'}
                  size="sm"
                  asChild
                >
                  <a href="/sessions?view=workflow">Workflow</a>
                </Button>
                <Button
                  variant={view === 'all' && !needsAttention && !archivedOnly ? 'default' : 'outline'}
                  size="sm"
                  asChild
                >
                  <a href="/sessions?view=all">All Sessions</a>
                </Button>
                <Button
                  variant={needsAttention ? 'default' : 'outline'}
                  size="sm"
                  asChild
                >
                  <a href="/sessions?view=all&needs_attention=true">Needs Attention</a>
                </Button>
                <Button
                  variant={archivedOnly ? 'default' : 'outline'}
                  size="sm"
                  asChild
                  className="gap-1.5"
                >
                  <a href="/sessions?view=all&archived_only=true">
                    <Archive className="h-4 w-4" />
                    Archived
                  </a>
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setShowSpawnDialog(true)}
                  className="gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  New Session
                </Button>
              </div>
            </div>

            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                placeholder="Filter title, cwd, repo, branch..."
                className="w-full sm:w-[240px] px-3 py-2 text-sm bg-background border rounded-md"
              />
              <select
                value={status}
                onChange={(e) => {
                  const params = new URLSearchParams(searchParams.toString());
                  const value = e.target.value;
                  if (value) params.set('status', value);
                  else params.delete('status');
                  params.set('page', '1');
                  router.push(`/sessions?${params.toString()}`);
                }}
                className="w-full sm:w-[200px] px-3 py-2 text-sm bg-background border rounded-md"
              >
                <option value="">All Statuses</option>
                {['STARTING','RUNNING','IDLE','WAITING_FOR_INPUT','WAITING_FOR_APPROVAL','ERROR','DONE'].map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <select
                value={provider}
                onChange={(e) => {
                  const params = new URLSearchParams(searchParams.toString());
                  const value = e.target.value;
                  if (value) params.set('provider', value);
                  else params.delete('provider');
                  params.set('page', '1');
                  router.push(`/sessions?${params.toString()}`);
                }}
                className="w-full sm:w-[200px] px-3 py-2 text-sm bg-background border rounded-md"
              >
                <option value="">All Providers</option>
                {[
                  { value: 'claude_code', label: 'Claude Code' },
                  { value: 'codex', label: 'Codex' },
                  { value: 'gemini_cli', label: 'Gemini CLI' },
                  { value: 'opencode', label: 'OpenCode' },
                  { value: 'cursor', label: 'Cursor' },
                  { value: 'aider', label: 'Aider' },
                  { value: 'continue', label: 'Continue' },
                  { value: 'shell', label: 'Shell' },
                  { value: 'unknown', label: 'Unknown' },
                ].map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <select
                value={hostId}
                onChange={(e) => {
                  const params = new URLSearchParams(searchParams.toString());
                  const value = e.target.value;
                  if (value) params.set('host_id', value);
                  else params.delete('host_id');
                  params.set('page', '1');
                  router.push(`/sessions?${params.toString()}`);
                }}
                className="w-full sm:w-[200px] px-3 py-2 text-sm bg-background border rounded-md"
              >
                <option value="">All Hosts</option>
                {(hostData?.hosts || []).map((host) => (
                  <option key={host.id} value={host.id}>{host.name}</option>
                ))}
              </select>
              <Button size="sm" onClick={applyFilters} className="w-full sm:w-auto">
                Apply
              </Button>
            </div>

            <SessionList
              filters={sessionFilters}
              workflowView={isWorkflowView}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onSelectSession={handleSelectSession}
              dragEnabled={dragEnabled && !selectionMode}
              perfEnabled={perfEnabled}
              disableRealtime={disableRealtime}
              showSnapshotPreview={showSnapshotPreview}
              page={page}
              pageSize={pageSize}
              onTotalChange={(total) => setTotalSessions(total)}
            />
            <div className="mt-6 flex items-center justify-between text-sm">
              <div className="text-muted-foreground">
                {totalSessions != null ? `Total: ${totalSessions}` : 'Total: —'}
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-muted-foreground">
                  Page size
                </label>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    const params = new URLSearchParams(searchParams.toString());
                    params.set('page_size', String(next));
                    params.set('page', '1');
                    router.push(`/sessions?${params.toString()}`);
                  }}
                  className="px-2 py-1 text-xs bg-background border rounded-md"
                >
                  {[10, 20, 50].map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const params = new URLSearchParams(searchParams.toString());
                    params.set('page', String(Math.max(1, page - 1)));
                    router.push(`/sessions?${params.toString()}`);
                  }}
                  disabled={page <= 1}
                >
                  Prev
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {page}
                  {totalSessions != null ? ` of ${Math.max(1, Math.ceil(totalSessions / pageSize))}` : ''}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const params = new URLSearchParams(searchParams.toString());
                    params.set('page', String(page + 1));
                    router.push(`/sessions?${params.toString()}`);
                  }}
                  disabled={totalSessions != null && page >= Math.ceil(totalSessions / pageSize)}
                >
                  Next
                </Button>
              </div>
            </div>
        </div>
      </div>

      {/* Modals */}
      <CommandPalette
        isOpen={commandPalette.isOpen}
        onClose={commandPalette.close}
      />
      <ShortcutsHelp
        isOpen={shortcutsHelp.isOpen}
        onClose={shortcutsHelp.close}
      />
      <ImportOrphanPanesModal
        isOpen={importModal.isOpen}
        onClose={importModal.close}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['sessions'] })}
      />
      <SessionGenerator
        isOpen={showSpawnDialog}
        onClose={() => setShowSpawnDialog(false)}
      />

      {/* Bulk Action Toolbar */}
      {selectionMode && (
        <BulkActionToolbar
          selectedIds={Array.from(selectedIds)}
          onClearSelection={clearSelection}
          onOperationComplete={handleBulkOperationComplete}
        />
      )}
    </>
  );

  if (!dragEnabled) {
    return pageContent;
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {pageContent}
    </DndContext>
  );
}
