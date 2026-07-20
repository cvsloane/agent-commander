'use client';

import { useRef, useState } from 'react';
import {
  Archive,
  CheckSquare,
  Download,
  GripVertical,
  Keyboard,
  MoreHorizontal,
  Plus,
  Search,
  Square,
} from 'lucide-react';
import { MobileLaunchSheet } from '@/components/launch/MobileLaunchSheet';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

interface SessionsToolbarProps {
  selectionMode: boolean;
  allSelected: boolean;
  dragEnabled: boolean;
  isWorkflowView: boolean;
  isAllView: boolean;
  needsAttention: boolean;
  archivedOnly: boolean;
  onToggleSelection: () => void;
  onSelectAll: () => void;
  onToggleDrag: () => void;
  onOpenSearch: () => void;
  onOpenShortcuts: () => void;
  onOpenImport: () => void;
  onLaunched: () => void;
}

export function SessionsToolbar({
  selectionMode,
  allSelected,
  dragEnabled,
  isWorkflowView,
  isAllView,
  needsAttention,
  archivedOnly,
  onToggleSelection,
  onSelectAll,
  onToggleDrag,
  onOpenSearch,
  onOpenShortcuts,
  onOpenImport,
  onLaunched,
}: SessionsToolbarProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const searchLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runOverflowAction = (action: () => void) => {
    setOverflowOpen(false);
    action();
  };

  const startSearchLongPress = () => {
    searchLongPressTimer.current = setTimeout(onOpenSearch, 500);
  };

  const cancelSearchLongPress = () => {
    if (searchLongPressTimer.current) clearTimeout(searchLongPressTimer.current);
    searchLongPressTimer.current = null;
  };

  const selectionIcon = selectionMode ? (
    <CheckSquare className="h-4 w-4" aria-hidden="true" />
  ) : (
    <Square className="h-4 w-4" aria-hidden="true" />
  );

  return (
    <>
      <div className="grid grid-cols-4 gap-2 md:hidden" data-testid="sessions-mobile-toolbar">
        <Button
          variant={selectionMode ? 'default' : 'outline'}
          size="mobile"
          onClick={onToggleSelection}
          className="min-w-0 gap-1.5 px-2"
        >
          {selectionIcon}
          Select
        </Button>
        <Button
          variant="outline"
          size="mobile"
          onClick={onOpenSearch}
          onPointerDown={startSearchLongPress}
          onPointerUp={cancelSearchLongPress}
          onPointerCancel={cancelSearchLongPress}
          onPointerLeave={cancelSearchLongPress}
          className="min-w-0 gap-1.5 px-2"
          aria-label="Search sessions"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          Search
        </Button>
        <Button size="mobile" onClick={() => setLaunchOpen(true)} className="min-w-0 gap-1.5 px-2">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New
        </Button>
        <Button
          variant="outline"
          size="mobile"
          onClick={() => setOverflowOpen(true)}
          className="min-w-0 gap-1.5 px-2"
          aria-label="More session actions"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          More
        </Button>
      </div>

      <div
        className="hidden flex-wrap justify-end gap-2 md:flex"
        data-testid="sessions-desktop-toolbar"
      >
        <Button
          variant={selectionMode ? 'default' : 'outline'}
          size="mobile"
          onClick={onToggleSelection}
          className="gap-2"
        >
          {selectionIcon}
          Select
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">s</kbd>
        </Button>
        {selectionMode && (
          <Button variant="outline" size="mobile" onClick={onSelectAll}>
            {allSelected ? 'Deselect All' : 'Select All'}
            <kbd className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">a</kbd>
          </Button>
        )}
        <Button
          variant={dragEnabled ? 'default' : 'outline'}
          size="mobile"
          onClick={onToggleDrag}
          className="gap-2"
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
          Drag
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">d</kbd>
        </Button>
        <Button variant="outline" size="mobile" onClick={onOpenSearch} className="gap-2">
          <Search className="h-4 w-4" aria-hidden="true" />
          Search
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">/</kbd>
        </Button>
        <Button
          variant="outline"
          size="mobile-icon"
          onClick={onOpenShortcuts}
          aria-label="Keyboard shortcuts"
        >
          <Keyboard className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button variant="outline" size="mobile" onClick={onOpenImport} className="gap-2">
          <Download className="h-4 w-4" aria-hidden="true" />
          Import
        </Button>
        <Button variant={isWorkflowView ? 'default' : 'outline'} size="mobile" asChild>
          <a href="/sessions?view=workflow">Workflow</a>
        </Button>
        <Button variant={isAllView ? 'default' : 'outline'} size="mobile" asChild>
          <a href="/sessions?view=all">All Sessions</a>
        </Button>
        <Button variant={needsAttention ? 'default' : 'outline'} size="mobile" asChild>
          <a href="/sessions?view=all&needs_attention=true">Needs Attention</a>
        </Button>
        <Button
          variant={archivedOnly ? 'default' : 'outline'}
          size="mobile"
          asChild
          className="gap-1.5"
        >
          <a href="/sessions?view=all&archived_only=true">
            <Archive className="h-4 w-4" aria-hidden="true" />
            Archived
          </a>
        </Button>
      </div>

      <Sheet open={overflowOpen} onOpenChange={setOverflowOpen}>
        <SheetContent
          side="bottom"
          className="gap-3 pb-[calc(1rem+env(safe-area-inset-bottom))] md:hidden"
        >
          <SheetHeader>
            <SheetTitle>Session actions</SheetTitle>
            <SheetDescription>
              Selection, organization, views, and session utilities.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-2">
            {selectionMode && (
              <Button
                variant="outline"
                size="mobile"
                onClick={() => runOverflowAction(onSelectAll)}
              >
                {allSelected ? 'Deselect all sessions' : 'Select all sessions'}
              </Button>
            )}
            <Button
              variant={dragEnabled ? 'default' : 'outline'}
              size="mobile"
              onClick={() => runOverflowAction(onToggleDrag)}
              className="justify-start gap-2"
            >
              <GripVertical className="h-4 w-4" aria-hidden="true" />
              {dragEnabled ? 'Stop arranging sessions' : 'Arrange sessions by drag'}
            </Button>
            <Button
              variant="outline"
              size="mobile"
              onClick={() => runOverflowAction(onOpenShortcuts)}
              className="justify-start gap-2"
            >
              <Keyboard className="h-4 w-4" aria-hidden="true" />
              Keyboard shortcuts
            </Button>
            <Button
              variant="outline"
              size="mobile"
              onClick={() => runOverflowAction(onOpenImport)}
              className="justify-start gap-2"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Import orphan panes
            </Button>
          </div>
          <div className="h-px bg-border" />
          <nav className="grid grid-cols-2 gap-2" aria-label="Session views">
            <Button variant={isWorkflowView ? 'default' : 'outline'} size="mobile" asChild>
              <a href="/sessions?view=workflow">Workflow</a>
            </Button>
            <Button variant={isAllView ? 'default' : 'outline'} size="mobile" asChild>
              <a href="/sessions?view=all">All sessions</a>
            </Button>
            <Button variant={needsAttention ? 'default' : 'outline'} size="mobile" asChild>
              <a href="/sessions?view=all&needs_attention=true">Needs attention</a>
            </Button>
            <Button variant={archivedOnly ? 'default' : 'outline'} size="mobile" asChild>
              <a href="/sessions?view=all&archived_only=true">Archived</a>
            </Button>
          </nav>
        </SheetContent>
      </Sheet>

      <MobileLaunchSheet
        open={launchOpen}
        onClose={() => setLaunchOpen(false)}
        onLaunched={onLaunched}
      />
    </>
  );
}
