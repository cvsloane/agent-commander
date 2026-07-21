'use client';

import { useEffect, useState } from 'react';
import { Link as LinkIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  type LinkType,
  type SessionNamingPattern,
  useSettingsStore,
} from '@/stores/settings';
import {
  parseTerminalRailConfig,
  type TerminalRailPreset,
} from '@/components/mobile/terminalRailConfig';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getHosts } from '@/lib/api';
import { DEFAULT_TMUX_PREFIX, isValidTmuxPrefix } from '@/lib/tmuxKeys';

const selectClassName =
  'h-11 w-full rounded-md border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function SessionDefaultsPanel() {
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const setTerminalFontSize = useSettingsStore((state) => state.setTerminalFontSize);
  const terminalRailPreset = useSettingsStore((state) => state.terminalRailPreset);
  const setTerminalRailPreset = useSettingsStore((state) => state.setTerminalRailPreset);
  const terminalRailConfig = useSettingsStore((state) => state.terminalRailConfig);
  const setTerminalRailConfig = useSettingsStore((state) => state.setTerminalRailConfig);
  const tmuxPrefixByHost = useSettingsStore((state) => state.tmuxPrefixByHost);
  const setTmuxPrefixForHost = useSettingsStore((state) => state.setTmuxPrefixForHost);
  const sessionNamingPattern = useSettingsStore((state) => state.sessionNamingPattern);
  const setSessionNamingPattern = useSettingsStore((state) => state.setSessionNamingPattern);
  const autoCreateGroup = useSettingsStore((state) => state.autoCreateGroup);
  const setAutoCreateGroup = useSettingsStore((state) => state.setAutoCreateGroup);
  const autoLinkSessions = useSettingsStore((state) => state.autoLinkSessions);
  const setAutoLinkSessions = useSettingsStore((state) => state.setAutoLinkSessions);
  const defaultLinkType = useSettingsStore((state) => state.defaultLinkType);
  const setDefaultLinkType = useSettingsStore((state) => state.setDefaultLinkType);
  const [railJson, setRailJson] = useState(() => JSON.stringify(terminalRailConfig, null, 2));
  const [railJsonError, setRailJsonError] = useState<string | null>(null);
  const { data: hostsData, isLoading: hostsLoading, isError: hostsError } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
    staleTime: 30_000,
  });

  useEffect(() => {
    setRailJson(JSON.stringify(terminalRailConfig, null, 2));
    setRailJsonError(null);
  }, [terminalRailConfig]);

  const applyRailJson = () => {
    try {
      setTerminalRailConfig(parseTerminalRailConfig(JSON.parse(railJson)));
      setRailJsonError(null);
    } catch (error) {
      setRailJsonError(error instanceof Error ? error.message : 'Rail config is invalid.');
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="session-defaults-title">
      <h2
        id="session-defaults-title"
        className="text-sm font-medium uppercase tracking-wider text-muted-foreground"
      >
        Session defaults
      </h2>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border p-4">
          <h3 className="font-medium">New sessions</h3>
          <div className="space-y-2">
            <Label htmlFor="session-naming-pattern">Naming pattern</Label>
            <select
              id="session-naming-pattern"
              value={sessionNamingPattern}
              onChange={(event) =>
                setSessionNamingPattern(event.target.value as SessionNamingPattern)
              }
              className={selectClassName}
            >
              <option value="repo_name">Repository Name</option>
              <option value="branch_name">Branch Name</option>
              <option value="repo_branch">Repo + Branch</option>
            </select>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Label htmlFor="auto-link-sessions">Auto-link sessions</Label>
            </div>
            <Switch
              id="auto-link-sessions"
              checked={autoLinkSessions}
              onCheckedChange={setAutoLinkSessions}
            />
          </div>
          {autoLinkSessions && (
            <div className="space-y-2">
              <Label htmlFor="default-link-type">Default link type</Label>
              <select
                id="default-link-type"
                value={defaultLinkType}
                onChange={(event) => setDefaultLinkType(event.target.value as LinkType)}
                className={selectClassName}
              >
                <option value="complement">Complement</option>
                <option value="review">Review</option>
              </select>
            </div>
          )}
          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor="auto-create-group">Auto-create group for multi-session launches</Label>
            <Switch
              id="auto-create-group"
              checked={autoCreateGroup}
              onCheckedChange={setAutoCreateGroup}
            />
          </div>
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="terminal-font-size">Terminal font size</Label>
              <output htmlFor="terminal-font-size" className="text-sm font-medium tabular-nums">
                {terminalFontSize}px
              </output>
            </div>
            <input
              id="terminal-font-size"
              type="range"
              min={TERMINAL_FONT_SIZE_MIN}
              max={TERMINAL_FONT_SIZE_MAX}
              step={1}
              value={terminalFontSize}
              onChange={(event) => setTerminalFontSize(Number(event.target.value))}
              className="h-11 w-full cursor-pointer accent-primary"
            />
            <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
              <span>Pinch with two fingers on the terminal to adjust live.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={() => setTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE)}
              >
                Reset to 14px
              </Button>
            </div>
          </div>

          <div className="border-t" />

          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">Terminal key rail</h3>
              <p className="text-xs text-muted-foreground">
                JSON-defined keysyms, chords, macros, and swipe-up popup bindings.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="terminal-rail-preset">Preset</Label>
            <select
              id="terminal-rail-preset"
              value={terminalRailPreset}
              onChange={(event) => setTerminalRailPreset(event.target.value as TerminalRailPreset)}
              className={selectClassName}
            >
              <option value="minimal">Minimal — Esc, Ctrl, arrows</option>
              <option value="expanded">Expanded — Tab, prefix, History, macros</option>
              {terminalRailPreset === 'custom' && <option value="custom">Custom JSON</option>}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="terminal-rail-json">Rail JSON</Label>
            <textarea
              id="terminal-rail-json"
              value={railJson}
              onChange={(event) => setRailJson(event.target.value)}
              rows={10}
              spellCheck={false}
              aria-invalid={Boolean(railJsonError)}
              aria-describedby={railJsonError ? 'terminal-rail-json-error' : 'terminal-rail-json-help'}
              className="w-full resize-y rounded-md border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p id="terminal-rail-json-help" className="text-xs text-muted-foreground">
              Swipe up runs a key&apos;s optional popup binding. Macro values are sent verbatim.
            </p>
            {railJsonError && (
              <p id="terminal-rail-json-error" role="alert" className="text-xs text-destructive">
                {railJsonError}
              </p>
            )}
            <Button type="button" variant="outline" size="mobile" onClick={applyRailJson}>
              Apply custom rail
            </Button>
          </div>

          <div className="border-t" />

          <div className="space-y-3">
            <div>
              <h3 className="font-medium">Per-host tmux prefix</h3>
              <p className="text-xs text-muted-foreground">
                Use tmux notation such as C-b or C-a. Prefix keys and prefix chords use this value.
              </p>
            </div>
            {hostsLoading && <p role="status" className="text-xs text-muted-foreground">Loading hosts…</p>}
            {hostsError && <p role="alert" className="text-xs text-destructive">Hosts could not be loaded.</p>}
            {hostsData?.hosts.map((host) => {
              const value = tmuxPrefixByHost[host.id] ?? DEFAULT_TMUX_PREFIX;
              const valid = isValidTmuxPrefix(value);
              return (
                <div key={host.id} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3">
                  <Label htmlFor={`tmux-prefix-${host.id}`} className="truncate">{host.name}</Label>
                  <input
                    id={`tmux-prefix-${host.id}`}
                    value={value}
                    onChange={(event) => setTmuxPrefixForHost(host.id, event.target.value)}
                    aria-invalid={!valid}
                    className="h-11 rounded-md border bg-background px-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {!valid && (
                    <p role="alert" className="col-span-2 text-xs text-destructive">
                      {host.name} needs Ctrl notation such as C-b, or Alt notation such as M-a.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
