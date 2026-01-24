'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Server, FolderPlus, ChevronRight, Home, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getHosts, type DirectoryEntry } from '@/lib/api';
import { isHostOffline } from '@/components/StatusBadge';
import { useSettingsStore } from '@/stores/settings';
import { DirectoryTree } from './DirectoryTree';

interface RepoPickerProps {
  onSelectRepo: (hostId: string, entry: DirectoryEntry) => void;
  selectedHostId?: string;
  selectedPath?: string;
  onOpenSettings?: () => void;
}

export function RepoPicker({
  onSelectRepo,
  selectedHostId,
  selectedPath,
  onOpenSettings,
}: RepoPickerProps) {
  const { devFolders, showHiddenFolders, repoSortBy, repoLastUsed, markRepoUsed } = useSettingsStore();

  // Fetch hosts
  const { data: hostsData, isLoading: hostsLoading } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
  });

  // Filter to online hosts only
  const onlineHosts = useMemo(
    () => hostsData?.hosts.filter((h) => !isHostOffline(h)) || [],
    [hostsData]
  );

  // Selected host state
  const [hostId, setHostId] = useState<string>(selectedHostId || '');

  const selectedHost = useMemo(
    () => onlineHosts.find((host) => host.id === hostId),
    [onlineHosts, hostId]
  );

  const hostDefaultRoot = useMemo(() => {
    const roots = (selectedHost?.capabilities as { list_directory_roots?: string[] } | undefined)
      ?.list_directory_roots;
    if (Array.isArray(roots) && roots.length > 0) {
      return roots[0];
    }
    return '~';
  }, [selectedHost]);

  // Active dev folder tab
  const [activeDevFolderIndex, setActiveDevFolderIndex] = useState<number>(0);

  // Manual path input
  const [manualPath, setManualPath] = useState<string>('');
  const [showManualInput, setShowManualInput] = useState(false);

  // Get dev folders for selected host
  const hostDevFolders = useMemo(
    () => devFolders.filter((f) => f.hostId === hostId),
    [devFolders, hostId]
  );

  // Current path to browse
  const currentPath = useMemo(() => {
    if (showManualInput && manualPath) {
      return manualPath;
    }
    if (hostDevFolders.length > 0 && activeDevFolderIndex < hostDevFolders.length) {
      return hostDevFolders[activeDevFolderIndex].path;
    }
    return hostDefaultRoot;
  }, [hostDevFolders, activeDevFolderIndex, showManualInput, manualPath, hostDefaultRoot]);

  // Handle repo selection
  const handleSelectRepo = (entry: DirectoryEntry) => {
    if (hostId) {
      markRepoUsed(hostId, entry.path);
      onSelectRepo(hostId, entry);
    }
  };

  // Sync selected host from props
  useEffect(() => {
    if (selectedHostId) {
      setHostId(selectedHostId);
      setShowManualInput(false);
      setManualPath('');
    }
  }, [selectedHostId]);

  // Set host when first loading if we have online hosts
  useEffect(() => {
    if (!hostId && onlineHosts.length > 0) {
      setHostId(onlineHosts[0].id);
    }
  }, [hostId, onlineHosts]);

  // Reset active tab when host dev folders change
  useEffect(() => {
    if (activeDevFolderIndex >= hostDevFolders.length) {
      setActiveDevFolderIndex(0);
    }
  }, [activeDevFolderIndex, hostDevFolders.length]);

  // Build breadcrumb parts
  const breadcrumbParts = useMemo(() => {
    if (!currentPath) return [];
    const parts = currentPath.split('/').filter(Boolean);
    if (currentPath.startsWith('~')) {
      return [{ name: '~', path: '~' }, ...parts.slice(1).map((p, i) => ({
        name: p,
        path: '~/' + parts.slice(1, i + 2).join('/'),
      }))];
    }
    return [{ name: '/', path: '/' }, ...parts.map((p, i) => ({
      name: p,
      path: '/' + parts.slice(0, i + 1).join('/'),
    }))];
  }, [currentPath]);

  return (
    <div className="flex flex-col h-full">
      {/* Host selector */}
      <div className="p-3 border-b">
        <label className="block text-sm font-medium mb-2">
          <Server className="h-3.5 w-3.5 inline mr-1" />
          Host
        </label>
        {hostsLoading ? (
          <div className="text-sm text-muted-foreground">Loading hosts...</div>
        ) : onlineHosts.length === 0 ? (
          <div className="text-sm text-destructive">
            No online hosts available. Please start an agent first.
          </div>
        ) : (
          <select
            value={hostId}
            onChange={(e) => {
              setHostId(e.target.value);
              setActiveDevFolderIndex(0);
              setShowManualInput(false);
              setManualPath('');
            }}
            className="w-full px-3 py-2 border rounded-md bg-background text-sm"
          >
            <option value="">Select a host...</option>
            {onlineHosts.map((host) => (
              <option key={host.id} value={host.id}>
                {host.name}
                {host.tailscale_name && ` (${host.tailscale_name})`}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Dev folder tabs */}
      {hostId && (
        <div className="border-b">
          <div className="flex items-center gap-1 p-2 overflow-x-auto">
            {hostDevFolders.map((folder, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setActiveDevFolderIndex(idx);
                  setShowManualInput(false);
                }}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md whitespace-nowrap transition-colors',
                  activeDevFolderIndex === idx && !showManualInput
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-accent hover:bg-accent/80'
                )}
              >
                {folder.label || folder.path.split('/').pop() || folder.path}
              </button>
            ))}
            <button
              onClick={() => setShowManualInput(true)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-md flex items-center gap-1 transition-colors',
                showManualInput
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-accent hover:bg-accent/80'
              )}
            >
              <FolderPlus className="h-3.5 w-3.5" />
              Custom
            </button>
            {onOpenSettings && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={onOpenSettings}
                title="Configure dev folders"
              >
                <Settings className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Manual path input */}
          {showManualInput && (
            <div className="px-3 pb-3">
              <input
                type="text"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="Enter path (e.g., ~/projects)"
                className="w-full px-3 py-2 border rounded-md bg-background font-mono text-sm"
              />
            </div>
          )}
        </div>
      )}

      {/* Breadcrumb */}
      {hostId && currentPath && (
        <div className="flex items-center gap-1 px-3 py-2 text-sm text-muted-foreground border-b overflow-x-auto">
          <Home className="h-3.5 w-3.5 flex-shrink-0" />
          {breadcrumbParts.map((part, idx) => (
            <span key={part.path} className="flex items-center gap-1">
              {idx > 0 && <ChevronRight className="h-3 w-3 flex-shrink-0" />}
              <button
                type="button"
                className="hover:text-foreground cursor-pointer"
                onClick={() => {
                  setManualPath(part.path);
                  setShowManualInput(true);
                }}
              >
                {part.name}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Directory tree */}
      <div className="flex-1 overflow-auto">
        {hostId && currentPath ? (
          <DirectoryTree
            hostId={hostId}
            rootPath={currentPath}
            showHidden={showHiddenFolders}
            sortBy={repoSortBy}
            lastUsedByPath={repoLastUsed}
            onSelectRepo={handleSelectRepo}
            selectedPath={selectedPath}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
            <Server className="h-8 w-8 mb-2" />
            <p className="text-sm text-center">
              Select a host to browse repositories
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
