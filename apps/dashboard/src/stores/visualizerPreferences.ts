import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface VisualizerPreferencesStore {
  // Motion preferences
  reducedMotion: boolean | 'system'; // 'system' = honor prefers-reduced-motion
  setReducedMotion: (value: boolean | 'system') => void;

  // Audio preferences - default OFF per plan requirements
  audioEnabled: boolean;
  setAudioEnabled: (enabled: boolean) => void;
  audioVolume: number; // 0-1
  setAudioVolume: (volume: number) => void;

  // Drawing preferences
  drawingEnabled: boolean;
  setDrawingEnabled: (enabled: boolean) => void;

  // Notification preferences
  notificationsEnabled: boolean;
  setNotificationsEnabled: (enabled: boolean) => void;
  notificationDuration: number; // ms
  setNotificationDuration: (duration: number) => void;

  // Computed helper for checking if motion should be reduced
  shouldReduceMotion: () => boolean;
}

export const useVisualizerPreferencesStore = create<VisualizerPreferencesStore>()(
  persist(
    (set, get) => ({
      // Motion - default to system preference
      reducedMotion: 'system',
      setReducedMotion: (value) => set({ reducedMotion: value }),

      // Audio - default OFF per requirements
      audioEnabled: false,
      setAudioEnabled: (enabled) => set({ audioEnabled: enabled }),
      audioVolume: 0.6,
      setAudioVolume: (volume) => set({ audioVolume: Math.max(0, Math.min(1, volume)) }),

      // Drawing
      drawingEnabled: true,
      setDrawingEnabled: (enabled) => set({ drawingEnabled: enabled }),

      // Notifications
      notificationsEnabled: true,
      setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),
      notificationDuration: 5000,
      setNotificationDuration: (duration) => set({ notificationDuration: duration }),

      // Helper to check system preference when 'system' is selected
      shouldReduceMotion: () => {
        const { reducedMotion } = get();
        if (reducedMotion === 'system') {
          // Check system preference
          if (typeof window !== 'undefined') {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          }
          return false;
        }
        return reducedMotion;
      },
    }),
    {
      name: 'visualizer-preferences',
      partialize: (state) => ({
        reducedMotion: state.reducedMotion,
        audioEnabled: state.audioEnabled,
        audioVolume: state.audioVolume,
        drawingEnabled: state.drawingEnabled,
        notificationsEnabled: state.notificationsEnabled,
        notificationDuration: state.notificationDuration,
      }),
    }
  )
);
