'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext } from '@dnd-kit/core';
import { SessionList } from '@/components/SessionList';
import { BulkActionToolbar } from '@/components/BulkActionToolbar';
import { openCommandPalette } from '@/components/search/CommandPalette';
import { ShortcutsHelp, useShortcutsHelp } from '@/components/shortcuts/ShortcutsHelp';
import { ImportOrphanPanesModal, useImportModal } from '@/components/import/ImportOrphanPanesModal';
import { LaunchRail } from '@/components/launch/LaunchRail';
import { getHosts } from '@/lib/api';
import {
  setSessionsPerfEnabled,
  setSessionsPerfSampleRate,
  startSessionsPerfLogging,
  stopSessionsPerfLogging,
} from '@/lib/sessionsPerf';
import { useSessionStore } from '@/stores/session';
import { SessionsFilters } from './SessionsFilters';
import { SessionsPagination } from './SessionsPagination';
import { SessionsToolbar } from './SessionsToolbar';
import { STATUS_SHORTCUTS, useSessionFilters } from './hooks/useSessionFilters';
import { useSessionSelection } from './hooks/useSessionSelection';
import { useSessionDragAndDrop } from './hooks/useSessionDragAndDrop';

export default function SessionsPageClient() {
  const {
    needsAttention,
    status,
    view,
    provider,
    hostId,
    archivedOnly,
    page,
    pageSize,
    perfEnabled,
    disableRealtime,
    showSnapshotPreview,
    query,
    setQuery,
    filters,
    isWorkflowView,
    applyFilters,
    updateFilter,
    toggleStatusShortcut,
    setPage,
    setPageSize,
  } = useSessionFilters();
  const [totalSessions, setTotalSessions] = useState<number | null>(null);
  const sessions = useSessionStore((state) => state.sessions);
  const sessionIds = useMemo(() => sessions.map((session) => session.id), [sessions]);
  const { dragEnabled, setDragEnabled, sensors, handleDragEnd } = useSessionDragAndDrop();
  const {
    selectionMode,
    selectedIds,
    toggleSelectionMode,
    selectSession,
    selectAll,
    clearSelection,
  } = useSessionSelection({
    sessionIds,
    dragEnabled,
    setDragEnabled,
  });

  // Global features
  const shortcutsHelp = useShortcutsHelp();
  const importModal = useImportModal();
  const queryClient = useQueryClient();

  const { data: hostData } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
  });

  const handleBulkOperationComplete = () => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    void queryClient.invalidateQueries({ queryKey: ['groups'] });
  };

  const toggleDragMode = useCallback(() => {
    const next = !dragEnabled;
    if (next && selectionMode) clearSelection(false);
    setDragEnabled(next);
  }, [clearSelection, dragEnabled, selectionMode, setDragEnabled]);

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
      setSessionsPerfSampleRate(1);
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
        toggleStatusShortcut(e.key);
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
        selectAll();
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
    toggleStatusShortcut,
    selectionMode,
    dragEnabled,
    importModal,
    selectAll,
    toggleDragMode,
    toggleSelectionMode,
    clearSelection,
    setDragEnabled,
  ]);

  const pageContent = (
    <>
      <div className="h-full overflow-y-auto overflow-x-hidden">
        <div className="mx-auto w-full max-w-7xl space-y-5 px-3 py-4 sm:px-4 sm:py-6">
          <header className="space-y-3">
            <div>
              <h1 className="text-xl font-bold sm:text-2xl">Sessions</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Find, launch, organize, and act on agent work across hosts.
              </p>
            </div>
            <SessionsToolbar
              selectionMode={selectionMode}
              allSelected={sessions.length > 0 && selectedIds.size === sessions.length}
              dragEnabled={dragEnabled}
              isWorkflowView={isWorkflowView}
              isAllView={view === 'all' && !needsAttention && !archivedOnly}
              needsAttention={needsAttention}
              archivedOnly={archivedOnly}
              onToggleSelection={toggleSelectionMode}
              onSelectAll={selectAll}
              onToggleDrag={toggleDragMode}
              onOpenSearch={openCommandPalette}
              onOpenShortcuts={shortcutsHelp.open}
              onOpenImport={importModal.open}
              onLaunched={() => void queryClient.invalidateQueries({ queryKey: ['sessions'] })}
            />
          </header>

          <LaunchRail
            className="hidden md:flex"
            onLaunched={() => void queryClient.invalidateQueries({ queryKey: ['sessions'] })}
          />

          <SessionsFilters
            query={query}
            status={status}
            provider={provider}
            hostId={hostId}
            hosts={hostData?.hosts || []}
            onQueryChange={setQuery}
            onApply={applyFilters}
            onFilterChange={updateFilter}
          />

          <SessionList
            filters={filters}
            workflowView={isWorkflowView}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            onSelectSession={selectSession}
            dragEnabled={dragEnabled && !selectionMode}
            perfEnabled={perfEnabled}
            disableRealtime={disableRealtime}
            showSnapshotPreview={showSnapshotPreview}
            page={page}
            pageSize={pageSize}
            onTotalChange={(total) => setTotalSessions(total)}
          />
          <SessionsPagination
            page={page}
            pageSize={pageSize}
            total={totalSessions}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      </div>

      {/* Modals */}
      <ShortcutsHelp isOpen={shortcutsHelp.isOpen} onClose={shortcutsHelp.close} />
      <ImportOrphanPanesModal
        isOpen={importModal.isOpen}
        onClose={importModal.close}
        onSuccess={() => void queryClient.invalidateQueries({ queryKey: ['sessions'] })}
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
