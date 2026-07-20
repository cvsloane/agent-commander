'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Bot,
  Command as CommandIcon,
  Loader2,
  Map as MapIcon,
  MoonStar,
  Route,
  Server,
  Settings,
  Terminal,
  X,
} from 'lucide-react';
import type { Host, SessionWithSnapshot } from '@agent-command/schema';
import { MobileLaunchSheet } from '@/components/launch/MobileLaunchSheet';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandHeading,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { getAllSessions, getHosts } from '@/lib/api';
import { cn } from '@/lib/utils';
import { applyTheme, useThemeStore } from '@/stores/theme';

const OPEN_COMMAND_PALETTE_EVENT = 'agent-command:open-command-palette';

type PaletteGroup = 'Commands' | 'Routes' | 'Sessions' | 'Hosts';

interface PaletteAction {
  id: string;
  group: PaletteGroup;
  label: string;
  detail?: string;
  keywords: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  shortcut?: string;
  run: () => void;
}

const ROUTES = [
  { label: 'Overview', href: '/', keywords: 'dashboard home', icon: MapIcon },
  { label: 'Sessions', href: '/sessions', keywords: 'agents work terminal', icon: Terminal },
  { label: 'Hosts', href: '/hosts', keywords: 'machines servers enroll', icon: Server },
  { label: 'Memory', href: '/memory', keywords: 'knowledge notes', icon: Bot },
  { label: 'Automation', href: '/automation', keywords: 'scheduled agents runs', icon: Route },
  { label: 'Settings', href: '/settings', keywords: 'preferences configuration', icon: Settings },
] as const;

function normalize(value: string): string {
  return value.toLocaleLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Scores token and subsequence matches without requiring a fuzzy-search dependency.
 * Higher scores sort first; -1 means the candidate does not match.
 */
export function fuzzyScore(query: string, candidate: string): number {
  const normalizedQuery = normalize(query);
  const normalizedCandidate = normalize(candidate);
  if (!normalizedQuery) return 0;

  const directIndex = normalizedCandidate.indexOf(normalizedQuery);
  if (directIndex >= 0) {
    return 1_000 - directIndex * 2 - Math.max(0, normalizedCandidate.length - normalizedQuery.length);
  }

  let candidateIndex = 0;
  let firstMatch = -1;
  let previousMatch = -2;
  let consecutive = 0;

  for (const character of normalizedQuery) {
    const matchIndex = normalizedCandidate.indexOf(character, candidateIndex);
    if (matchIndex < 0) return -1;
    if (firstMatch < 0) firstMatch = matchIndex;
    if (matchIndex === previousMatch + 1) consecutive += 1;
    previousMatch = matchIndex;
    candidateIndex = matchIndex + 1;
  }

  return 200 + consecutive * 12 - firstMatch * 2 - (candidateIndex - normalizedQuery.length);
}

export function openCommandPalette(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
  }
}

function sessionLabel(session: SessionWithSnapshot): string {
  return session.title || session.cwd?.split('/').filter(Boolean).pop() || 'Untitled session';
}

function hostLabel(host: Host): string {
  return host.name || host.tailscale_name || 'Unnamed host';
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function GlobalCommandPalette() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [isOpen, setIsOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sessionsQuery = useQuery({
    queryKey: ['command-palette', 'sessions'],
    queryFn: () => getAllSessions({ include_archived: true }),
    enabled: isOpen,
    staleTime: 30_000,
  });
  const hostsQuery = useQuery({
    queryKey: ['command-palette', 'hosts'],
    queryFn: getHosts,
    enabled: isOpen,
    staleTime: 30_000,
  });

  const close = useCallback(() => setIsOpen(false), []);
  const navigate = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router]
  );

  useEffect(() => {
    const open = () => setIsOpen(true);
    const handleKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.key.toLocaleLowerCase() === 'k' && (event.metaKey || event.ctrlKey);
      const searchKey = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!commandKey && (!searchKey || isEditableTarget(event.target))) return;
      event.preventDefault();
      setIsOpen((current) => (commandKey ? !current : true));
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, open);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, open);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setSelectedIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  const hosts = useMemo(() => hostsQuery.data?.hosts ?? [], [hostsQuery.data?.hosts]);
  const hostsById = useMemo(() => new Map(hosts.map((host) => [host.id, host])), [hosts]);

  const actions = useMemo<PaletteAction[]>(() => {
    const openLaunch = () => {
      close();
      setLaunchOpen(true);
    };
    const toggleTheme = () => {
      const nextTheme = theme === 'dark' ? 'light' : 'dark';
      setTheme(nextTheme);
      applyTheme(nextTheme);
      close();
    };
    const commandActions: PaletteAction[] = [
      {
        id: 'command-launch',
        group: 'Commands',
        label: 'Launch a new session',
        detail: 'Open the quick launch sheet',
        keywords: 'new create start agent session launch',
        icon: CommandIcon,
        shortcut: 'L',
        run: openLaunch,
      },
      {
        id: 'command-theme',
        group: 'Commands',
        label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
        detail: `Current theme: ${theme}`,
        keywords: 'appearance color light dark theme toggle',
        icon: MoonStar,
        run: toggleTheme,
      },
    ];
    const routeActions: PaletteAction[] = ROUTES.map((route) => ({
      id: `route-${route.href}`,
      group: 'Routes',
      label: route.label,
      detail: route.href,
      keywords: `${route.label} ${route.keywords}`,
      icon: route.icon,
      run: () => navigate(route.href),
    }));
    const sessionActions: PaletteAction[] = (sessionsQuery.data?.sessions ?? []).map((session) => {
      const host = hostsById.get(session.host_id);
      const hostName = host ? hostLabel(host) : session.host_id;
      const label = sessionLabel(session);
      return {
        id: `session-${session.id}`,
        group: 'Sessions',
        label,
        detail: `${hostName} · ${session.provider}`,
        keywords: `${label} ${hostName} ${host?.tailscale_name ?? ''} ${session.cwd ?? ''} ${session.provider}`,
        icon: Terminal,
        run: () => navigate(`/sessions/${session.id}`),
      };
    });
    const hostActions: PaletteAction[] = hosts.map((host) => {
      const label = hostLabel(host);
      return {
        id: `host-${host.id}`,
        group: 'Hosts',
        label,
        detail: host.tailscale_name || 'View this host’s sessions',
        keywords: `${label} ${host.tailscale_name ?? ''} ${host.tailscale_ip ?? ''} machine server`,
        icon: Server,
        run: () => navigate(`/sessions?view=all&host_id=${encodeURIComponent(host.id)}`),
      };
    });

    return [...commandActions, ...routeActions, ...sessionActions, ...hostActions];
  }, [close, hosts, hostsById, navigate, sessionsQuery.data?.sessions, setTheme, theme]);

  const visibleActions = useMemo(() => {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) {
      const stableActions = actions.filter(
        (action) => action.group === 'Commands' || action.group === 'Routes'
      );
      const recentSessions = actions.filter((action) => action.group === 'Sessions').slice(0, 5);
      return [...stableActions, ...recentSessions];
    }

    return actions
      .map((action) => ({ action, score: fuzzyScore(normalizedQuery, `${action.label} ${action.keywords}`) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.action.label.localeCompare(b.action.label))
      .slice(0, 30)
      .map((entry) => entry.action);
  }, [actions, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex < visibleActions.length) return;
    setSelectedIndex(Math.max(0, visibleActions.length - 1));
  }, [selectedIndex, visibleActions.length]);

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>(
      `[data-palette-index="${selectedIndex}"]`
    );
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((current) => Math.min(current + 1, visibleActions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      visibleActions[selectedIndex]?.run();
    }
  };

  const isLoading = sessionsQuery.isLoading || hostsQuery.isLoading;
  const groups: PaletteGroup[] = ['Commands', 'Routes', 'Sessions', 'Hosts'];
  const groupedActions = groups
    .map((group) => ({
      group,
      actions: visibleActions.filter((action) => action.group === group),
    }))
    .filter((entry) => entry.actions.length > 0);

  return (
    <>
      <CommandDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        title="Command Center"
        description="Jump to a session or host, navigate, launch work, or change the theme."
      >
        <div className="relative pr-12">
          <CommandInput
            ref={inputRef}
            role="combobox"
            aria-controls="global-command-results"
            aria-expanded={isOpen}
            aria-activedescendant={visibleActions[selectedIndex]?.id}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            loading={isLoading}
            placeholder="Jump to a session, host, or command…"
          />
          <button
            type="button"
            onClick={close}
            className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close command palette"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <X className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <CommandList id="global-command-results" ref={listRef} aria-label="Command results">
          {visibleActions.length === 0 && !isLoading && (
            <CommandEmpty>No sessions, hosts, or commands match “{query}”.</CommandEmpty>
          )}
          {groupedActions.map(({ group, actions: groupActions }, groupIndex) => (
              <div key={group}>
                {groupIndex > 0 && <CommandSeparator />}
                <CommandGroup aria-label={group}>
                  <CommandHeading>{group}</CommandHeading>
                  {groupActions.map((action) => {
                    const index = visibleActions.indexOf(action);
                    const Icon = action.icon;
                    return (
                      <CommandItem
                        key={action.id}
                        id={action.id}
                        data-palette-index={index}
                        aria-selected={index === selectedIndex}
                        className={cn('gap-3 px-3', index === selectedIndex && 'bg-accent')}
                        onClick={action.run}
                        onMouseEnter={() => setSelectedIndex(index)}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{action.label}</span>
                          {action.detail && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {action.detail}
                            </span>
                          )}
                        </span>
                        {action.shortcut && <CommandShortcut>{action.shortcut}</CommandShortcut>}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </div>
          ))}
        </CommandList>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>
            <kbd className="rounded border bg-background px-1.5 py-0.5">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="rounded border bg-background px-1.5 py-0.5">Enter</kbd> open
          </span>
          <span className="hidden sm:inline">Ctrl/⌘ K anywhere</span>
        </div>
      </CommandDialog>

      <MobileLaunchSheet
        open={launchOpen}
        initialView="new"
        onClose={() => setLaunchOpen(false)}
        onLaunched={() => void queryClient.invalidateQueries({ queryKey: ['sessions'] })}
      />
    </>
  );
}
