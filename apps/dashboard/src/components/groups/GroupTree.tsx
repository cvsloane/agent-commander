'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useCallback } from 'react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { getGroups, deleteGroup as deleteGroupApi } from '@/lib/api';
import { useGroupsStore } from '@/stores/groups';
import { DroppableGroup } from './DroppableGroup';
import type { GroupWithChildren } from '@/lib/groupTypes';

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
          'group flex min-h-11 items-center gap-1 rounded-md px-1 hover:bg-accent',
          isSelected && 'bg-accent'
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={handleToggleExpand}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${group.name}`}
            aria-expanded={isExpanded}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="h-11 w-11 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={handleSelect}
          aria-current={isSelected ? 'page' : undefined}
        >
          {isExpanded && hasChildren ? (
            <FolderOpen
              className="h-4 w-4 flex-shrink-0"
              style={{ color: group.color }}
              aria-hidden="true"
            />
          ) : (
            <Folder
              className="h-4 w-4 flex-shrink-0"
              style={{ color: group.color }}
              aria-hidden="true"
            />
          )}
          <span className="flex-1 truncate text-sm">{group.name}</span>
          <span className="text-xs text-muted-foreground">{group.session_count}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="mobile-icon"
              className="shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:data-[state=open]:opacity-100"
              aria-label={`Actions for ${group.name}`}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(group)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit group
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onDelete(group)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
        <Button
          variant="ghost"
          size="mobile-icon"
          onClick={onCreateGroup}
          aria-label="Create group"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {/* All Sessions */}
        <button
          type="button"
          className={cn(
            'mx-2 flex min-h-11 w-[calc(100%-1rem)] items-center gap-2 rounded-md px-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isAllSelected && 'bg-accent'
          )}
          onClick={handleSelectAll}
          aria-current={isAllSelected ? 'page' : undefined}
        >
          <FileStack className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm">All Sessions</span>
        </button>

        {/* Ungrouped */}
        <DroppableGroup groupId={null} className="mx-2">
          <button
            type="button"
            className={cn(
              'flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isUngroupedSelected && 'bg-accent'
            )}
            onClick={handleSelectUngrouped}
            aria-current={isUngroupedSelected ? 'page' : undefined}
          >
            <Folder className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">Ungrouped</span>
          </button>
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
                <button
                  type="button"
                  onClick={onCreateGroup}
                  className="min-h-11 rounded px-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
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
