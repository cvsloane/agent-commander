'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Boxes, FolderOpen, Monitor, Moon, Plus, Sun, Trash2 } from 'lucide-react';
import { getHosts } from '@/lib/api';
import { type DevFolder, type RepoSortBy, useSettingsStore } from '@/stores/settings';
import { useThemeStore } from '@/stores/theme';
import { type VisualizerTheme, useVisualizerThemeStore } from '@/stores/visualizerTheme';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';

const selectClassName =
  'h-11 w-full rounded-md border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function WorkspacePanel() {
  const { theme, setTheme } = useThemeStore();
  const { theme: visualizerTheme, setTheme: setVisualizerTheme } = useVisualizerThemeStore();
  const showVisualizerInSidebar = useSettingsStore((state) => state.showVisualizerInSidebar);
  const setShowVisualizerInSidebar = useSettingsStore((state) => state.setShowVisualizerInSidebar);
  const devFolders = useSettingsStore((state) => state.devFolders);
  const addDevFolder = useSettingsStore((state) => state.addDevFolder);
  const removeDevFolder = useSettingsStore((state) => state.removeDevFolder);
  const repoSortBy = useSettingsStore((state) => state.repoSortBy);
  const setRepoSortBy = useSettingsStore((state) => state.setRepoSortBy);
  const showHiddenFolders = useSettingsStore((state) => state.showHiddenFolders);
  const setShowHiddenFolders = useSettingsStore((state) => state.setShowHiddenFolders);
  const [newDevFolder, setNewDevFolder] = useState<Partial<DevFolder>>({});
  const [showAddDevFolder, setShowAddDevFolder] = useState(false);
  const { data: hostsData } = useQuery({ queryKey: ['hosts'], queryFn: getHosts });

  const closeNewFolder = () => {
    setNewDevFolder({});
    setShowAddDevFolder(false);
  };

  return (
    <section className="space-y-5" aria-labelledby="workspace-settings-title">
      <h2
        id="workspace-settings-title"
        className="text-sm font-medium uppercase tracking-wider text-muted-foreground"
      >
        Workspace
      </h2>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border p-4">
          <h3 className="font-medium">Appearance</h3>
          <div className="space-y-2">
            <Label>Theme</Label>
            <RadioGroup
              value={theme}
              onValueChange={(value) => setTheme(value as 'light' | 'dark' | 'system')}
              className="grid gap-1 sm:grid-cols-3"
            >
              <ThemeOption
                id="theme-light"
                value="light"
                icon={<Sun className="h-4 w-4" aria-hidden="true" />}
                label="Light"
              />
              <ThemeOption
                id="theme-dark"
                value="dark"
                icon={<Moon className="h-4 w-4" aria-hidden="true" />}
                label="Dark"
              />
              <ThemeOption
                id="theme-system"
                value="system"
                icon={<Monitor className="h-4 w-4" aria-hidden="true" />}
                label="System"
              />
            </RadioGroup>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <h3 className="flex items-center gap-2 font-medium">
            <Boxes className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Visualizer
          </h3>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor="show-visualizer">Show in sidebar</Label>
            <Switch
              id="show-visualizer"
              checked={showVisualizerInSidebar}
              onCheckedChange={setShowVisualizerInSidebar}
            />
          </div>
          <RadioGroup
            value={visualizerTheme}
            onValueChange={(value) => setVisualizerTheme(value as VisualizerTheme)}
            className="grid gap-1"
          >
            <ThemeOption id="viz-botspace" value="botspace" label="Botspace" />
            <ThemeOption id="viz-civilization" value="civilization" label="Civilization" />
            <ThemeOption id="viz-bridge" value="bridge-control" label="Bridge Control" />
          </RadioGroup>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-medium">
            <FolderOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Repo picker
          </h3>
          <Button
            variant="outline"
            size="mobile"
            onClick={() => setShowAddDevFolder((value) => !value)}
            className="gap-2"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add folder
          </Button>
        </div>

        {showAddDevFolder && (
          <div className="grid gap-3 rounded-lg border bg-accent/30 p-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dev-folder-host">Host</Label>
              <select
                id="dev-folder-host"
                value={newDevFolder.hostId || ''}
                onChange={(event) =>
                  setNewDevFolder((value) => ({ ...value, hostId: event.target.value }))
                }
                className={selectClassName}
              >
                <option value="">Select host…</option>
                {hostsData?.hosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dev-folder-path">Path</Label>
              <Input
                id="dev-folder-path"
                className="h-11 font-mono"
                value={newDevFolder.path || ''}
                onChange={(event) =>
                  setNewDevFolder((value) => ({ ...value, path: event.target.value }))
                }
                placeholder="~/dev"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="dev-folder-label">Label (optional)</Label>
              <Input
                id="dev-folder-label"
                className="h-11"
                value={newDevFolder.label || ''}
                onChange={(event) =>
                  setNewDevFolder((value) => ({ ...value, label: event.target.value }))
                }
              />
            </div>
            <div className="flex gap-2 sm:col-span-2 sm:justify-end">
              <Button variant="outline" size="mobile" onClick={closeNewFolder}>
                Cancel
              </Button>
              <Button
                size="mobile"
                disabled={!newDevFolder.hostId || !newDevFolder.path}
                onClick={() => {
                  if (!newDevFolder.hostId || !newDevFolder.path) return;
                  addDevFolder({
                    hostId: newDevFolder.hostId,
                    path: newDevFolder.path,
                    label: newDevFolder.label,
                  });
                  closeNewFolder();
                }}
              >
                Add folder
              </Button>
            </div>
          </div>
        )}

        {devFolders.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No dev folders configured.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {devFolders.map((folder, index) => (
              <div
                key={`${folder.hostId}-${folder.path}`}
                className="flex min-h-14 items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{folder.label || folder.path}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {hostsData?.hosts.find((host) => host.id === folder.hostId)?.name}:{' '}
                    {folder.path}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="mobile-icon"
                  onClick={() => removeDevFolder(index)}
                  aria-label={`Remove ${folder.label || folder.path}`}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="repo-sort">Sort repositories by</Label>
            <select
              id="repo-sort"
              value={repoSortBy}
              onChange={(event) => setRepoSortBy(event.target.value as RepoSortBy)}
              className={selectClassName}
            >
              <option value="name">Name</option>
              <option value="last_modified">Last Modified</option>
              <option value="last_used">Last Used</option>
            </select>
          </div>
          <div className="flex min-h-11 items-end justify-between gap-3 sm:items-center sm:pt-6">
            <Label htmlFor="show-hidden">Show hidden folders</Label>
            <Switch
              id="show-hidden"
              checked={showHiddenFolders}
              onCheckedChange={setShowHiddenFolders}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-medium">Host access</h3>
          <p className="text-xs text-muted-foreground">
            Manage directory listing permissions per host.
          </p>
        </div>
        <Button variant="outline" size="mobile" asChild>
          <Link href="/hosts">Open host settings</Link>
        </Button>
      </div>
    </section>
  );
}

function ThemeOption({
  id,
  value,
  label,
  icon,
}: {
  id: string;
  value: string;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-accent">
      <RadioGroupItem value={value} id={id} />
      <Label htmlFor={id} className="flex flex-1 cursor-pointer items-center gap-2">
        {icon}
        {label}
      </Label>
    </div>
  );
}
