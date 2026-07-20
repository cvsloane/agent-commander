'use client';

import { useEffect, useState } from 'react';
import type { MobileLaunchProvider } from '@agent-command/schema';

export const RECENT_LAUNCH_STORAGE_KEY = 'agent-command:last-launch';
const RECENT_LAUNCH_EVENT = 'agent-command:recent-launch-changed';

export interface RecentLaunch {
  host_id: string;
  provider: MobileLaunchProvider;
  working_directory: string;
  tmux_target?: string | null;
}

export function readRecentLaunch(): RecentLaunch | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(RECENT_LAUNCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RecentLaunch>;
    if (
      typeof parsed.host_id !== 'string' ||
      (parsed.provider !== 'codex' && parsed.provider !== 'claude_code') ||
      typeof parsed.working_directory !== 'string'
    ) {
      return null;
    }
    return {
      host_id: parsed.host_id,
      provider: parsed.provider,
      working_directory: parsed.working_directory,
      tmux_target: typeof parsed.tmux_target === 'string' ? parsed.tmux_target : null,
    };
  } catch {
    return null;
  }
}

export function writeRecentLaunch(launch: RecentLaunch): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_LAUNCH_STORAGE_KEY, JSON.stringify(launch));
    window.dispatchEvent(new CustomEvent(RECENT_LAUNCH_EVENT));
  } catch {
    // localStorage can be unavailable in restricted browsers.
  }
}

export function useRecentLaunch(refreshKey?: unknown): RecentLaunch | null {
  const [recentLaunch, setRecentLaunch] = useState<RecentLaunch | null>(null);

  useEffect(() => {
    const refresh = () => setRecentLaunch(readRecentLaunch());
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener(RECENT_LAUNCH_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(RECENT_LAUNCH_EVENT, refresh);
    };
  }, [refreshKey]);

  return recentLaunch;
}
