import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RecentSession {
  id: string;
  title: string | null;
  cwd: string | null;
  status: string;
  provider: string;
  visitedAt: string;
}

interface UIStore {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  toggleMobileMenu: () => void;
  recentSessions: RecentSession[];
  addRecentSession: (session: {
    id: string;
    title: string | null;
    cwd: string | null;
    status: string;
    provider: string;
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
      toggleMobileMenu: () => set((state) => ({ mobileMenuOpen: !state.mobileMenuOpen })),

      recentSessions: [],
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
      }),
    }
  )
);
