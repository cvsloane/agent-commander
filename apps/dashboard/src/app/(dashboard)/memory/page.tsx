'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createMemoryEntry, getRepos, searchMemory } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

const selectClassName =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const EMPTY_REPOS: Array<{
  id: string;
  display_name?: string | null;
  last_repo_root?: string | null;
  canonical_key: string;
}> = [];

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

export const dynamic = 'force-dynamic';

export default function MemoryPage() {
  const queryClient = useQueryClient();
  const [searchDraft, setSearchDraft] = useState({
    q: '',
    scope_type: '',
    repo_id: '',
    tier: '',
    limit: '10',
  });
  const [submittedSearch, setSubmittedSearch] = useState<{
    q: string;
    scope_type?: 'global' | 'repo' | 'working';
    repo_id?: string;
    tier?: 'working' | 'episodic' | 'semantic' | 'procedural';
    limit: number;
  } | null>(null);
  const [memoryForm, setMemoryForm] = useState({
    scope_type: 'global',
    repo_id: '',
    tier: 'procedural',
    summary: '',
    content: '',
    confidence: '0.8',
  });

  const { data: reposData, refetch: refetchRepos } = useQuery({
    queryKey: ['repos', 'memory'],
    queryFn: () => getRepos({ limit: 100 }),
  });
  const repos = reposData?.repos ?? EMPTY_REPOS;
  const repoMap = useMemo(() => new Map(repos.map((repo) => [repo.id, repo])), [repos]);

  const {
    data: searchData,
    isFetching: searchLoading,
    error: searchError,
    refetch: refetchSearch,
  } = useQuery({
    queryKey: ['memory', 'search', submittedSearch],
    queryFn: () => searchMemory(submittedSearch!),
    enabled: Boolean(submittedSearch?.q),
  });

  const createMemoryMutation = useMutation({
    mutationFn: async () =>
      createMemoryEntry({
        scope_type: memoryForm.scope_type as 'global' | 'repo',
        repo_id: memoryForm.scope_type === 'repo' ? memoryForm.repo_id || undefined : undefined,
        tier: memoryForm.tier as 'episodic' | 'semantic' | 'procedural',
        summary: memoryForm.summary.trim(),
        content: memoryForm.content.trim(),
        confidence: Number(memoryForm.confidence),
      }),
    onSuccess: () => {
      setMemoryForm({
        scope_type: 'global',
        repo_id: '',
        tier: 'procedural',
        summary: '',
        content: '',
        confidence: '0.8',
      });
      if (submittedSearch?.q) {
        void queryClient.invalidateQueries({ queryKey: ['memory', 'search'] });
      }
    },
  });

  const handleRefresh = (): void => {
    void refetchRepos();
    if (submittedSearch?.q) {
      void refetchSearch();
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Brain className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Memory</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Search repo and global memory, then add durable knowledge without touching working-memory internals.
          </p>
        </div>
        <Button variant="outline" onClick={handleRefresh} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr,0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Search Memory</CardTitle>
            <CardDescription>
              Repo memory is best for codebase-specific patterns. Global memory is best for preferences and cross-repo lessons.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="space-y-1 xl:col-span-2">
                <Label htmlFor="memory-query">Query</Label>
                <Input
                  id="memory-query"
                  value={searchDraft.q}
                  onChange={(event) => setSearchDraft((current) => ({ ...current, q: event.target.value }))}
                  placeholder="heartbeat scheduler claim logic"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="memory-scope">Scope</Label>
                <select
                  id="memory-scope"
                  className={selectClassName}
                  value={searchDraft.scope_type}
                  onChange={(event) => setSearchDraft((current) => ({ ...current, scope_type: event.target.value }))}
                >
                  <option value="">All relevant</option>
                  <option value="global">Global</option>
                  <option value="repo">Repo</option>
                  <option value="working">Working</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="memory-tier">Tier</Label>
                <select
                  id="memory-tier"
                  className={selectClassName}
                  value={searchDraft.tier}
                  onChange={(event) => setSearchDraft((current) => ({ ...current, tier: event.target.value }))}
                >
                  <option value="">Any tier</option>
                  <option value="working">Working</option>
                  <option value="episodic">Episodic</option>
                  <option value="semantic">Semantic</option>
                  <option value="procedural">Procedural</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="memory-limit">Limit</Label>
                <Input
                  id="memory-limit"
                  type="number"
                  min="1"
                  max="50"
                  value={searchDraft.limit}
                  onChange={(event) => setSearchDraft((current) => ({ ...current, limit: event.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr,auto]">
              <div className="space-y-1">
                <Label htmlFor="memory-repo">Repo</Label>
                <select
                  id="memory-repo"
                  className={selectClassName}
                  value={searchDraft.repo_id}
                  onChange={(event) => setSearchDraft((current) => ({ ...current, repo_id: event.target.value }))}
                >
                  <option value="">No repo filter</option>
                  {repos.map((repo) => (
                    <option key={repo.id} value={repo.id}>
                      {repo.display_name || repo.last_repo_root || repo.canonical_key}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                className="self-end gap-2"
                onClick={() =>
                  setSubmittedSearch({
                    q: searchDraft.q.trim(),
                    scope_type: searchDraft.scope_type
                      ? (searchDraft.scope_type as 'global' | 'repo' | 'working')
                      : undefined,
                    repo_id: searchDraft.repo_id || undefined,
                    tier: searchDraft.tier
                      ? (searchDraft.tier as 'working' | 'episodic' | 'semantic' | 'procedural')
                      : undefined,
                    limit: Math.min(50, Math.max(1, Number.parseInt(searchDraft.limit, 10) || 10)),
                  })
                }
                disabled={!searchDraft.q.trim()}
              >
                <Search className="h-4 w-4" />
                Search
              </Button>
            </div>

            {submittedSearch && (
              <div className="space-y-3">
                {searchLoading && (
                  <p className="text-sm text-muted-foreground">Searching memory...</p>
                )}
                {searchError && (
                  <p className="text-sm text-destructive">
                    {searchError instanceof Error ? searchError.message : 'Memory search failed'}
                  </p>
                )}
                {!searchLoading && (searchData?.results || []).length === 0 && (
                  <p className="text-sm text-muted-foreground">No memory matches found.</p>
                )}
                <div className="space-y-3">
                  {(searchData?.results || []).map((entry) => {
                    const repo = entry.repo_id ? repoMap.get(entry.repo_id) : null;
                    return (
                      <Card key={entry.id}>
                        <CardContent className="p-4 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{entry.scope_type}</Badge>
                              <Badge variant="secondary">{entry.tier}</Badge>
                              <span className="text-sm text-muted-foreground">
                                confidence {confidenceLabel(entry.confidence)}
                              </span>
                            </div>
                            <span className="text-sm text-muted-foreground">
                              {entry.updated_at ? formatRelativeTime(entry.updated_at) : 'just now'}
                            </span>
                          </div>
                          <div className="space-y-1">
                            <p className="font-medium">{entry.summary}</p>
                            <p className="text-sm text-muted-foreground">
                              {repo
                                ? repo.display_name || repo.last_repo_root || repo.canonical_key
                                : entry.scope_type === 'global'
                                  ? 'Global memory'
                                  : 'Session-scoped memory'}
                            </p>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">{entry.content}</p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add Durable Memory</CardTitle>
            <CardDescription>
              Manual writes are for global and repo memory only. Working memory is captured from sessions automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="memory-form-scope">Scope</Label>
                <select
                  id="memory-form-scope"
                  className={selectClassName}
                  value={memoryForm.scope_type}
                  onChange={(event) => setMemoryForm((current) => ({ ...current, scope_type: event.target.value }))}
                >
                  <option value="global">Global</option>
                  <option value="repo">Repo</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="memory-form-tier">Tier</Label>
                <select
                  id="memory-form-tier"
                  className={selectClassName}
                  value={memoryForm.tier}
                  onChange={(event) => setMemoryForm((current) => ({ ...current, tier: event.target.value }))}
                >
                  <option value="procedural">Procedural</option>
                  <option value="semantic">Semantic</option>
                  <option value="episodic">Episodic</option>
                </select>
              </div>
            </div>

            {memoryForm.scope_type === 'repo' && (
              <div className="space-y-1">
                <Label htmlFor="memory-form-repo">Repo</Label>
                <select
                  id="memory-form-repo"
                  className={selectClassName}
                  value={memoryForm.repo_id}
                  onChange={(event) => setMemoryForm((current) => ({ ...current, repo_id: event.target.value }))}
                >
                  <option value="">Select repo...</option>
                  {repos.map((repo) => (
                    <option key={repo.id} value={repo.id}>
                      {repo.display_name || repo.last_repo_root || repo.canonical_key}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="memory-form-summary">Summary</Label>
              <Input
                id="memory-form-summary"
                value={memoryForm.summary}
                onChange={(event) => setMemoryForm((current) => ({ ...current, summary: event.target.value }))}
                placeholder="Use DB advisory locks for scheduler singleton behavior"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="memory-form-content">Content</Label>
              <Textarea
                id="memory-form-content"
                value={memoryForm.content}
                onChange={(event) => setMemoryForm((current) => ({ ...current, content: event.target.value }))}
                placeholder="The control plane is horizontally scalable, so scheduler ownership must come from Postgres, not process-local timers."
                className="min-h-[180px]"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="memory-form-confidence">Confidence</Label>
              <Input
                id="memory-form-confidence"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={memoryForm.confidence}
                onChange={(event) => setMemoryForm((current) => ({ ...current, confidence: event.target.value }))}
              />
            </div>

            {createMemoryMutation.error && (
              <p className="text-sm text-destructive">
                {createMemoryMutation.error instanceof Error ? createMemoryMutation.error.message : 'Failed to create memory entry'}
              </p>
            )}

            <Button
              className="w-full"
              onClick={() => createMemoryMutation.mutate()}
              disabled={
                createMemoryMutation.isPending
                || !memoryForm.summary.trim()
                || !memoryForm.content.trim()
                || (memoryForm.scope_type === 'repo' && !memoryForm.repo_id)
              }
            >
              {createMemoryMutation.isPending ? 'Saving...' : 'Save Memory'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
