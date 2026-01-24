'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  FileStack,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getGroups, deleteGroup as deleteGroupApi } from '@/lib/api';
import { useGroupsStore } from '@/stores/groups';
import { DroppableGroup } from './DroppableGroup';
import type { SessionGroup } from '@agent-command/schema';

interface GroupWithChildren extends SessionGroup {
  children: GroupWithChildren[];
  session_count: number;
}

interface GroupTreeItemProps {
  group: GroupWithChildren;
  depth: number;
  onEdit: (group: GroupWithChildren) => void;
  onDelete: (group: GroupWithChildren) => void;
}

function GroupTreeItem({ group, depth, onEdit, onDelete }: GroupTreeItemProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedGroupId, setSelectedGroup, expandedGroups, toggleGroupExpanded } =
    useGroupsStore();
  const [showMenu, setShowMenu] = useState(false);

  const isExpanded = expandedGroups.has(group.id);
  const isSelected = selectedGroupId === group.id;
  const hasChildren = group.children.length > 0;

  const handleSelect = () => {
    setSelectedGroup(group.id);
    const params = new URLSearchParams(searchParams.toString());
    params.set('group_id', group.id);
    params.delete('ungrouped');
    router.push(`/sessions?${params.toString()}`);
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleGroupExpanded(group.id);
  };

  return (
    <DroppableGroup groupId={group.id}>
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer group hover:bg-accent',
          isSelected && 'bg-accent'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleSelect}
        onMouseEnter={() => setShowMenu(true)}
        onMouseLeave={() => setShowMenu(false)}
      >
        {hasChildren ? (
          <button
            onClick={handleToggleExpand}
            className="p-0.5 hover:bg-background rounded"
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}
        {isExpanded && hasChildren ? (
          <FolderOpen
            className="h-4 w-4 flex-shrink-0"
            style={{ color: group.color }}
          />
        ) : (
          <Folder
            className="h-4 w-4 flex-shrink-0"
            style={{ color: group.color }}
          />
        )}
        <span className="flex-1 text-sm truncate">{group.name}</span>
        <span className="text-xs text-muted-foreground">
          {group.session_count}
        </span>
        {showMenu && (
          <div className="flex gap-0.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(group);
              }}
              className="p-1 hover:bg-background rounded opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(group);
              }}
              className="p-1 hover:bg-background rounded opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        )}
      </div>
      {isExpanded &&
        hasChildren &&
        group.children.map((child) => (
          <GroupTreeItem
            key={child.id}
            group={child}
            depth={depth + 1}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
    </DroppableGroup>
  );
}

interface GroupTreeProps {
  onCreateGroup: () => void;
  onEditGroup: (group: GroupWithChildren) => void;
}

function pruneEmptyGroups(groups: GroupWithChildren[]): GroupWithChildren[] {
  return groups
    .map((group) => ({
      ...group,
      children: pruneEmptyGroups(group.children || []),
    }))
    .filter((group) => group.session_count > 0 || group.children.length > 0);
}

function collectGroupIds(groups: GroupWithChildren[], ids = new Set<string>()): Set<string> {
  for (const group of groups) {
    ids.add(group.id);
    if (group.children?.length) {
      collectGroupIds(group.children, ids);
    }
  }
  return ids;
}

export function GroupTree({ onCreateGroup, onEditGroup }: GroupTreeProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { selectedGroupId, setSelectedGroup, setGroups } = useGroupsStore();

  const { data, isLoading } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteGroupApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });

  useEffect(() => {
    if (data) {
      setGroups(data.groups, data.flat);
    }
  }, [data, setGroups]);

  const visibleGroups = useMemo(
    () => (data?.groups ? pruneEmptyGroups(data.groups) : []),
    [data]
  );
  const visibleGroupIds = useMemo(
    () => collectGroupIds(visibleGroups),
    [visibleGroups]
  );

  const handleSelectAll = useCallback(() => {
    setSelectedGroup(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('group_id');
    params.delete('ungrouped');
    router.push(`/sessions?${params.toString()}`);
  }, [router, searchParams, setSelectedGroup]);

  const handleSelectUngrouped = () => {
    setSelectedGroup('ungrouped');
    const params = new URLSearchParams(searchParams.toString());
    params.delete('group_id');
    params.set('ungrouped', 'true');
    router.push(`/sessions?${params.toString()}`);
  };

  const handleDelete = (group: GroupWithChildren) => {
    if (
      confirm(
        `Delete group "${group.name}"? Sessions will be moved to the parent group.`
      )
    ) {
      deleteMutation.mutate(group.id);
      if (selectedGroupId === group.id) {
        handleSelectAll();
      }
    }
  };

  useEffect(() => {
    if (!selectedGroupId || selectedGroupId === 'ungrouped') return;
    if (!visibleGroupIds.has(selectedGroupId)) {
      handleSelectAll();
    }
  }, [selectedGroupId, visibleGroupIds, handleSelectAll]);

  const isUngroupedSelected = searchParams.get('ungrouped') === 'true';
  const isAllSelected = !selectedGroupId && !isUngroupedSelected;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-medium">Groups</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCreateGroup}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {/* All Sessions */}
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-accent rounded-md mx-2',
            isAllSelected && 'bg-accent'
          )}
          onClick={handleSelectAll}
        >
          <FileStack className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">All Sessions</span>
        </div>

        {/* Ungrouped */}
        <DroppableGroup groupId={null} className="mx-2">
          <div
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-accent rounded-md',
              isUngroupedSelected && 'bg-accent'
            )}
            onClick={handleSelectUngrouped}
          >
            <Folder className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Ungrouped</span>
          </div>
        </DroppableGroup>

        {/* Divider */}
        <div className="my-2 border-b mx-2" />

        {/* Groups */}
        {isLoading ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
        ) : visibleGroups.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            {data?.groups.length ? (
              'No active groups.'
            ) : (
              <>
                No groups yet.{' '}
                <button onClick={onCreateGroup} className="text-primary hover:underline">
                  Create one
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-0.5 px-1">
            {visibleGroups.map((group) => (
              <GroupTreeItem
                key={group.id}
                group={group}
                depth={0}
                onEdit={onEditGroup}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
