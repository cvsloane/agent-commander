'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Power, Globe, Folder, Plug, RotateCcw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getSessionMCPConfig, updateSessionMCPConfig, type MCPServer, type MCPEnablement } from '@/lib/api';

interface MCPManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  repoRoot?: string;
}

type Scope = 'session' | 'project' | 'global';

export function MCPManagerModal({ isOpen, onClose, sessionId, repoRoot }: MCPManagerModalProps) {
  const queryClient = useQueryClient();
  const [selectedScope, setSelectedScope] = useState<Scope>('session');
  const [pendingChanges, setPendingChanges] = useState<Record<string, { enabled: boolean; scope?: Scope }>>({});
  const [updateError, setUpdateError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['session-mcp', sessionId],
    queryFn: () => getSessionMCPConfig(sessionId),
    enabled: isOpen,
  });

  const updateMutation = useMutation({
    mutationFn: (enablement: Record<string, { enabled: boolean; scope?: Scope }>) =>
      updateSessionMCPConfig(sessionId, enablement),
    onSuccess: (result) => {
      if (!result.success) {
        setUpdateError(result.error || 'Failed to update MCP configuration');
        return;
      }
      setUpdateError(null);
      queryClient.invalidateQueries({ queryKey: ['session-mcp', sessionId] });
      setPendingChanges({});
    },
    onError: (error) => {
      setUpdateError(error instanceof Error ? error.message : 'Failed to update MCP configuration');
    },
  });

  useEffect(() => {
    if (isOpen) {
      setUpdateError(null);
    }
  }, [isOpen]);

  // Keyboard shortcuts when modal is open
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'l' && !e.metaKey && !e.ctrlKey) {
        setSelectedScope('project');
      } else if (e.key === 'g' && !e.metaKey && !e.ctrlKey) {
        setSelectedScope('global');
      } else if (e.key === 's' && !e.metaKey && !e.ctrlKey) {
        setSelectedScope('session');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const servers = data?.servers || [];
  const enablement = data?.enablement || {};
  const restartRequired = data?.restart_required || false;

  const getEffectiveEnablement = (mcpName: string): { enabled: boolean; scope: Scope } => {
    // Check pending changes first
    if (pendingChanges[mcpName]) {
      return {
        enabled: pendingChanges[mcpName].enabled,
        scope: pendingChanges[mcpName].scope || selectedScope,
      };
    }
    // Fall back to current enablement
    return enablement[mcpName] || { enabled: true, scope: 'global' };
  };

  const toggleMCP = (mcpName: string) => {
    const current = getEffectiveEnablement(mcpName);
    setPendingChanges(prev => ({
      ...prev,
      [mcpName]: {
        enabled: !current.enabled,
        scope: selectedScope,
      },
    }));
  };

  const applyChanges = () => {
    if (Object.keys(pendingChanges).length > 0) {
      updateMutation.mutate(pendingChanges);
    }
  };

  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  const getScopeIcon = (scope: Scope) => {
    switch (scope) {
      case 'session':
        return <Power className="h-3 w-3" />;
      case 'project':
        return <Folder className="h-3 w-3" />;
      case 'global':
        return <Globe className="h-3 w-3" />;
    }
  };

  const getScopeLabel = (scope: Scope) => {
    switch (scope) {
      case 'session':
        return 'Session';
      case 'project':
        return 'Project';
      case 'global':
        return 'Global';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-2xl max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">MCP Manager</h2>
            {restartRequired && (
              <Badge variant="waiting" className="gap-1">
                <RotateCcw className="h-3 w-3" />
                Restart Required
              </Badge>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scope selector */}
        <div className="px-4 py-2 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground mr-2">Apply changes to:</span>
            {(['session', 'project', 'global'] as const).map((scope) => (
              <Button
                key={scope}
                variant={selectedScope === scope ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedScope(scope)}
                className="gap-1"
              >
                {getScopeIcon(scope)}
                {getScopeLabel(scope)}
                <kbd className="ml-1 text-xs bg-muted px-1 rounded">
                  {scope === 'session' ? 's' : scope === 'project' ? 'l' : 'g'}
                </kbd>
              </Button>
            ))}
          </div>
          {selectedScope === 'project' && repoRoot && (
            <p className="text-xs text-muted-foreground mt-1">
              Project: {repoRoot.split('/').pop()}
            </p>
          )}
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-4" style={{ maxHeight: 'calc(80vh - 180px)' }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-8 text-destructive gap-2">
              <AlertCircle className="h-5 w-5" />
              <span>Failed to load MCP config</span>
            </div>
          ) : servers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No MCP servers configured.</p>
              <p className="text-sm mt-2">
                Add MCPs to <code className="bg-muted px-1 rounded">~/.agentcommander/config.toml</code>
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {servers.map((server) => {
                const state = getEffectiveEnablement(server.name);
                const isPending = pendingChanges[server.name] !== undefined;

                return (
                  <div
                    key={server.name}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      isPending ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleMCP(server.name)}
                        className={`w-10 h-6 rounded-full relative transition-colors ${
                          state.enabled ? 'bg-primary' : 'bg-muted'
                        }`}
                      >
                        <span
                          className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                            state.enabled ? 'left-5' : 'left-1'
                          }`}
                        />
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {server.display_name || server.name}
                          </span>
                          {server.poolable && (
                            <span className="text-xs" title="Pooled MCP">🔌</span>
                          )}
                          {server.has_secrets && (
                            <span className="text-xs" title="Has secrets">🔐</span>
                          )}
                        </div>
                        {server.description && (
                          <p className="text-sm text-muted-foreground">
                            {server.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="gap-1">
                        {getScopeIcon(state.scope)}
                        {getScopeLabel(state.scope)}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t bg-muted/30 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            <kbd className="px-1 py-0.5 bg-muted rounded border">s</kbd>/<kbd className="px-1 py-0.5 bg-muted rounded border">l</kbd>/<kbd className="px-1 py-0.5 bg-muted rounded border">g</kbd> to change scope
            {updateError && (
              <span className="ml-3 text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {updateError}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={applyChanges}
              disabled={!hasPendingChanges || updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Applying...' : 'Apply Changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Hook to manage MCP manager modal
export function useMCPManager() {
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [repoRoot, setRepoRoot] = useState<string | undefined>(undefined);

  const open = (sessionId: string, repoRoot?: string) => {
    setSessionId(sessionId);
    setRepoRoot(repoRoot);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setSessionId(null);
    setRepoRoot(undefined);
  };

  return {
    isOpen,
    sessionId,
    repoRoot,
    open,
    close,
  };
}
