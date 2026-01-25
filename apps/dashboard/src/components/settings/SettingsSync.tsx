"use client";

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { UserSettings } from '@agent-command/schema';
import { getUserSettings, updateUserSettings, type SpawnProvider } from '@/lib/api';
import {
  useSettingsStore,
  DEFAULT_VIRTUAL_KEY_ORDER,
  DEFAULT_ALERT_SETTINGS,
  normalizeAlertSettings,
  type AlertSettings,
  type VirtualKeyboardKey,
} from '@/stores/settings';
import { useThemeStore } from '@/stores/theme';
import { useUIStore } from '@/stores/ui';
import { useVisualizerThemeStore } from '@/stores/visualizerTheme';

type PersistApi = {
  hasHydrated: () => boolean;
  onFinishHydration: (fn: () => void) => () => void;
};

type NormalizedUserSettings = UserSettings & {
  data: UserSettings['data'] & {
    alertSettings: AlertSettings;
  };
};

function getPersistApi(store: unknown): PersistApi | null {
  const persist = (store as { persist?: PersistApi }).persist;
  if (!persist?.hasHydrated || !persist?.onFinishHydration) return null;
  return persist;
}

function mergeSettings(settings: UserSettings | null): NormalizedUserSettings {
  const data: Partial<UserSettings['data']> = settings?.data ?? {};
  const allowedVirtualKeys = new Set(DEFAULT_VIRTUAL_KEY_ORDER);
  let virtualKeyboardKeys = Array.isArray(data.virtualKeyboardKeys)
    ? data.virtualKeyboardKeys.filter((key): key is VirtualKeyboardKey =>
      allowedVirtualKeys.has(key as VirtualKeyboardKey)
    )
    : [];
  if (virtualKeyboardKeys.length === 0) {
    virtualKeyboardKeys = [...DEFAULT_VIRTUAL_KEY_ORDER];
  }
  const alertSettings = normalizeAlertSettings(data.alertSettings, {
    browser: {
      ...DEFAULT_ALERT_SETTINGS.browser,
      enabled: data.notificationsEnabled ?? DEFAULT_ALERT_SETTINGS.browser.enabled,
    },
    audio: {
      ...DEFAULT_ALERT_SETTINGS.audio,
      enabled: data.audioEnabled ?? DEFAULT_ALERT_SETTINGS.audio.enabled,
    },
  } as Partial<AlertSettings>);
  const notificationsEnabled =
    data.alertSettings?.browser?.enabled ?? data.notificationsEnabled ?? false;
  const audioEnabled =
    data.alertSettings?.audio?.enabled ?? data.audioEnabled ?? false;

  return {
    version: 1,
    data: {
      theme: data.theme ?? 'system',
      visualizerTheme: data.visualizerTheme ?? 'botspace',
      notificationsEnabled,
      audioEnabled,
      sidebarCollapsed: data.sidebarCollapsed ?? false,
      visibleProviders: {
        claude_code: true,
        codex: true,
        gemini_cli: true,
        opencode: true,
        ...(data.visibleProviders || {}),
      },
      showVisualizerInSidebar: data.showVisualizerInSidebar ?? true,
      alertSettings,
      virtualKeyboardKeys,
      devFolders: Array.isArray(data.devFolders) ? data.devFolders : [],
      repoSortBy: data.repoSortBy ?? 'name',
      showHiddenFolders: data.showHiddenFolders ?? false,
      repoLastUsed: data.repoLastUsed ?? {},
      defaultProvider: data.defaultProvider ?? 'claude_code',
      sessionNamingPattern: data.sessionNamingPattern ?? 'repo_name',
      autoCreateGroup: data.autoCreateGroup ?? true,
      defaultSessionTemplate: data.defaultSessionTemplate ?? 'single',
      autoLinkSessions: data.autoLinkSessions ?? true,
      defaultLinkType: data.defaultLinkType ?? 'complement',
    },
  };
}

const allowedProviders: SpawnProvider[] = ['claude_code', 'codex', 'gemini_cli', 'opencode', 'aider', 'shell'];

function coerceProvider(value: unknown): SpawnProvider {
  if (allowedProviders.includes(value as SpawnProvider)) {
    return value as SpawnProvider;
  }
  return 'claude_code';
}

function buildPayload(): UserSettings {
  const settingsState = useSettingsStore.getState();
  const themeState = useThemeStore.getState();
  const uiState = useUIStore.getState();
  const visualizerState = useVisualizerThemeStore.getState();

  return {
    version: 1,
    data: {
      theme: themeState.theme,
      visualizerTheme: visualizerState.theme,
      notificationsEnabled: settingsState.notificationsEnabled,
      audioEnabled: settingsState.audioEnabled,
      sidebarCollapsed: uiState.sidebarCollapsed,
      visibleProviders: settingsState.visibleProviders,
      showVisualizerInSidebar: settingsState.showVisualizerInSidebar,
      alertSettings: settingsState.alertSettings,
      virtualKeyboardKeys: settingsState.virtualKeyboardKeys,
      devFolders: settingsState.devFolders,
      repoSortBy: settingsState.repoSortBy,
      showHiddenFolders: settingsState.showHiddenFolders,
      repoLastUsed: settingsState.repoLastUsed,
      defaultProvider: settingsState.defaultProvider,
      sessionNamingPattern: settingsState.sessionNamingPattern,
      autoCreateGroup: settingsState.autoCreateGroup,
      defaultSessionTemplate: settingsState.defaultSessionTemplate,
      autoLinkSessions: settingsState.autoLinkSessions,
      defaultLinkType: settingsState.defaultLinkType,
    },
  };
}

export function SettingsSync() {
  const { status } = useSession();
  const [hydrated, setHydrated] = useState(false);
  const [syncReady, setSyncReady] = useState(false);
  const initRef = useRef(false);
  const lastSavedHashRef = useRef<string | null>(null);
  const applyingRemoteRef = useRef(false);

  useEffect(() => {
    const stores = [
      getPersistApi(useSettingsStore),
      getPersistApi(useThemeStore),
      getPersistApi(useUIStore),
      getPersistApi(useVisualizerThemeStore),
    ].filter(Boolean) as PersistApi[];

    const checkHydrated = () => stores.every((store) => store.hasHydrated());
    if (checkHydrated()) {
      setHydrated(true);
      return;
    }

    const unsubs = stores.map((store) =>
      store.onFinishHydration(() => {
        if (checkHydrated()) {
          setHydrated(true);
        }
      })
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, []);

  useEffect(() => {
    if (status !== 'authenticated' || !hydrated || initRef.current) return;
    initRef.current = true;
    let cancelled = false;

    (async () => {
      const remote = await getUserSettings();
      if (cancelled) return;

      if (remote.settings) {
        const merged = mergeSettings(remote.settings);
        const mergedHash = JSON.stringify(merged);
        const currentHash = JSON.stringify(buildPayload());

        if (mergedHash !== currentHash) {
          applyingRemoteRef.current = true;
          useThemeStore.setState({ theme: merged.data.theme });
          useVisualizerThemeStore.setState({ theme: merged.data.visualizerTheme });
          useUIStore.setState({
            sidebarCollapsed: merged.data.sidebarCollapsed,
          });
          useSettingsStore.setState({
            visibleProviders: merged.data.visibleProviders,
            showVisualizerInSidebar: merged.data.showVisualizerInSidebar,
            notificationsEnabled: merged.data.notificationsEnabled,
            audioEnabled: merged.data.audioEnabled,
            alertSettings: merged.data.alertSettings,
            devFolders: merged.data.devFolders,
            repoSortBy: merged.data.repoSortBy,
            showHiddenFolders: merged.data.showHiddenFolders,
            repoLastUsed: merged.data.repoLastUsed,
            defaultProvider: coerceProvider(merged.data.defaultProvider),
            sessionNamingPattern: merged.data.sessionNamingPattern,
            autoCreateGroup: merged.data.autoCreateGroup,
            defaultSessionTemplate: merged.data.defaultSessionTemplate,
            autoLinkSessions: merged.data.autoLinkSessions,
            defaultLinkType: merged.data.defaultLinkType,
          });
          applyingRemoteRef.current = false;
        }

        lastSavedHashRef.current = mergedHash;
      } else {
        const payload = buildPayload();
        await updateUserSettings(payload);
        lastSavedHashRef.current = JSON.stringify(payload);
      }

      setSyncReady(true);
    })().catch(() => {
      setSyncReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [status, hydrated]);

  useEffect(() => {
    if (!syncReady || status !== 'authenticated') return;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const scheduleSave = () => {
      if (applyingRemoteRef.current) return;
      const payload = buildPayload();
      const hash = JSON.stringify(payload);
      if (lastSavedHashRef.current === hash) return;

      if (timeout) {
        clearTimeout(timeout);
      }

      timeout = setTimeout(() => {
        updateUserSettings(payload)
          .then(() => {
            lastSavedHashRef.current = hash;
          })
          .catch(() => {});
      }, 500);
    };

    const unsubSettings = useSettingsStore.subscribe(scheduleSave);
    const unsubTheme = useThemeStore.subscribe(scheduleSave);
    const unsubUI = useUIStore.subscribe(scheduleSave);
    const unsubVisualizer = useVisualizerThemeStore.subscribe(scheduleSave);

    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      unsubSettings();
      unsubTheme();
      unsubUI();
      unsubVisualizer();
    };
  }, [syncReady, status]);

  return null;
}
