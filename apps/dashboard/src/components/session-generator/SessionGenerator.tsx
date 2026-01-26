'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Play, ChevronLeft, ChevronRight, FolderGit, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  spawnSession,
  createSessionLink,
  ensureGroup,
  type DirectoryEntry,
  type SpawnProvider,
  type SessionLinkType,
} from '@/lib/api';
import { RepoPicker } from './RepoPicker';
import { SessionConfigStep, type SessionConfig } from './SessionConfigStep';

interface SessionGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
  defaultHostId?: string;
  onOpenSettings?: () => void;
}

type Step = 'pick-repo' | 'configure' | 'spawn';

interface SpawnConfig {
  sessions: SessionConfig[];
  groupId: string | null;
  autoLink: boolean;
  linkType: SessionLinkType;
  createGroup: boolean;
  groupName: string;
}

export function SessionGenerator({
  isOpen,
  onClose,
  defaultHostId,
  onOpenSettings,
}: SessionGeneratorProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const modalRef = useRef<HTMLDivElement>(null);

  // Step state
  const [step, setStep] = useState<Step>('pick-repo');

  // Selected repo
  const [selectedHostId, setSelectedHostId] = useState<string>(defaultHostId || '');
  const [selectedRepo, setSelectedRepo] = useState<DirectoryEntry | null>(null);

  // Spawn config
  const [spawnConfig, setSpawnConfig] = useState<SpawnConfig>({
    sessions: [],
    groupId: null,
    autoLink: false,
    linkType: 'complement',
    createGroup: false,
    groupName: '',
  });

  // Spawn state
  const [spawnProgress, setSpawnProgress] = useState<{
    status: 'idle' | 'spawning' | 'linking' | 'done' | 'error';
    current: number;
    total: number;
    sessionIds: string[];
    error?: string;
  }>({ status: 'idle', current: 0, total: 0, sessionIds: [] });

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('pick-repo');
      setSelectedHostId(defaultHostId || '');
      setSelectedRepo(null);
      setSpawnProgress({ status: 'idle', current: 0, total: 0, sessionIds: [] });
    }
  }, [isOpen, defaultHostId]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Handle repo selection
  const handleSelectRepo = useCallback((hostId: string, entry: DirectoryEntry) => {
    setSelectedHostId(hostId);
    setSelectedRepo(entry);
  }, []);

  // Handle config change
  const handleConfigChange = useCallback((config: SpawnConfig) => {
    setSpawnConfig(config);
  }, []);

  // Spawn sessions
  const handleSpawn = async () => {
    if (!selectedHostId || !selectedRepo || spawnConfig.sessions.length === 0) return;

    setStep('spawn');
    const total = spawnConfig.sessions.length;
    const sessionIds: string[] = [];

    try {
      // Create group first if needed
      let groupId = spawnConfig.groupId;
      if (spawnConfig.createGroup && spawnConfig.groupName) {
        setSpawnProgress({ status: 'spawning', current: 0, total, sessionIds, error: undefined });
        const groupResult = await ensureGroup({ name: spawnConfig.groupName });
        groupId = groupResult.group.id;
      }

      // Spawn each session
      for (let i = 0; i < spawnConfig.sessions.length; i++) {
        const session = spawnConfig.sessions[i];
        setSpawnProgress({
          status: 'spawning',
          current: i + 1,
          total,
          sessionIds,
          error: undefined,
        });

        const flagsArray = session.flags
          .split(/\s+/)
          .map((f) => f.trim())
          .filter(Boolean);

        const windowName = session.title?.trim() || session.provider;
        const targetSession = selectedRepo.name?.trim()
          || selectedRepo.path.split('/').filter(Boolean).pop()
          || undefined;
        const result = await spawnSession({
          host_id: selectedHostId,
          provider: session.provider,
          working_directory: selectedRepo.path,
          title: session.title || undefined,
          flags: flagsArray.length > 0 ? flagsArray : undefined,
          group_id: groupId || undefined,
          tmux: {
            target_session: targetSession,
            window_name: windowName,
          },
        });

        sessionIds.push(result.session.id);
      }

      // Create links between sessions if configured
      if (spawnConfig.autoLink && sessionIds.length > 1) {
        setSpawnProgress({
          status: 'linking',
          current: total,
          total,
          sessionIds,
          error: undefined,
        });

        // Link all sessions to each other
        for (let i = 0; i < sessionIds.length; i++) {
          for (let j = i + 1; j < sessionIds.length; j++) {
            await createSessionLink(sessionIds[i], sessionIds[j], spawnConfig.linkType);
          }
        }
      }

      setSpawnProgress({
        status: 'done',
        current: total,
        total,
        sessionIds,
        error: undefined,
      });

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });

      // Navigate to first session after a short delay
      setTimeout(() => {
        onClose();
        if (sessionIds.length === 1) {
          router.push(`/sessions/${sessionIds[0]}`);
        } else if (groupId) {
          router.push(`/sessions?group_id=${encodeURIComponent(groupId)}`);
        } else {
          router.push(`/sessions/${sessionIds[0]}`);
        }
      }, 1000);
    } catch (error) {
      setSpawnProgress((prev) => ({
        ...prev,
        status: 'error',
        error: (error as Error).message,
      }));
    }
  };

  // Step navigation
  const canGoNext = step === 'pick-repo' && selectedRepo !== null;
  const canGoBack = step === 'configure';

  const handleNext = () => {
    if (step === 'pick-repo' && selectedRepo) {
      setStep('configure');
    }
  };

  const handleBack = () => {
    if (step === 'configure') {
      setStep('pick-repo');
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="generator-title"
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'w-full max-w-2xl max-h-[80vh]',
          'bg-background border rounded-lg shadow-xl',
          'flex flex-col',
          'animate-in fade-in-0 zoom-in-95 duration-200'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            <Play className="h-5 w-5 text-primary" />
            <h2 id="generator-title" className="font-semibold">
              {step === 'pick-repo' && 'Pick Repository'}
              {step === 'configure' && 'Configure Sessions'}
              {step === 'spawn' && 'Spawning Sessions'}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
            disabled={spawnProgress.status === 'spawning' || spawnProgress.status === 'linking'}
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {/* Step 1: Pick Repository */}
          {step === 'pick-repo' && (
            <div className="h-[400px] flex flex-col">
              <RepoPicker
                onSelectRepo={handleSelectRepo}
                selectedHostId={selectedHostId}
                selectedPath={selectedRepo?.path}
                onOpenSettings={onOpenSettings}
              />
            </div>
          )}

          {/* Step 2: Configure Sessions */}
          {step === 'configure' && selectedRepo && (
            <div className="p-4 overflow-y-auto max-h-[400px]">
              {/* Selected repo info */}
              <div className="mb-4 p-3 bg-accent/50 rounded-lg flex items-center gap-2">
                <FolderGit className="h-5 w-5 text-orange-500" />
                <div>
                  <div className="font-medium">{selectedRepo.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {selectedRepo.path}
                    {selectedRepo.git_branch && (
                      <span className="ml-2 text-primary">({selectedRepo.git_branch})</span>
                    )}
                  </div>
                </div>
              </div>

              <SessionConfigStep
                repoName={selectedRepo.name}
                gitBranch={selectedRepo.git_branch}
                onConfigChange={handleConfigChange}
              />
            </div>
          )}

          {/* Step 3: Spawn Progress */}
          {step === 'spawn' && (
            <div className="p-8 flex flex-col items-center justify-center h-[400px]">
              {spawnProgress.status === 'spawning' && (
                <>
                  <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                  <div className="text-lg font-medium mb-2">
                    Spawning session {spawnProgress.current} of {spawnProgress.total}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {spawnConfig.sessions[spawnProgress.current - 1]?.title || 'Session'}
                  </div>
                </>
              )}

              {spawnProgress.status === 'linking' && (
                <>
                  <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                  <div className="text-lg font-medium">Linking sessions...</div>
                </>
              )}

              {spawnProgress.status === 'done' && (
                <>
                  <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
                    <Check className="h-6 w-6 text-green-500" />
                  </div>
                  <div className="text-lg font-medium">
                    {spawnProgress.total === 1 ? 'Session created!' : 'Sessions created!'}
                  </div>
                  <div className="text-sm text-muted-foreground">Redirecting...</div>
                </>
              )}

              {spawnProgress.status === 'error' && (
                <>
                  <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                    <X className="h-6 w-6 text-destructive" />
                  </div>
                  <div className="text-lg font-medium text-destructive">Error</div>
                  <div className="text-sm text-muted-foreground mt-2">
                    {spawnProgress.error}
                  </div>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => {
                      setStep('configure');
                      setSpawnProgress({ status: 'idle', current: 0, total: 0, sessionIds: [] });
                    }}
                  >
                    Try Again
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 'spawn' && (
          <div className="flex items-center justify-between px-4 py-3 border-t flex-shrink-0">
            <div>
              {canGoBack && (
                <Button variant="ghost" onClick={handleBack}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              {step === 'pick-repo' && (
                <Button onClick={handleNext} disabled={!canGoNext}>
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              )}
              {step === 'configure' && (
                <Button
                  onClick={handleSpawn}
                  disabled={spawnConfig.sessions.length === 0}
                >
                  <Play className="h-4 w-4 mr-1" />
                  Spawn {spawnConfig.sessions.length > 1 ? `${spawnConfig.sessions.length} Sessions` : 'Session'}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
