'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Server, Terminal, CheckCircle, AlertCircle, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getHosts, getOrphanPanes, adoptOrphanPanes, type OrphanPane } from '@/lib/api';
import { formatRelativeTime, getProviderIcon } from '@/lib/utils';
import { useHydrated } from '@/hooks/useHydrated';

interface ImportOrphanPanesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ImportOrphanPanesModal({ isOpen, onClose, onSuccess }: ImportOrphanPanesModalProps) {
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [selectedPanes, setSelectedPanes] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  // Fetch hosts
  const { data: hostsData, isLoading: hostsLoading } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
    enabled: isOpen,
  });

  // Fetch orphan panes for selected host
  const { data: orphanPanesData, isLoading: panesLoading, refetch: refetchPanes } = useQuery({
    queryKey: ['orphan-panes', selectedHostId],
    queryFn: () => (selectedHostId ? getOrphanPanes(selectedHostId) : Promise.resolve({ orphan_panes: [] })),
    enabled: isOpen && !!selectedHostId,
  });

  // Adopt mutation
  const adoptMutation = useMutation({
    mutationFn: () => {
      if (!selectedHostId || selectedPanes.size === 0) {
        throw new Error('No host or panes selected');
      }
      return adoptOrphanPanes(selectedHostId, Array.from(selectedPanes));
    },
    onSuccess: (result) => {
      // Clear selection
      setSelectedPanes(new Set());
      // Refetch orphan panes
      refetchPanes();
      // Invalidate sessions query
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      // Notify parent
      onSuccess?.();
      // Close if all adopted
      if (result.error_count === 0) {
        handleClose();
      }
    },
  });

  const hosts = hostsData?.hosts || [];
  const orphanPanes = orphanPanesData?.orphan_panes || [];

  const togglePane = (paneId: string) => {
    const newSelected = new Set(selectedPanes);
    if (newSelected.has(paneId)) {
      newSelected.delete(paneId);
    } else {
      newSelected.add(paneId);
    }
    setSelectedPanes(newSelected);
  };

  const toggleAll = () => {
    if (selectedPanes.size === orphanPanes.length) {
      setSelectedPanes(new Set());
    } else {
      setSelectedPanes(new Set(orphanPanes.map((p) => p.id)));
    }
  };

  const handleClose = () => {
    setSelectedPanes(new Set());
    setSelectedHostId(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <Download className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Import Orphan Panes</h2>
          </div>
          <button onClick={handleClose} className="p-1 hover:bg-accent rounded">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Adopt unmanaged tmux panes as tracked sessions. These panes were detected but not created
            through Agent Commander.
          </p>

          {/* Host selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Host</label>
            {hostsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading hosts...
              </div>
            ) : hosts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hosts available</p>
            ) : (
              <select
                value={selectedHostId || ''}
                onChange={(e) => {
                  setSelectedHostId(e.target.value || null);
                  setSelectedPanes(new Set());
                }}
                className="w-full px-3 py-2 text-sm bg-background border rounded-md"
              >
                <option value="">Select a host...</option>
                {hosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.name}
                    {host.tailscale_name ? ` (${host.tailscale_name})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Orphan panes list */}
          {selectedHostId && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  Orphan Panes ({orphanPanes.length})
                </label>
                {orphanPanes.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={toggleAll}>
                    {selectedPanes.size === orphanPanes.length ? 'Deselect All' : 'Select All'}
                  </Button>
                )}
              </div>

              {panesLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading orphan panes...
                </div>
              ) : orphanPanes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                  <p>No orphan panes found on this host.</p>
                  <p className="text-sm">All panes are already managed.</p>
                </div>
              ) : (
                <div className="border rounded-lg divide-y max-h-[300px] overflow-auto">
                  {orphanPanes.map((pane) => (
                    <OrphanPaneRow
                      key={pane.id}
                      pane={pane}
                      isSelected={selectedPanes.has(pane.id)}
                      onToggle={() => togglePane(pane.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error display */}
          {adoptMutation.isError && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              {String(adoptMutation.error)}
            </div>
          )}

          {/* Success with partial errors */}
          {adoptMutation.data && adoptMutation.data.error_count > 0 && (
            <div className="text-sm space-y-1">
              <p className="text-green-600">
                Adopted {adoptMutation.data.adopted_count} pane(s).
              </p>
              <p className="text-destructive">
                Failed to adopt {adoptMutation.data.error_count} pane(s).
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={() => adoptMutation.mutate()}
            disabled={selectedPanes.size === 0 || adoptMutation.isPending}
          >
            {adoptMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adopting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Adopt {selectedPanes.size} Pane{selectedPanes.size !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface OrphanPaneRowProps {
  pane: OrphanPane;
  isSelected: boolean;
  onToggle: () => void;
}

function OrphanPaneRow({ pane, isSelected, onToggle }: OrphanPaneRowProps) {
  const tmuxMeta = pane.metadata?.tmux;
  const currentCommand = tmuxMeta?.current_command || 'shell';
  const hydrated = useHydrated();

  return (
    <div
      className={`flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors ${
        isSelected ? 'bg-muted/30' : ''
      }`}
      onClick={onToggle}
    >
      {/* Custom checkbox */}
      <div
        className={`mt-1 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
          isSelected
            ? 'bg-primary border-primary text-primary-foreground'
            : 'border-muted-foreground'
        }`}
      >
        {isSelected && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="w-3 h-3"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">{getProviderIcon(pane.provider)}</span>
          <span className="font-medium truncate">
            {pane.tmux_target || pane.tmux_pane_id || 'Unknown Pane'}
          </span>
          <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{pane.provider}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
          <Terminal className="h-3 w-3" />
          <span className="truncate">{currentCommand}</span>
        </div>
        {pane.cwd && (
          <div className="text-xs text-muted-foreground truncate mt-0.5">{pane.cwd}</div>
        )}
        {pane.git_branch && (
          <div className="text-xs text-muted-foreground mt-0.5">
            Branch: {pane.git_branch}
          </div>
        )}
        {pane.last_activity_at && (
          <div className="text-xs text-muted-foreground mt-1">
            <span suppressHydrationWarning>
              Last activity: {hydrated ? formatRelativeTime(pane.last_activity_at) : '—'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// Hook for managing import modal state
export function useImportModal() {
  const [isOpen, setIsOpen] = useState(false);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
