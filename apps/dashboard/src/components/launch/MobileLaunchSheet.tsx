'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, ChevronRight, Folder, Loader2, Play, Server, TerminalSquare, X } from 'lucide-react';
import type { LaunchTarget, MobileLaunchProvider } from '@agent-command/schema';
import { useLaunchTargets } from '@/hooks/useLaunchTargets';
import { launchAgent, openTmuxTarget } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { Button } from '@/components/ui/button';
import { MOBILE_LAUNCH_PROVIDERS, getLaunchProvider } from './definitions';
import {
  type RecentLaunch,
  useRecentLaunch,
  writeRecentLaunch,
} from './recentLaunchStore';

type LaunchMode = 'new' | 'existing';
export type LaunchSheetView = LaunchMode | 'recent';

interface MobileLaunchSheetProps {
  open: boolean;
  initialView?: LaunchSheetView;
  selectedHostId?: string;
  onClose: () => void;
  onLaunched?: () => void;
}

function projectLabel(path: string): string {
  return path.split('/').filter(Boolean).pop() || path;
}

function providerLabel(provider: MobileLaunchProvider): string {
  return getLaunchProvider(provider)?.shortName ?? provider;
}

function targetSupportsProvider(target: LaunchTarget | undefined, provider: MobileLaunchProvider): boolean {
  return Boolean(target?.providers[provider]);
}

export function MobileLaunchSheet({
  open,
  initialView = 'new',
  selectedHostId,
  onClose,
  onLaunched,
}: MobileLaunchSheetProps) {
  const router = useRouter();
  const defaultMobileLaunchProvider = useSettingsStore((state) => state.defaultMobileLaunchProvider);
  const defaultMobileLaunchHostId = useSettingsStore((state) => state.defaultMobileLaunchHostId);
  const defaultMobileLaunchTmuxTarget = useSettingsStore((state) => state.defaultMobileLaunchTmuxTarget);
  const setDefaultMobileLaunchProvider = useSettingsStore((state) => state.setDefaultMobileLaunchProvider);
  const setDefaultMobileLaunchHostId = useSettingsStore((state) => state.setDefaultMobileLaunchHostId);
  const setDefaultMobileLaunchTmuxTarget = useSettingsStore((state) => state.setDefaultMobileLaunchTmuxTarget);
  const { data, isLoading, error, refetch } = useLaunchTargets(open);
  const targets = useMemo(() => data?.targets ?? [], [data?.targets]);
  const [mode, setMode] = useState<LaunchMode>('new');
  const [hostId, setHostId] = useState('');
  const [provider, setProvider] = useState<MobileLaunchProvider>(defaultMobileLaunchProvider);
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [prompt, setPrompt] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tmuxTarget, setTmuxTarget] = useState('');
  const [existingTarget, setExistingTarget] = useState('');
  const lastLaunch = useRecentLaunch(open);
  const [openingExistingId, setOpeningExistingId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const selectedTarget = useMemo(
    () => targets.find((target) => target.host_id === hostId),
    [hostId, targets]
  );

  useEffect(() => {
    if (!open || !targets.length) return;
    const preferred =
      targets.find((target) => target.host_id === selectedHostId) ||
      targets.find((target) => target.host_id === defaultMobileLaunchHostId) ||
      targets.find((target) => target.online && target.supports_spawn) ||
      targets[0];
    setHostId(preferred.host_id);
  }, [defaultMobileLaunchHostId, open, selectedHostId, targets]);

  useEffect(() => {
    if (!open) return;
    setMode(initialView === 'existing' ? 'existing' : 'new');
    setProvider(defaultMobileLaunchProvider);
    setTmuxTarget(defaultMobileLaunchTmuxTarget || '');
  }, [defaultMobileLaunchProvider, defaultMobileLaunchTmuxTarget, initialView, open]);

  useEffect(() => {
    if (!selectedTarget) return;
    const firstProject = selectedTarget.recent_projects[0]?.path;
    const firstRoot = selectedTarget.roots[0];
    setWorkingDirectory((current) => current || firstProject || firstRoot || '');
  }, [selectedTarget]);

  useEffect(() => {
    if (!selectedTarget) return;
    if (targetSupportsProvider(selectedTarget, provider)) return;
    const fallback = selectedTarget.providers.codex ? 'codex' : 'claude_code';
    if (targetSupportsProvider(selectedTarget, fallback)) {
      setProvider(fallback);
    }
  }, [provider, selectedTarget]);

  const handleClose = useCallback(() => {
    if (launching) return;
    setLaunchError(null);
    onClose();
  }, [launching, onClose]);

  const handleLaunch = useCallback(async () => {
    if (!selectedTarget || !workingDirectory.trim()) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const response = await launchAgent({
        host_id: selectedTarget.host_id,
        provider,
        working_directory: workingDirectory.trim(),
        prompt: prompt.trim() || undefined,
        tmux: tmuxTarget.trim() ? { target_session: tmuxTarget.trim() } : undefined,
        wait: true,
        wait_timeout_ms: 10000,
      });
      const nextLastLaunch = {
        host_id: selectedTarget.host_id,
        provider,
        working_directory: workingDirectory.trim(),
        tmux_target: tmuxTarget.trim() || null,
      };
      writeRecentLaunch(nextLastLaunch);
      setDefaultMobileLaunchProvider(provider);
      setDefaultMobileLaunchHostId(selectedTarget.host_id);
      setDefaultMobileLaunchTmuxTarget(tmuxTarget.trim() || null);
      onLaunched?.();
      onClose();
      router.push(response.href);
    } catch (error) {
      setLaunchError((error as Error).message || 'Launch failed');
    } finally {
      setLaunching(false);
    }
  }, [
    onClose,
    onLaunched,
    prompt,
    provider,
    router,
    selectedTarget,
    setDefaultMobileLaunchHostId,
    setDefaultMobileLaunchProvider,
    setDefaultMobileLaunchTmuxTarget,
    tmuxTarget,
    workingDirectory,
  ]);

  const handleRepeatLaunch = useCallback(async (launch: RecentLaunch) => {
    const target = targets.find((candidate) => candidate.host_id === launch.host_id);
    if (!target) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const response = await launchAgent({
        host_id: target.host_id,
        provider: launch.provider,
        working_directory: launch.working_directory,
        tmux: launch.tmux_target ? { target_session: launch.tmux_target } : undefined,
        wait: true,
        wait_timeout_ms: 10000,
      });
      writeRecentLaunch(launch);
      onLaunched?.();
      setDefaultMobileLaunchProvider(launch.provider);
      setDefaultMobileLaunchHostId(target.host_id);
      setDefaultMobileLaunchTmuxTarget(launch.tmux_target || null);
      onClose();
      router.push(response.href);
    } catch (error) {
      setLaunchError((error as Error).message || 'Launch failed');
    } finally {
      setLaunching(false);
    }
  }, [
    onClose,
    onLaunched,
    router,
    setDefaultMobileLaunchHostId,
    setDefaultMobileLaunchProvider,
    setDefaultMobileLaunchTmuxTarget,
    targets,
  ]);

  const handleOpenExisting = useCallback(async (input: { tmuxTarget?: string | null; paneId?: string | null; key: string }) => {
    if (!selectedTarget) return;
    const tmuxTargetValue = input.tmuxTarget?.trim();
    const paneIdValue = input.paneId?.trim();
    if (!tmuxTargetValue && !paneIdValue) return;

    setOpeningExistingId(input.key);
    setLaunchError(null);
    try {
      const response = await openTmuxTarget({
        host_id: selectedTarget.host_id,
        tmux_target: tmuxTargetValue || undefined,
        pane_id: paneIdValue || undefined,
      });
      onLaunched?.();
      onClose();
      router.push(response.href);
    } catch (error) {
      setLaunchError((error as Error).message || 'Failed to open tmux pane');
    } finally {
      setOpeningExistingId(null);
    }
  }, [onClose, onLaunched, router, selectedTarget]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" aria-hidden="true" onClick={handleClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-launch-title"
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-hidden rounded-t-lg border bg-background shadow-xl',
          'lg:left-1/2 lg:top-1/2 lg:bottom-auto lg:max-w-xl lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-lg'
        )}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <div className="min-w-0">
              <h2 id="mobile-launch-title" className="text-sm font-semibold">
                {initialView === 'existing' ? 'Open existing' : initialView === 'recent' ? 'Recent launches' : 'Launch agent'}
              </h2>
              <div className="truncate text-xs text-muted-foreground">
                {selectedTarget?.alias || 'Choose a machine'}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="mobile-icon" onClick={handleClose} disabled={launching} aria-label="Close launch sheet">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-1 border-b bg-muted p-1">
          <button
            type="button"
            onClick={() => setMode('new')}
            className={cn(
              'flex h-10 items-center justify-center gap-2 rounded text-sm font-medium',
              mode === 'new' ? 'bg-background shadow-sm' : 'text-muted-foreground'
            )}
          >
            <Play className="h-4 w-4" />
            New
          </button>
          <button
            type="button"
            onClick={() => setMode('existing')}
            className={cn(
              'flex h-10 items-center justify-center gap-2 rounded text-sm font-medium',
              mode === 'existing' ? 'bg-background shadow-sm' : 'text-muted-foreground'
            )}
          >
            <TerminalSquare className="h-4 w-4" />
            Existing
          </button>
        </div>

        <div className="max-h-[calc(92dvh-9.5rem)] space-y-4 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading launch targets
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {(error as Error).message || 'Failed to load launch targets'}
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => void refetch()}>
                Retry
              </Button>
            </div>
          )}

          {!isLoading && !error && (
            <>
              {mode === 'new' && lastLaunch && targets.some((target) => target.host_id === lastLaunch.host_id) && (
                <button
                  type="button"
                  onClick={() => void handleRepeatLaunch(lastLaunch)}
                  disabled={launching}
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-left"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      Repeat {providerLabel(lastLaunch.provider)} in {projectLabel(lastLaunch.working_directory)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{lastLaunch.working_directory}</div>
                  </div>
                  {launching
                    ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </button>
              )}

              {mode === 'new' && selectedTarget?.recent_launches.length ? (
                <section className="space-y-2">
                  <div className="text-xs font-medium uppercase text-muted-foreground">Recent launches</div>
                  <div className="grid gap-2">
                    {selectedTarget.recent_launches.slice(0, 3).map((launch) => (
                      <button
                        key={launch.id}
                        type="button"
                        onClick={() => void handleRepeatLaunch({
                          host_id: launch.host_id,
                          provider: launch.provider,
                          working_directory: launch.working_directory,
                          tmux_target: launch.tmux_target || null,
                        })}
                        disabled={launching}
                        className="flex min-h-12 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {providerLabel(launch.provider)} in {projectLabel(launch.working_directory)}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{launch.working_directory}</div>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                  <Server className="h-3.5 w-3.5" />
                  Machine
                </div>
                <div className="-mx-4 overflow-x-auto px-4">
                  <div className="flex min-w-max gap-2">
                    {targets.map((target) => (
                      <button
                        key={target.host_id}
                        type="button"
                        onClick={() => {
                          setHostId(target.host_id);
                          setWorkingDirectory(target.recent_projects[0]?.path || target.roots[0] || '');
                          setTmuxTarget('');
                        }}
                        className={cn(
                          'inline-flex h-11 items-center gap-2 rounded-md border px-3 text-sm',
                          hostId === target.host_id ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'
                        )}
                      >
                        <span className={cn('h-2 w-2 rounded-full', target.online ? 'bg-green-500' : 'bg-gray-400')} />
                        <span className="font-medium">{target.alias}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              {mode === 'existing' ? (
                <section className="space-y-3">
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase text-muted-foreground">Open by target</div>
                    <div className="flex gap-2">
                      <input
                        value={existingTarget}
                        onChange={(event) => setExistingTarget(event.target.value)}
                        placeholder="agents:0.0 or %1"
                        className="h-11 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary"
                      />
                      <Button
                        size="mobile-sm"
                        disabled={!existingTarget.trim() || Boolean(openingExistingId)}
                        onClick={() => void handleOpenExisting({
                          tmuxTarget: existingTarget.startsWith('%') ? undefined : existingTarget,
                          paneId: existingTarget.startsWith('%') ? existingTarget : undefined,
                          key: 'manual',
                        })}
                      >
                        {openingExistingId === 'manual' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Open'}
                      </Button>
                    </div>
                  </div>

                  <div className="text-xs font-medium uppercase text-muted-foreground">Tracked panes</div>
                  {selectedTarget?.recent_tmux.length ? (
                    <div className="divide-y rounded-md border">
                      {selectedTarget.recent_tmux.map((session) => (
                        <button
                          key={session.session_id}
                          type="button"
                          disabled={Boolean(openingExistingId)}
                          onClick={() => void handleOpenExisting({
                            tmuxTarget: session.tmux_target,
                            paneId: session.pane_id,
                            key: session.session_id,
                          })}
                          className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{session.title || session.tmux_target || 'tmux pane'}</div>
                            <div className="truncate text-xs text-muted-foreground">{session.tmux_target || session.cwd || session.status}</div>
                          </div>
                          {openingExistingId === session.session_id
                            ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
                      No tracked tmux panes for this machine yet.
                    </div>
                  )}
                  {launchError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                      {launchError}
                    </div>
                  )}
                </section>
              ) : (
                <>
                  <section className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                      <Folder className="h-3.5 w-3.5" />
                      Project
                    </div>
                    {selectedTarget?.recent_projects.length ? (
                      <div className="grid gap-2">
                        {selectedTarget.recent_projects.slice(0, 4).map((project) => (
                          <button
                            key={project.path}
                            type="button"
                            onClick={() => setWorkingDirectory(project.path)}
                            className={cn(
                              'min-h-12 rounded-md border px-3 py-2 text-left',
                              workingDirectory === project.path ? 'border-primary bg-primary/10' : 'bg-background'
                            )}
                          >
                            <div className="truncate text-sm font-medium">{project.display_name || projectLabel(project.path)}</div>
                            <div className="truncate text-xs text-muted-foreground">{project.path}</div>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <input
                      value={workingDirectory}
                      onChange={(event) => setWorkingDirectory(event.target.value)}
                      placeholder={selectedTarget?.roots[0] || '/home/user/dev/project'}
                      className="h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary"
                    />
                  </section>

                  <section className="space-y-2">
                    <div className="text-xs font-medium uppercase text-muted-foreground">Agent</div>
                    <div className="grid grid-cols-2 gap-2">
                      {MOBILE_LAUNCH_PROVIDERS.map((providerOption) => {
                        const candidate = providerOption.id;
                        const supported = targetSupportsProvider(selectedTarget, candidate);
                        return (
                          <button
                            key={candidate}
                            type="button"
                            disabled={!supported}
                            onClick={() => setProvider(candidate)}
                            className={cn(
                              'h-11 rounded-md border text-sm font-medium disabled:opacity-40',
                              provider === candidate ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'
                            )}
                          >
                            {providerOption.shortName}
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="space-y-2">
                    <div className="text-xs font-medium uppercase text-muted-foreground">Prompt</div>
                    <textarea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      rows={4}
                      placeholder="Optional first instruction"
                      className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </section>

                  <section>
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((current) => !current)}
                      className="flex h-10 w-full items-center justify-between text-sm font-medium"
                    >
                      More options
                      <ChevronRight className={cn('h-4 w-4 transition-transform', advancedOpen && 'rotate-90')} />
                    </button>
                    {advancedOpen && (
                      <div className="space-y-2 pb-2">
                        <label className="text-xs font-medium uppercase text-muted-foreground" htmlFor="mobile-launch-tmux-target">
                          tmux session
                        </label>
                        <input
                          id="mobile-launch-tmux-target"
                          value={tmuxTarget}
                          onChange={(event) => setTmuxTarget(event.target.value)}
                          placeholder={projectLabel(workingDirectory) || 'agents'}
                          className="h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary"
                        />
                      </div>
                    )}
                  </section>

                  {launchError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                      {launchError}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {mode === 'new' && (
          <div className="border-t bg-background p-4">
            <Button
              size="mobile"
              className="w-full gap-2"
              disabled={!selectedTarget || !workingDirectory.trim() || launching || !targetSupportsProvider(selectedTarget, provider)}
              onClick={handleLaunch}
            >
              {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {launching ? 'Launching' : `Launch ${providerLabel(provider)}`}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
