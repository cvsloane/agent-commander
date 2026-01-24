'use client';

import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderGit, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { listDirectory, type DirectoryEntry } from '@/lib/api';
import type { RepoSortBy } from '@/stores/settings';

interface DirectoryTreeProps {
  hostId: string;
  rootPath: string;
  showHidden?: boolean;
  sortBy?: RepoSortBy;
  lastUsedByPath?: Record<string, number>;
  onSelectRepo: (entry: DirectoryEntry) => void;
  selectedPath?: string;
}

interface DirectoryNodeProps {
  hostId: string;
  entry: DirectoryEntry;
  depth: number;
  showHidden: boolean;
  sortBy: RepoSortBy;
  lastUsedByPath: Record<string, number>;
  onSelectRepo: (entry: DirectoryEntry) => void;
  selectedPath?: string;
}

function getLastModifiedValue(entry: DirectoryEntry): number {
  if (!entry.last_modified) return 0;
  if (typeof entry.last_modified === 'number') return entry.last_modified;
  const parsed = Date.parse(entry.last_modified);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortEntries(
  entries: DirectoryEntry[],
  sortBy: RepoSortBy,
  lastUsedByPath: Record<string, number>,
  hostId: string
): DirectoryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.is_git_repo && !b.is_git_repo) return -1;
    if (!a.is_git_repo && b.is_git_repo) return 1;

    if (sortBy === 'last_used') {
      const aKey = `${hostId}:${a.path}`;
      const bKey = `${hostId}:${b.path}`;
      const aVal = lastUsedByPath[aKey] ?? 0;
      const bVal = lastUsedByPath[bKey] ?? 0;
      if (aVal !== bVal) return bVal - aVal;
    } else if (sortBy === 'last_modified') {
      const aVal = getLastModifiedValue(a);
      const bVal = getLastModifiedValue(b);
      if (aVal !== bVal) return bVal - aVal;
    }

    return a.name.localeCompare(b.name);
  });
}

function DirectoryNode({
  hostId,
  entry,
  depth,
  showHidden,
  sortBy,
  lastUsedByPath,
  onSelectRepo,
  selectedPath,
}: DirectoryNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Fetch children when expanded
  const { data, isLoading } = useQuery({
    queryKey: ['directory', hostId, entry.path, showHidden],
    queryFn: () => listDirectory(hostId, entry.path, showHidden),
    enabled: isExpanded && entry.is_directory && !entry.is_git_repo,
  });

  const children = useMemo(() => {
    if (!data?.entries) return [];
    const directories = data.entries.filter((e) => e.is_directory);
    return sortEntries(directories, sortBy, lastUsedByPath, hostId);
  }, [data, sortBy, lastUsedByPath, hostId]);

  const isSelected = selectedPath === entry.path;
  const isGitRepo = entry.is_git_repo;

  const handleClick = () => {
    if (isGitRepo) {
      onSelectRepo(entry);
    } else {
      setIsExpanded(!isExpanded);
    }
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isGitRepo) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 py-1 px-2 cursor-pointer rounded hover:bg-accent/50 transition-colors',
          isSelected && 'bg-primary/10 hover:bg-primary/20',
          isGitRepo && 'font-medium'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
      >
        {/* Chevron */}
        <span
          className={cn(
            'flex-shrink-0 w-4 h-4 flex items-center justify-center',
            isGitRepo && 'invisible'
          )}
          onClick={handleChevronClick}
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </span>

        {/* Icon */}
        {isGitRepo ? (
          <FolderGit className="h-4 w-4 flex-shrink-0 text-orange-500" />
        ) : (
          <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" />
        )}

        {/* Name */}
        <span className="truncate text-sm">{entry.name}</span>

        {/* Git branch */}
        {isGitRepo && entry.git_branch && (
          <span className="text-xs text-muted-foreground ml-auto truncate">
            {entry.git_branch}
          </span>
        )}
      </div>

      {/* Children */}
      {isExpanded && !isGitRepo && children.length > 0 && (
        <div>
          {children.map((child) => (
            <DirectoryNode
              key={child.path}
              hostId={hostId}
              entry={child}
              depth={depth + 1}
              showHidden={showHidden}
              sortBy={sortBy}
              lastUsedByPath={lastUsedByPath}
              onSelectRepo={onSelectRepo}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function DirectoryTree({
  hostId,
  rootPath,
  showHidden = false,
  sortBy = 'name',
  lastUsedByPath = {},
  onSelectRepo,
  selectedPath,
}: DirectoryTreeProps) {
  // Fetch root directory
  const { data, isLoading, error } = useQuery({
    queryKey: ['directory', hostId, rootPath, showHidden],
    queryFn: () => listDirectory(hostId, rootPath, showHidden),
    enabled: !!hostId && !!rootPath,
  });

  const entries = useMemo(() => {
    if (!data?.entries) return [];
    const directories = data.entries.filter((e) => e.is_directory);
    return sortEntries(directories, sortBy, lastUsedByPath, hostId);
  }, [data, sortBy, lastUsedByPath, hostId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading directory...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-destructive py-4 px-2">
        Failed to load directory: {(error as Error).message}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 px-2">
        No directories found
      </div>
    );
  }

  return (
    <div className="py-2">
      {entries.map((entry) => (
        <DirectoryNode
          key={entry.path}
          hostId={hostId}
          entry={entry}
          depth={0}
          showHidden={showHidden}
          sortBy={sortBy}
          lastUsedByPath={lastUsedByPath}
          onSelectRepo={onSelectRepo}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  );
}
