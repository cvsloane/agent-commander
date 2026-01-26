'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { X, Server, FolderOpen, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getHosts, getGroups, getProjects, spawnSession, type SpawnProvider } from '@/lib/api';
import { isHostOffline } from '@/components/StatusBadge';

const PROVIDERS: Array<{ id: SpawnProvider; name: string; description: string }> = [
  { id: 'claude_code', name: 'Claude Code', description: 'Anthropic Claude CLI agent' },
  { id: 'codex', name: 'Codex', description: 'OpenAI Codex CLI agent' },
  { id: 'gemini_cli', name: 'Gemini CLI', description: 'Google Gemini CLI agent' },
  { id: 'opencode', name: 'OpenCode', description: 'OpenCode CLI agent (Minimax)' },
  { id: 'aider', name: 'Aider', description: 'GPT-powered coding assistant' },
  { id: 'shell', name: 'Shell', description: 'Plain bash shell' },
];

interface SpawnSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  defaultHostId?: string;
  defaultWorkingDirectory?: string;
  defaultGroupId?: string;
}

export function SpawnSessionDialog({
  isOpen,
  onClose,
  defaultHostId,
  defaultWorkingDirectory = '~',
  defaultGroupId,
}: SpawnSessionDialogProps) {
  const router = useRouter();

  // Form state
  const [hostId, setHostId] = useState(defaultHostId || '');
  const [provider, setProvider] = useState<SpawnProvider>('claude_code');
  const [workingDirectory, setWorkingDirectory] = useState(defaultWorkingDirectory);
  const [title, setTitle] = useState('');
  const [flags, setFlags] = useState('');
  const [groupId, setGroupId] = useState(defaultGroupId || '');
  const [error, setError] = useState<string | null>(null);

  // Fetch hosts
  const { data: hostsData, isLoading: hostsLoading } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
    enabled: isOpen,
  });

  // Fetch groups
  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
    enabled: isOpen,
  });

  // Fetch projects for selected host (autocomplete)
  const { data: projectsData } = useQuery({
    queryKey: ['projects', hostId],
    queryFn: () => (hostId ? getProjects({ host_id: hostId, limit: 50 }) : Promise.resolve({ projects: [] })),
    enabled: isOpen && !!hostId,
  });

  // Filter to online hosts only
  const onlineHosts = useMemo(() => {
    return hostsData?.hosts.filter((h) => !isHostOffline(h)) || [];
  }, [hostsData]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setHostId(defaultHostId || onlineHosts[0]?.id || '');
      setProvider('claude_code');
      setWorkingDirectory(defaultWorkingDirectory);
      setTitle('');
      setFlags('');
      setGroupId(defaultGroupId || '');
      setError(null);
    }
  }, [isOpen, defaultHostId, defaultWorkingDirectory, defaultGroupId, onlineHosts]);

  // Spawn mutation
  const spawnMutation = useMutation({
    mutationFn: spawnSession,
    onSuccess: (result) => {
      onClose();
      // Navigate to the new session
      router.push(`/sessions/${result.session.id}`);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!hostId) {
      setError('Please select a host');
      return;
    }

    if (!workingDirectory.trim()) {
      setError('Working directory is required');
      return;
    }

    // Parse flags
    const flagsArray = flags
      .split(/\s+/)
      .map((f) => f.trim())
      .filter(Boolean);
    const trimmedWorkingDir = workingDirectory.trim().replace(/\/+$/, '');
    const targetSession = trimmedWorkingDir
      .split('/')
      .filter(Boolean)
      .pop();
    const windowName = title.trim() || provider;

    spawnMutation.mutate({
      host_id: hostId,
      provider,
      working_directory: workingDirectory.trim(),
      title: title.trim() || undefined,
      flags: flagsArray.length > 0 ? flagsArray : undefined,
      group_id: groupId || undefined,
      tmux: {
        target_session: targetSession || undefined,
        window_name: windowName,
      },
    });
  };

  const isLoading = spawnMutation.isPending || hostsLoading || groupsLoading;
  const projects = projectsData?.projects || [];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Play className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Spawn New Session</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded"
            disabled={isLoading}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Host selection */}
          <div>
            <label className="block text-sm font-medium mb-1">
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
                onChange={(e) => setHostId(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background"
                disabled={isLoading}
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

          {/* Provider selection */}
          <div>
            <label className="block text-sm font-medium mb-1">Provider</label>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`p-3 border rounded-md text-left transition-colors ${
                    provider === p.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => setProvider(p.id)}
                  disabled={isLoading}
                >
                  <div className="font-medium text-sm">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Working directory */}
          <div>
            <label className="block text-sm font-medium mb-1">
              <FolderOpen className="h-3.5 w-3.5 inline mr-1" />
              Working Directory
            </label>
            <input
              type="text"
              value={workingDirectory}
              onChange={(e) => setWorkingDirectory(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background font-mono text-sm"
              placeholder="/path/to/project"
              list="project-paths"
              disabled={isLoading}
            />
            <datalist id="project-paths">
              {projects.map((project) => (
                <option key={project.id} value={project.path}>
                  {project.display_name || project.path}
                </option>
              ))}
            </datalist>
            {projects.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Suggestions from recently used projects on this host.
              </p>
            )}
          </div>

          {/* Title (optional) */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Title <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background"
              placeholder="My coding session"
              disabled={isLoading}
            />
          </div>

          {/* Flags (optional) */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Flags <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={flags}
              onChange={(e) => setFlags(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background font-mono text-sm"
              placeholder="--model sonnet --dangerously-skip-permissions"
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Additional CLI flags for the provider
            </p>
          </div>

          {/* Group (optional) */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Group <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background"
              disabled={isLoading}
            >
              <option value="">No group</option>
              {groupsData?.flat.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Error */}
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || onlineHosts.length === 0}
            >
              {spawnMutation.isPending ? 'Spawning...' : 'Spawn Session'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
