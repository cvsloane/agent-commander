'use client';

import { Play } from 'lucide-react';
import type { SpawnProvider } from '@/lib/api';
import { type SessionTemplate, useSettingsStore } from '@/stores/settings';
import { Label } from '@/components/ui/label';

const selectClassName =
  'h-11 w-full rounded-md border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function LaunchPanel() {
  const defaultProvider = useSettingsStore((state) => state.defaultProvider);
  const setDefaultProvider = useSettingsStore((state) => state.setDefaultProvider);
  const defaultSessionTemplate = useSettingsStore((state) => state.defaultSessionTemplate);
  const setDefaultSessionTemplate = useSettingsStore((state) => state.setDefaultSessionTemplate);

  return (
    <section className="space-y-4" aria-labelledby="launch-settings-title">
      <h2
        id="launch-settings-title"
        className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground"
      >
        <Play className="h-4 w-4" aria-hidden="true" />
        Launch
      </h2>
      <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="default-provider">Default provider</Label>
          <select
            id="default-provider"
            value={defaultProvider}
            onChange={(event) => setDefaultProvider(event.target.value as SpawnProvider)}
            className={selectClassName}
          >
            <option value="claude_code">Claude Code</option>
            <option value="codex">Codex</option>
            <option value="gemini_cli">Gemini CLI</option>
            <option value="opencode">OpenCode</option>
            <option value="aider">Aider</option>
            <option value="shell">Shell</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="default-session-template">Default template</Label>
          <select
            id="default-session-template"
            value={defaultSessionTemplate}
            onChange={(event) => setDefaultSessionTemplate(event.target.value as SessionTemplate)}
            className={selectClassName}
          >
            <option value="single">Single Session</option>
            <option value="claude_codex">Claude + Codex</option>
            <option value="full_dev">Full Dev Setup</option>
          </select>
        </div>
      </div>
    </section>
  );
}
