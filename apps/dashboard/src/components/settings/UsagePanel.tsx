'use client';

import { useSettingsStore } from '@/stores/settings';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const PROVIDERS = [
  { id: 'claude_code', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini_cli', label: 'Gemini' },
  { id: 'opencode', label: 'OpenCode' },
] as const;

export function UsagePanel() {
  const visibleProviders = useSettingsStore((state) => state.visibleProviders);
  const setProviderVisibility = useSettingsStore((state) => state.setProviderVisibility);

  return (
    <section className="space-y-4" aria-labelledby="usage-settings-title">
      <h2
        id="usage-settings-title"
        className="text-sm font-medium uppercase tracking-wider text-muted-foreground"
      >
        Usage
      </h2>
      <div className="space-y-1 rounded-lg border p-4">
        <p className="pb-2 text-xs text-muted-foreground">
          Choose which providers appear in dashboard usage summaries.
        </p>
        {PROVIDERS.map((provider) => {
          const id = `show-${provider.id}`;
          return (
            <div key={provider.id} className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor={id}>{provider.label}</Label>
              <Switch
                id={id}
                checked={visibleProviders[provider.id]}
                onCheckedChange={(checked) => setProviderVisibility(provider.id, checked)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
