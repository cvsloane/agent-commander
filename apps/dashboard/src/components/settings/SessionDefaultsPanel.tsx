'use client';

import { Link as LinkIcon } from 'lucide-react';
import {
  DEFAULT_VIRTUAL_KEY_ORDER,
  type LinkType,
  type SessionNamingPattern,
  type VirtualKeyboardKey,
  useSettingsStore,
} from '@/stores/settings';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const VIRTUAL_KEYS: Array<{ id: VirtualKeyboardKey; label: string }> = [
  { id: 'ctrl_c', label: 'Ctrl + C' },
  { id: 'esc', label: 'Escape' },
  { id: 'tab', label: 'Tab' },
  { id: 'shift_tab', label: 'Shift + Tab' },
  { id: 'arrow_up', label: 'Arrow Up' },
  { id: 'arrow_down', label: 'Arrow Down' },
  { id: 'arrow_left', label: 'Arrow Left' },
  { id: 'arrow_right', label: 'Arrow Right' },
  { id: 'enter', label: 'Enter' },
];

const selectClassName =
  'h-11 w-full rounded-md border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function SessionDefaultsPanel() {
  const virtualKeyboardKeys = useSettingsStore((state) => state.virtualKeyboardKeys);
  const setVirtualKeyboardKeys = useSettingsStore((state) => state.setVirtualKeyboardKeys);
  const sessionNamingPattern = useSettingsStore((state) => state.sessionNamingPattern);
  const setSessionNamingPattern = useSettingsStore((state) => state.setSessionNamingPattern);
  const autoCreateGroup = useSettingsStore((state) => state.autoCreateGroup);
  const setAutoCreateGroup = useSettingsStore((state) => state.setAutoCreateGroup);
  const autoLinkSessions = useSettingsStore((state) => state.autoLinkSessions);
  const setAutoLinkSessions = useSettingsStore((state) => state.setAutoLinkSessions);
  const defaultLinkType = useSettingsStore((state) => state.defaultLinkType);
  const setDefaultLinkType = useSettingsStore((state) => state.setDefaultLinkType);
  const effectiveKeys =
    virtualKeyboardKeys.length > 0 ? virtualKeyboardKeys : DEFAULT_VIRTUAL_KEY_ORDER;

  const toggleVirtualKey = (key: VirtualKeyboardKey, enabled: boolean) => {
    const keySet = new Set(effectiveKeys);
    if (enabled) keySet.add(key);
    else keySet.delete(key);
    setVirtualKeyboardKeys(DEFAULT_VIRTUAL_KEY_ORDER.filter((entry) => keySet.has(entry)));
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
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">Virtual keyboard</h3>
              <p className="text-xs text-muted-foreground">
                Quick keys shown on the mobile keyboard row.
              </p>
            </div>
            <Button
              variant="outline"
              size="mobile"
              onClick={() => setVirtualKeyboardKeys([...DEFAULT_VIRTUAL_KEY_ORDER])}
            >
              Reset
            </Button>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            {VIRTUAL_KEYS.map((option) => {
              const id = `virtual-key-${option.id}`;
              return (
                <div key={option.id} className="flex min-h-11 items-center justify-between gap-3">
                  <Label htmlFor={id}>{option.label}</Label>
                  <Switch
                    id={id}
                    checked={effectiveKeys.includes(option.id)}
                    onCheckedChange={(checked) => toggleVirtualKey(option.id, checked)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
