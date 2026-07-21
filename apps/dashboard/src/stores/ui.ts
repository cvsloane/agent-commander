import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RecentSession {
  id: string;
  title: string | null;
  cwd: string | null;
  status: string;
  provider: string;
  kind?: string | null;
  hostId?: string | null;
  tmuxTarget?: string | null;
  tmuxSessionName?: string | null;
  visitedAt: string;
}

export interface LastAttachedTmux {
  hostId: string;
  sessionId: string;
}

interface UIStore {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  recentSessions: RecentSession[];
  lastAttachedTmux: LastAttachedTmux | null;
  setLastAttachedTmux: (attachment: LastAttachedTmux | null) => void;
  addRecentSession: (session: {
    id: string;
    title: string | null;
    cwd: string | null;
    status: string;
    provider: string;
    kind?: string | null;
    hostId?: string | null;
    tmuxTarget?: string | null;
    tmuxSessionName?: string | null;
  }) => void;
  updateRecentSessionStatus: (sessionId: string, status: string) => void;
  clearRecentSessions: () => void;
}

const MAX_RECENT_SESSIONS = 5;

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      mobileMenuOpen: false,
      setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),

      recentSessions: [],
      lastAttachedTmux: null,
      setLastAttachedTmux: (attachment) => set({ lastAttachedTmux: attachment }),
      addRecentSession: (session) =>
        set((state) => {
          // Remove existing entry for this session if present
          const filtered = state.recentSessions.filter((s) => s.id !== session.id);
          // Add to front with current timestamp
          const updated = [
            {
              ...session,
              visitedAt: new Date().toISOString(),
            },
            ...filtered,
          ].slice(0, MAX_RECENT_SESSIONS);
          return { recentSessions: updated };
        }),

      updateRecentSessionStatus: (sessionId, status) =>
        set((state) => ({
          recentSessions: state.recentSessions.map((s) =>
            s.id === sessionId ? { ...s, status } : s
          ),
        })),

      clearRecentSessions: () => set({ recentSessions: [] }),

    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        recentSessions: state.recentSessions,
        lastAttachedTmux: state.lastAttachedTmux,
      }),
    }
  )
);
