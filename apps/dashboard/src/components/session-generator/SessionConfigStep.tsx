'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, Link as LinkIcon, FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getGroups, type SpawnProvider, type SessionLinkType } from '@/lib/api';
import { useSettingsStore, type SessionTemplate, type LinkType } from '@/stores/settings';
import { SESSION_TEMPLATES, TEMPLATE_OPTIONS, type SessionTemplateSession } from './templates';

const PROVIDERS: Array<{ id: SpawnProvider; name: string }> = [
  { id: 'claude_code', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'gemini_cli', name: 'Gemini CLI' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'aider', name: 'Aider' },
  { id: 'shell', name: 'Shell' },
];

export interface SessionConfig {
  provider: SpawnProvider;
  title: string;
  flags: string;
}

interface SessionConfigStepProps {
  repoName: string;
  gitBranch?: string;
  onConfigChange: (config: {
    sessions: SessionConfig[];
    groupId: string | null;
    autoLink: boolean;
    linkType: SessionLinkType;
    createGroup: boolean;
    groupName: string;
  }) => void;
}

export function SessionConfigStep({
  repoName,
  gitBranch,
  onConfigChange,
}: SessionConfigStepProps) {
  const {
    defaultSessionTemplate,
    defaultProvider,
    sessionNamingPattern,
    autoLinkSessions,
    defaultLinkType,
    autoCreateGroup,
  } = useSettingsStore();

  // Template selection
  const [selectedTemplate, setSelectedTemplate] = useState<SessionTemplate>(defaultSessionTemplate);

  // Session configs
  const [sessions, setSessions] = useState<SessionConfig[]>([]);

  // Group selection
  const [groupId, setGroupId] = useState<string | null>(null);
  const [createGroup, setCreateGroup] = useState(autoCreateGroup);
  const [groupName, setGroupName] = useState(repoName);

  // Link settings
  const [autoLink, setAutoLink] = useState(autoLinkSessions);
  const [linkType, setLinkType] = useState<LinkType>(defaultLinkType);

  // Fetch groups
  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
  });

  // Generate title based on naming pattern
  const generateTitle = useCallback((provider: SpawnProvider, suffix?: string): string => {
    let base = repoName;
    if (sessionNamingPattern === 'branch_name' && gitBranch) {
      base = gitBranch;
    } else if (sessionNamingPattern === 'repo_branch' && gitBranch) {
      base = `${repoName}-${gitBranch}`;
    }
    return suffix ? `${base}-${suffix}` : base;
  }, [repoName, sessionNamingPattern, gitBranch]);

  // Initialize sessions from template
  useEffect(() => {
    const template = SESSION_TEMPLATES[selectedTemplate];
    if (template) {
      const newSessions = template.sessions.map((s: SessionTemplateSession) => ({
        provider: selectedTemplate === 'single' ? defaultProvider : s.provider,
        title: generateTitle(s.provider, s.titleSuffix),
        flags: '',
      }));
      setSessions(newSessions);

      // Update link settings from template
      if (template.autoLink !== undefined) {
        setAutoLink(template.autoLink && autoLinkSessions);
      }
      if (template.linkType) {
        setLinkType(template.linkType as LinkType);
      }
    }
  }, [selectedTemplate, defaultProvider, autoLinkSessions, generateTitle]);

  // Update group name when repo name changes
  useEffect(() => {
    setGroupName(repoName);
  }, [repoName]);

  // Notify parent of config changes
  useEffect(() => {
    onConfigChange({
      sessions,
      groupId: createGroup ? null : groupId,
      autoLink: sessions.length > 1 && autoLink,
      linkType: linkType as SessionLinkType,
      createGroup: sessions.length > 1 && createGroup,
      groupName,
    });
  }, [sessions, groupId, autoLink, linkType, createGroup, groupName, onConfigChange]);

  // Update a single session
  const updateSession = (index: number, updates: Partial<SessionConfig>) => {
    setSessions((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...updates } : s))
    );
  };

  const template = SESSION_TEMPLATES[selectedTemplate];
  const showLinkSettings = sessions.length > 1;
  const showGroupSettings = sessions.length > 1;

  return (
    <div className="space-y-6">
      {/* Template selection */}
      <div>
        <Label className="text-sm font-medium mb-3 block">Session Template</Label>
        <div className="grid grid-cols-3 gap-3">
          {TEMPLATE_OPTIONS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedTemplate(t.id as SessionTemplate)}
              className={cn(
                'p-3 border rounded-lg text-left transition-colors',
                selectedTemplate === t.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50'
              )}
            >
              <div className="font-medium text-sm">{t.name}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {t.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Session configs */}
      <div>
        <Label className="text-sm font-medium mb-3 block">
          <Layers className="h-3.5 w-3.5 inline mr-1" />
          Sessions ({sessions.length})
        </Label>
        <div className="space-y-3">
          {sessions.map((session, idx) => (
            <div key={idx} className="p-3 border rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Session {idx + 1}</span>
                {selectedTemplate === 'single' && (
                  <select
                    value={session.provider}
                    onChange={(e) =>
                      updateSession(idx, { provider: e.target.value as SpawnProvider })
                    }
                    className="text-sm px-2 py-1 border rounded bg-background"
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
                {selectedTemplate !== 'single' && (
                  <span className="text-sm text-muted-foreground">
                    {PROVIDERS.find((p) => p.id === session.provider)?.name}
                  </span>
                )}
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={session.title}
                  onChange={(e) => updateSession(idx, { title: e.target.value })}
                  className="w-full px-3 py-1.5 border rounded-md bg-background text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Flags (optional)
                </label>
                <input
                  type="text"
                  value={session.flags}
                  onChange={(e) => updateSession(idx, { flags: e.target.value })}
                  placeholder="--model sonnet"
                  className="w-full px-3 py-1.5 border rounded-md bg-background text-sm font-mono"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Link settings */}
      {showLinkSettings && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="auto-link" className="cursor-pointer">
                Auto-link sessions
              </Label>
            </div>
            <Switch
              id="auto-link"
              checked={autoLink}
              onCheckedChange={setAutoLink}
            />
          </div>

          {autoLink && (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Link Type
              </label>
              <select
                value={linkType}
                onChange={(e) => setLinkType(e.target.value as LinkType)}
                className="w-full px-3 py-1.5 border rounded-md bg-background text-sm"
              >
                <option value="complement">Complement (working together)</option>
                <option value="review">Review (reviewing each other)</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* Group settings */}
      {showGroupSettings && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderPlus className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="create-group" className="cursor-pointer">
                Create new group
              </Label>
            </div>
            <Switch
              id="create-group"
              checked={createGroup}
              onCheckedChange={setCreateGroup}
            />
          </div>

          {createGroup ? (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Group Name
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full px-3 py-1.5 border rounded-md bg-background text-sm"
              />
            </div>
          ) : (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Add to existing group
              </label>
              <select
                value={groupId || ''}
                onChange={(e) => setGroupId(e.target.value || null)}
                className="w-full px-3 py-1.5 border rounded-md bg-background text-sm"
              >
                <option value="">No group</option>
                {groupsData?.flat.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
