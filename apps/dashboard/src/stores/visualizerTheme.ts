import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type VisualizerTheme = 'botspace' | 'civilization' | 'bridge-control';

interface VisualizerThemeStore {
  theme: VisualizerTheme;
  setTheme: (theme: VisualizerTheme) => void;
}

export const useVisualizerThemeStore = create<VisualizerThemeStore>()(
  persist(
    (set) => ({
      theme: 'botspace',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'visualizer-theme-v2',
    }
  )
);
