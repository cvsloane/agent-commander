'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import type { Host } from '@agent-command/schema';
import { AlertTriangle, Check, Copy, KeyRound, Plus, Server } from 'lucide-react';
import { APIError, generateHostToken, getHosts, updateHostCapabilities } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatRelativeTime, isHostOnline } from '@/lib/utils';
import { useHydrated } from '@/hooks/useHydrated';
import {
  type HostEnrollmentResult,
  buildAgentdConfig,
  createHostEnrollment,
  isForbiddenEnrollmentError,
  resolveHostApiBase,
} from './hostEnrollment';

interface OneTimeEnrollment {
  hostId: string;
  hostName: string;
  token: string;
  apiBase: string;
  kind: 'created' | 'rotated';
}

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
  const [allowHidden, setAllowHidden] = useState(capabilities.list_directory_show_hidden === true);
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
          <Label htmlFor={`directory-listing-${host.id}`} className="text-sm font-medium">
            Directory Listing
          </Label>
          <p className="text-xs text-muted-foreground">
            Allow browsing only within specific roots on this host.
          </p>
        </div>
        <Switch
          id={`directory-listing-${host.id}`}
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      {enabled && (
        <>
          <div className="space-y-2">
            <Label htmlFor={`directory-roots-${host.id}`} className="text-xs text-muted-foreground">
              Allowed Roots (one per line)
            </Label>
            <Textarea
              id={`directory-roots-${host.id}`}
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
            <Label
              htmlFor={`directory-hidden-${host.id}`}
              className="text-xs text-muted-foreground"
            >
              Allow hidden folders
            </Label>
            <Switch
              id={`directory-hidden-${host.id}`}
              checked={allowHidden}
              onCheckedChange={setAllowHidden}
            />
          </div>
        </>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      {saved && <p className="text-xs text-green-600">Saved</p>}

      <div className="flex gap-2">
        <Button
          size="mobile"
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
          <Button size="mobile" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

interface AddHostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: HostEnrollmentResult) => void;
  onForbidden: () => void;
}

function AddHostDialog({ open, onOpenChange, onCreated, onForbidden }: AddHostDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [tailscaleName, setTailscaleName] = useState('');
  const createMutation = useMutation({
    mutationFn: () => createHostEnrollment({ name, tailscaleName }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['hosts'] });
      onCreated(result);
      onOpenChange(false);
    },
    onError: (error) => {
      if (isForbiddenEnrollmentError(error)) onForbidden();
    },
  });

  const forbidden = isForbiddenEnrollmentError(createMutation.error);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add host</DialogTitle>
          <DialogDescription>
            Create an enrollment identity for another machine. You will receive its agent token
            once.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) createMutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="new-host-name">Name</Label>
            <Input
              id="new-host-name"
              className="h-11"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="buildbox"
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-host-tailscale-name">Tailscale name (optional)</Label>
            <Input
              id="new-host-tailscale-name"
              className="h-11"
              value={tailscaleName}
              onChange={(event) => setTailscaleName(event.target.value)}
              placeholder="buildbox.tailnet-name.ts.net"
              autoComplete="off"
            />
          </div>
          {createMutation.error && (
            <div
              className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {forbidden
                ? 'Host enrollment is available to administrators only.'
                : createMutation.error instanceof Error
                  ? createMutation.error.message
                  : 'Failed to create the host.'}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="mobile"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="mobile"
              disabled={!name.trim() || createMutation.isPending || forbidden}
            >
              {createMutation.isPending ? 'Creating…' : 'Create host'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="mobile"
      onClick={() => void copy()}
      className="shrink-0 gap-2"
    >
      {copied ? (
        <Check className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Copy className="h-4 w-4" aria-hidden="true" />
      )}
      {copied ? 'Copied' : label}
    </Button>
  );
}

function OneTimeEnrollmentDialog({
  enrollment,
  open,
  onOpenChange,
}: {
  enrollment: OneTimeEnrollment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!enrollment) return null;
  const config = buildAgentdConfig({
    hostId: enrollment.hostId,
    hostName: enrollment.hostName,
    token: enrollment.token,
    apiBase: enrollment.apiBase,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {enrollment.kind === 'created' ? 'Host created' : 'Agent token rotated'}
          </DialogTitle>
          <DialogDescription>
            Finish enrollment on {enrollment.hostName}. This token is deliberately shown only once.
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <strong>Copy the token now.</strong> Closing this panel removes it from the UI; it
            cannot be viewed again.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Host ID</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-3 text-xs">
                {enrollment.hostId}
              </code>
              <CopyButton value={enrollment.hostId} label="Copy ID" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>One-time agent token</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-3 text-xs">
                {enrollment.token}
              </code>
              <CopyButton value={enrollment.token} label="Copy token" />
            </div>
          </div>
        </div>

        <section className="space-y-3" aria-labelledby="agentd-install-title">
          <h3 id="agentd-install-title" className="font-semibold">
            Install and connect agentd
          </h3>
          <ol className="list-decimal space-y-3 pl-5 text-sm text-muted-foreground">
            <li>
              Build <code className="text-foreground">agents/agentd</code> from source, or download
              the release artifact with{' '}
              <code className="text-foreground">deploy/install-agentd.sh</code>.
            </li>
            <li className="space-y-2">
              <p>
                Write this configuration to{' '}
                <code className="text-foreground">~/.config/agentd/config.yaml</code>:
              </p>
              <pre className="max-h-56 overflow-auto rounded-md border bg-muted p-3 text-xs text-foreground">
                <code>{config}</code>
              </pre>
              <CopyButton value={config} label="Copy config" />
            </li>
            <li>
              Point the agentd user unit at that config, then run{' '}
              <code className="text-foreground">systemctl --user daemon-reload</code> and{' '}
              <code className="text-foreground">systemctl --user enable --now agentd.service</code>.
            </li>
          </ol>
        </section>

        <DialogFooter>
          <Button size="mobile" onClick={() => onOpenChange(false)}>
            I saved the token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function HostsPage() {
  const [expandedHostId, setExpandedHostId] = useState<string | null>(null);
  const [addHostOpen, setAddHostOpen] = useState(false);
  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const [enrollment, setEnrollment] = useState<OneTimeEnrollment | null>(null);
  const [adminDenied, setAdminDenied] = useState(false);
  const hydrated = useHydrated();
  const { data: authSession } = useSession();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
  });
  const canManageEnrollment = authSession?.user.role === 'admin' && !adminDenied;
  const rotateMutation = useMutation({
    mutationFn: (host: Host) => generateHostToken(host.id),
    onSuccess: ({ token }, host) => {
      setEnrollment({
        hostId: host.id,
        hostName: host.name,
        token,
        apiBase: resolveHostApiBase(),
        kind: 'rotated',
      });
      setEnrollmentOpen(true);
    },
    onError: (mutationError) => {
      if (mutationError instanceof APIError && mutationError.status === 403) {
        setAdminDenied(true);
      }
    },
  });

  const showCreatedEnrollment = (result: HostEnrollmentResult) => {
    setEnrollment({
      hostId: result.host.id,
      hostName: result.host.name,
      token: result.token,
      apiBase: resolveHostApiBase(),
      kind: 'created',
    });
    setEnrollmentOpen(true);
  };

  const handleEnrollmentOpenChange = (open: boolean) => {
    setEnrollmentOpen(open);
    if (!open) setEnrollment(null);
  };

  if (isLoading) {
    return (
      <div
        className="mx-auto flex w-full max-w-7xl items-center justify-center px-3 py-16 sm:px-4"
        role="status"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-b-primary" />
        <span className="sr-only">Loading hosts</span>
      </div>
    );
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return (
      <div className="mx-auto w-full max-w-7xl px-3 py-12 text-center sm:px-4">
        <p className="text-destructive mb-2">Failed to load hosts</p>
        <p className="text-xs text-muted-foreground mb-4">{errorMessage}</p>
        <Button size="mobile" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const hosts = data?.hosts || [];

  const isOnline = (lastSeen: string | null) => {
    if (!hydrated) return false;
    return isHostOnline(lastSeen);
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-3 py-4 sm:px-4 sm:py-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Server className="h-6 w-6 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-bold sm:text-2xl">Hosts</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {hosts.length} registered · manage connectivity and directory access.
          </p>
        </div>
        {canManageEnrollment && (
          <Button size="mobile" onClick={() => setAddHostOpen(true)} className="shrink-0 gap-2">
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Add host</span>
            <span className="sr-only sm:hidden">Add host</span>
          </Button>
        )}
      </header>

      {rotateMutation.error && !adminDenied && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {rotateMutation.error instanceof Error
            ? rotateMutation.error.message
            : 'Failed to rotate the agent token.'}
        </div>
      )}

      {hosts.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-muted-foreground">
          <p>No hosts registered</p>
          <p className="text-sm mt-2">Install agentd on a machine to register it</p>
          {canManageEnrollment && (
            <Button size="mobile" className="mt-4" onClick={() => setAddHostOpen(true)}>
              Add your first host
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {hosts.map((host) => {
            const online = isOnline(host.last_seen_at || null);
            const capabilities = host.capabilities as Record<string, unknown>;
            const showEditor = expandedHostId === host.id;

            return (
              <Card key={host.id} className="shadow-sm">
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

                  <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <Button
                      variant="outline"
                      size="mobile"
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

                  {canManageEnrollment && (
                    <Button
                      variant="outline"
                      size="mobile"
                      className="w-full gap-2"
                      disabled={
                        rotateMutation.isPending && rotateMutation.variables?.id === host.id
                      }
                      onClick={() => rotateMutation.mutate(host)}
                    >
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                      {rotateMutation.isPending && rotateMutation.variables?.id === host.id
                        ? 'Rotating token…'
                        : 'Rotate agent token'}
                    </Button>
                  )}

                  {showEditor && (
                    <DirectoryAccessEditor host={host} onClose={() => setExpandedHostId(null)} />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {addHostOpen && (
        <AddHostDialog
          open={addHostOpen}
          onOpenChange={setAddHostOpen}
          onCreated={showCreatedEnrollment}
          onForbidden={() => setAdminDenied(true)}
        />
      )}
      <OneTimeEnrollmentDialog
        enrollment={enrollment}
        open={enrollmentOpen}
        onOpenChange={handleEnrollmentOpenChange}
      />
    </div>
  );
}
