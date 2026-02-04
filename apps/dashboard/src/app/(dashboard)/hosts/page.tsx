'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Host } from '@agent-command/schema';
import { getHosts, updateHostCapabilities } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatRelativeTime, isHostOnline } from '@/lib/utils';
import { useHydrated } from '@/hooks/useHydrated';

interface DirectoryAccessEditorProps {
  host: Host;
  onClose?: () => void;
}

function DirectoryAccessEditor({ host, onClose }: DirectoryAccessEditorProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const capabilities = (host.capabilities || {}) as Record<string, unknown>;
  const [enabled, setEnabled] = useState(capabilities.list_directory === true);
  const [allowHidden, setAllowHidden] = useState(
    capabilities.list_directory_show_hidden === true
  );
  const [rootsText, setRootsText] = useState(
    Array.isArray(capabilities.list_directory_roots)
      ? (capabilities.list_directory_roots as string[]).join('\n')
      : ''
  );

  useEffect(() => {
    const nextCapabilities = (host.capabilities || {}) as Record<string, unknown>;
    setEnabled(nextCapabilities.list_directory === true);
    setAllowHidden(nextCapabilities.list_directory_show_hidden === true);
    setRootsText(
      Array.isArray(nextCapabilities.list_directory_roots)
        ? (nextCapabilities.list_directory_roots as string[]).join('\n')
        : ''
    );
    setError(null);
    setSaved(false);
  }, [host.id, host.capabilities]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => updateHostCapabilities(host.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hosts'] });
      setSaved(true);
      setError(null);
      if (onClose) {
        setTimeout(() => onClose(), 600);
      }
    },
    onError: (err: Error) => {
      setSaved(false);
      setError(err.message);
    },
  });

  const roots = rootsText
    .split('\n')
    .map((root) => root.trim())
    .filter((root) => root.length > 0);
  const canSave = !enabled || roots.length > 0;

  return (
    <div className="mt-3 border rounded-md p-3 space-y-3 bg-accent/20">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Directory Listing</Label>
          <p className="text-xs text-muted-foreground">
            Allow browsing only within specific roots on this host.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      {enabled && (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Allowed Roots (one per line)</Label>
            <Textarea
              value={rootsText}
              onChange={(e) => setRootsText(e.target.value)}
              placeholder="~/dev&#10;/srv/repos"
              className="min-h-[90px] font-mono text-sm"
            />
            {!canSave && (
              <p className="text-xs text-destructive">
                Add at least one root to enable directory listing.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Allow hidden folders</Label>
            <Switch checked={allowHidden} onCheckedChange={setAllowHidden} />
          </div>
        </>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      {saved && <p className="text-xs text-green-600">Saved</p>}

      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={mutation.isPending || !canSave}
          onClick={() =>
            mutation.mutate({
              list_directory: enabled,
              list_directory_roots: roots,
              list_directory_show_hidden: allowHidden,
            })
          }
        >
          {mutation.isPending ? 'Saving...' : 'Save'}
        </Button>
        {onClose && (
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

export default function HostsPage() {
  const [expandedHostId, setExpandedHostId] = useState<string | null>(null);
  const hydrated = useHydrated();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return (
      <div className="container mx-auto px-4 py-6 text-center">
        <p className="text-destructive mb-2">Failed to load hosts</p>
        <p className="text-xs text-muted-foreground mb-4">{errorMessage}</p>
        <Button onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const hosts = data?.hosts || [];

  const isOnline = (lastSeen: string | null) => {
    if (!hydrated) return false;
    return isHostOnline(lastSeen);
  };

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Hosts</h1>
        <span className="text-sm text-muted-foreground">{hosts.length} registered</span>
      </div>

      {hosts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No hosts registered</p>
          <p className="text-sm mt-2">Install agentd on a machine to register it</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {hosts.map((host) => {
            const online = isOnline(host.last_seen_at || null);
            const capabilities = host.capabilities as Record<string, unknown>;
            const showEditor = expandedHostId === host.id;

            return (
              <Card key={host.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{host.name}</CardTitle>
                    <Badge variant={online ? 'running' : 'done'} suppressHydrationWarning>
                      {online ? 'Online' : 'Offline'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm">
                    {host.tailscale_name && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tailscale</span>
                        <span className="font-mono text-xs">{host.tailscale_name}</span>
                      </div>
                    )}
                    {host.tailscale_ip && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">IP</span>
                        <span className="font-mono text-xs">{host.tailscale_ip}</span>
                      </div>
                    )}
                    {host.agent_version && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Version</span>
                        <span>{host.agent_version}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last Seen</span>
                      <span suppressHydrationWarning>
                        {host.last_seen_at
                          ? hydrated
                            ? formatRelativeTime(host.last_seen_at)
                            : '—'
                          : 'Never'}
                      </span>
                    </div>
                  </div>

                  {/* Capabilities */}
                  <div>
                    <span className="text-sm text-muted-foreground">Capabilities</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {Object.entries(capabilities)
                        .filter(([, enabled]) => enabled === true)
                        .map(([cap]) => (
                          <Badge key={cap} variant="secondary" className="text-xs">
                            {cap.replace(/_/g, ' ')}
                          </Badge>
                        ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setExpandedHostId((prev) => (prev === host.id ? null : host.id))
                      }
                    >
                      {showEditor ? 'Close Access Settings' : 'Directory Access'}
                    </Button>
                    {capabilities.list_directory === true && (
                      <Badge variant="secondary" className="text-xs">
                        Directory listing enabled
                      </Badge>
                    )}
                  </div>

                  {showEditor && (
                    <DirectoryAccessEditor
                      host={host}
                      onClose={() => setExpandedHostId(null)}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
