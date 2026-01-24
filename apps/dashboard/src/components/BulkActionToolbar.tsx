'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Trash2, FolderInput, X, Moon, Sun, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { bulkOperateSessions, getGroups } from '@/lib/api';
import type { BulkOperationType, Session } from '@agent-command/schema';
import type { SessionGroup } from '@agent-command/schema';
import { useSessionStore } from '@/stores/session';
import { useNotifications } from '@/stores/notifications';

interface GroupWithChildren extends SessionGroup {
  children: GroupWithChildren[];
  session_count: number;
}

interface BulkActionToolbarProps {
  selectedIds: string[];
  onClearSelection: () => void;
  onOperationComplete: () => void;
}

export function BulkActionToolbar({
  selectedIds,
  onClearSelection,
  onOperationComplete,
}: BulkActionToolbarProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const updateSessions = useSessionStore((state) => state.updateSessions);
  const notifications = useNotifications();

  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
    enabled: showGroupMenu,
  });

  const handleBulkOperation = async (
    operation: BulkOperationType,
    groupId?: string | null
  ) => {
    if (selectedIds.length === 0) return;

    setIsLoading(true);
    try {
      const result = await bulkOperateSessions(operation, selectedIds, groupId);

      if (result.error_count > 0) {
        console.error('Some operations failed:', result.errors);
      }

      if (operation === 'terminate') {
        const archivedAt = new Date().toISOString();
        updateSessions(selectedIds.map((id) => ({ id, archived_at: archivedAt } as Session)));
        notifications.success(
          `Terminated ${selectedIds.length} session${selectedIds.length !== 1 ? 's' : ''}`
        );
      }

      onOperationComplete();
      onClearSelection();
    } catch (error) {
      console.error('Bulk operation failed:', error);
      notifications.error('Bulk operation failed', (error as Error).message);
    } finally {
      setIsLoading(false);
      setShowConfirmDelete(false);
      setShowGroupMenu(false);
    }
  };

  const flattenGroups = (groups: GroupWithChildren[]): SessionGroup[] => {
    const result: SessionGroup[] = [];
    const traverse = (items: GroupWithChildren[], depth = 0) => {
      for (const item of items) {
        result.push({ ...item, name: '  '.repeat(depth) + item.name });
        if (item.children?.length) {
          traverse(item.children, depth + 1);
        }
      }
    };
    traverse(groups);
    return result;
  };

  if (selectedIds.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-background border shadow-lg rounded-lg px-4 py-3 flex items-center gap-4">
        <span className="text-sm font-medium">
          {selectedIds.length} session{selectedIds.length !== 1 ? 's' : ''} selected
        </span>

        <div className="h-6 w-px bg-border" />

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkOperation('archive')}
            disabled={isLoading}
            className="gap-1.5"
          >
            <Archive className="h-4 w-4" />
            Archive
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkOperation('unarchive')}
            disabled={isLoading}
            className="gap-1.5"
          >
            <ArchiveRestore className="h-4 w-4" />
            Unarchive
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkOperation('idle')}
            disabled={isLoading}
            className="gap-1.5"
          >
            <Moon className="h-4 w-4" />
            Idle
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkOperation('unidle')}
            disabled={isLoading}
            className="gap-1.5"
          >
            <Sun className="h-4 w-4" />
            Wake
          </Button>

          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowGroupMenu(!showGroupMenu)}
              disabled={isLoading}
              className="gap-1.5"
            >
              <FolderInput className="h-4 w-4" />
              Assign Group
            </Button>

            {showGroupMenu && (
              <div className="absolute bottom-full left-0 mb-2 w-48 bg-background border rounded-lg shadow-lg py-1 max-h-64 overflow-y-auto">
                <button
                  onClick={() => handleBulkOperation('assign_group', null)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="text-muted-foreground">No Group</span>
                </button>
                {groupsData?.groups &&
                  flattenGroups(groupsData.groups).map((group) => (
                    <button
                      key={group.id}
                      onClick={() => handleBulkOperation('assign_group', group.id)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
                    >
                      {group.icon && <span>{group.icon}</span>}
                      <span className="truncate">{group.name}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>

        <div className="h-6 w-px bg-border" />

        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              handleBulkOperation('terminate');
            }}
            disabled={isLoading}
            className="gap-1.5 text-destructive hover:text-destructive"
          >
            <Power className="h-4 w-4" />
            Terminate
          </Button>
        </div>

        <div className="relative">
          {showConfirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-destructive">Delete?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleBulkOperation('delete')}
                  disabled={isLoading}
                >
                  Confirm
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowConfirmDelete(false)}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConfirmDelete(true)}
                disabled={isLoading}
                className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            )}
          </div>
        </div>

        <div className="h-6 w-px bg-border" />

        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
          disabled={isLoading}
          className="gap-1.5"
        >
          <X className="h-4 w-4" />
          Clear
        </Button>
      </div>
    </div>
  );
}
