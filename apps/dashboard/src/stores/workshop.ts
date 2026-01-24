import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CameraMode = 'overview' | 'focused' | 'follow';

// Session color palette (6 colors for max 6 sessions)
export const SESSION_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#06b6d4', '#eab308'];

export interface Annotation {
  id: string;
  tileIndex: number;
  position: [number, number, number];
  label: string;
  color: string;
}

interface WorkshopStore {
  // Session selection
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;

  // Current tool tracking (for selected session - legacy)
  currentTool: string | null;
  toolStartedAt: string | null;
  currentToolEventId: string | null;
  setCurrentTool: (tool: string | null, startedAt?: string, eventId?: string) => void;

  // Multi-session tool tracking
  sessionTools: Record<string, string | null>;
  setSessionTool: (sessionId: string, tool: string | null) => void;
  clearSessionTools: () => void;
  pruneSessionTools: (sessionIds: string[]) => void;

  // Camera
  cameraMode: CameraMode;
  setCameraMode: (mode: CameraMode) => void;

  // Settings
  annotationsEnabled: boolean;
  setAnnotationsEnabled: (enabled: boolean) => void;
  soundsEnabled: boolean;
  setSoundsEnabled: (enabled: boolean) => void;

  // Annotations
  annotations: Annotation[];
  addAnnotation: (tileIndex: number, position: [number, number, number], label: string) => void;
  removeAnnotation: (id: string) => void;
  clearAnnotations: () => void;
}

export const useWorkshopStore = create<WorkshopStore>()(
  persist(
    (set, get) => ({
      // Session selection
      selectedSessionId: null,
      setSelectedSessionId: (id) => set({ selectedSessionId: id }),

      // Current tool tracking (for selected session - legacy)
      currentTool: null,
      toolStartedAt: null,
      currentToolEventId: null,
      setCurrentTool: (tool, startedAt, eventId) =>
        set({
          currentTool: tool,
          toolStartedAt: tool ? startedAt || new Date().toISOString() : null,
          currentToolEventId: tool ? eventId || null : null,
        }),

      // Multi-session tool tracking
      sessionTools: {},
      setSessionTool: (sessionId, tool) =>
        set((state) => ({
          sessionTools: {
            ...state.sessionTools,
            [sessionId]: tool,
          },
        })),
      clearSessionTools: () => set({ sessionTools: {} }),
      pruneSessionTools: (sessionIds) => {
        const { sessionTools } = get();
        const allowed = new Set(sessionIds);
        let changed = false;
        const next: Record<string, string | null> = {};

        for (const [id, tool] of Object.entries(sessionTools)) {
          if (allowed.has(id)) {
            next[id] = tool;
          } else {
            changed = true;
          }
        }

        if (changed) {
          set({ sessionTools: next });
        }
      },

      // Camera
      cameraMode: 'overview',
      setCameraMode: (mode) => set({ cameraMode: mode }),

      // Settings
      annotationsEnabled: true,
      setAnnotationsEnabled: (enabled) => set({ annotationsEnabled: enabled }),
      soundsEnabled: false,
      setSoundsEnabled: (enabled) => set({ soundsEnabled: enabled }),

      // Annotations
      annotations: [],
      addAnnotation: (tileIndex, position, label) =>
        set((state) => ({
          annotations: [
            ...state.annotations,
            {
              id: `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              tileIndex,
              position,
              label,
              color: '#22c55e',
            },
          ],
        })),
      removeAnnotation: (id) =>
        set((state) => ({
          annotations: state.annotations.filter((a) => a.id !== id),
        })),
      clearAnnotations: () => set({ annotations: [] }),
    }),
    {
      name: 'workshop-storage',
      partialize: (state) => ({
        cameraMode: state.cameraMode,
        annotationsEnabled: state.annotationsEnabled,
        soundsEnabled: state.soundsEnabled,
        annotations: state.annotations,
      }),
    }
  )
);
