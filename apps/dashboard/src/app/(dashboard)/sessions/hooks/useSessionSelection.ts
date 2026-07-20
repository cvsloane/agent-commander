'use client';

import { useCallback, useRef, useState } from 'react';

export function toggleSelectedId(
  selectedIds: Set<string>,
  id: string,
  selected: boolean
): Set<string> {
  const next = new Set(selectedIds);
  if (selected) next.add(id);
  else next.delete(id);
  return next;
}

export function toggleAllSelectedIds(selectedIds: Set<string>, sessionIds: string[]): Set<string> {
  return selectedIds.size === sessionIds.length ? new Set() : new Set(sessionIds);
}

export function useSessionSelection({
  sessionIds,
  dragEnabled,
  setDragEnabled,
}: {
  sessionIds: string[];
  dragEnabled: boolean;
  setDragEnabled: (enabled: boolean) => void;
}) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const previousDragEnabledRef = useRef(true);

  const disableSelection = useCallback(
    (restoreDrag = false) => {
      setSelectedIds(new Set());
      setSelectionMode(false);
      if (restoreDrag) setDragEnabled(previousDragEnabledRef.current);
    },
    [setDragEnabled]
  );

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((enabled) => {
      if (enabled) {
        setSelectedIds(new Set());
        setDragEnabled(previousDragEnabledRef.current);
      } else {
        previousDragEnabledRef.current = dragEnabled;
        setDragEnabled(false);
      }
      return !enabled;
    });
  }, [dragEnabled, setDragEnabled]);

  const selectSession = useCallback((id: string, selected: boolean) => {
    setSelectedIds((current) => toggleSelectedId(current, id, selected));
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds((current) => toggleAllSelectedIds(current, sessionIds));
  }, [sessionIds]);

  return {
    selectionMode,
    selectedIds,
    toggleSelectionMode,
    selectSession,
    selectAll,
    clearSelection: disableSelection,
  };
}
