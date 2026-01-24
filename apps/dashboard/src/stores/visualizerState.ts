import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Visualizer State Store
 *
 * This is the main state store for the botspace visualizer.
 */

export type CameraMode = 'focused' | 'overview' | 'follow-active';

export interface DrawState {
  enabled: boolean;
  selectedColorIndex: number;
  isEraser: boolean;
  brushSize: number;
  is3DMode: boolean;
}

export interface PaintedHex {
  q: number;
  r: number;
  color: string;
  height: number;
}

// Platform-based painted area for botspace theme
export interface PaintedPlatform {
  x: number;
  y: number;
  color: string;
  height: number;
}

export interface TextTile {
  id: string;
  q: number;
  r: number;
  text: string;
  color: string;
}

interface VisualizerStateStore {
  // Session selection
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;

  // Camera
  cameraMode: CameraMode;
  setCameraMode: (mode: CameraMode) => void;

  // Audio (legacy - use visualizerPreferences for new code)
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  soundVolume: number;
  setSoundVolume: (volume: number) => void;

  // Station panels toggle
  stationPanelsEnabled: boolean;
  toggleStationPanels: () => void;

  // Draw state
  draw: DrawState;
  toggleDraw: () => void;
  exitDraw: () => void;
  selectColor: (index: number) => void;
  selectEraser: () => void;
  increaseBrush: () => void;
  decreaseBrush: () => void;
  toggle3DMode: () => void;

  // Painted hexes (for hex-based themes)
  paintedHexes: PaintedHex[];
  setPaintedHexes: (hexes: PaintedHex[]) => void;
  upsertPaintedHex: (hex: PaintedHex) => void;
  removePaintedHex: (q: number, r: number) => void;
  clearPaintedHexes: () => void;

  // Text labels
  textTiles: TextTile[];
  addTextTile: (tile: Omit<TextTile, 'id'>) => void;
  updateTextTile: (id: string, updates: Partial<TextTile>) => void;
  removeTextTile: (id: string) => void;
}

export const useVisualizerStateStore = create<VisualizerStateStore>()(
  persist(
    (set, get) => ({
      // Session selection
      selectedSessionId: null,
      setSelectedSessionId: (id) => set({ selectedSessionId: id }),

      // Camera
      cameraMode: 'focused',
      setCameraMode: (mode) => set({ cameraMode: mode }),

      // Audio
      soundEnabled: false, // Default OFF
      setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
      soundVolume: 0.6,
      setSoundVolume: (volume) => set({ soundVolume: Math.max(0, Math.min(1, volume)) }),

      // Station panels
      stationPanelsEnabled: false,
      toggleStationPanels: () => set((state) => ({ stationPanelsEnabled: !state.stationPanelsEnabled })),

      // Draw state
      draw: {
        enabled: false,
        selectedColorIndex: 0,
        isEraser: false,
        brushSize: 1,
        is3DMode: true,
      },
      toggleDraw: () =>
        set((state) => ({
          draw: {
            ...state.draw,
            enabled: !state.draw.enabled,
            selectedColorIndex: 0,
            isEraser: false,
          },
        })),
      exitDraw: () => set((state) => ({ draw: { ...state.draw, enabled: false } })),
      selectColor: (index) =>
        set((state) => ({
          draw: {
            ...state.draw,
            selectedColorIndex: index,
            isEraser: false,
          },
        })),
      selectEraser: () => set((state) => ({ draw: { ...state.draw, isEraser: true } })),
      increaseBrush: () =>
        set((state) => ({
          draw: { ...state.draw, brushSize: Math.min(4, state.draw.brushSize + 1) },
        })),
      decreaseBrush: () =>
        set((state) => ({
          draw: { ...state.draw, brushSize: Math.max(1, state.draw.brushSize - 1) },
        })),
      toggle3DMode: () =>
        set((state) => ({ draw: { ...state.draw, is3DMode: !state.draw.is3DMode } })),

      // Painted hexes
      paintedHexes: [],
      setPaintedHexes: (hexes) => set({ paintedHexes: hexes }),
      upsertPaintedHex: (hex) =>
        set((state) => {
          const idx = state.paintedHexes.findIndex((h) => h.q === hex.q && h.r === hex.r);
          if (idx === -1) {
            return { paintedHexes: [...state.paintedHexes, hex] };
          }
          const next = [...state.paintedHexes];
          next[idx] = hex;
          return { paintedHexes: next };
        }),
      removePaintedHex: (q, r) =>
        set((state) => ({
          paintedHexes: state.paintedHexes.filter((h) => h.q !== q || h.r !== r),
        })),
      clearPaintedHexes: () => set({ paintedHexes: [] }),

      // Text tiles
      textTiles: [],
      addTextTile: (tile) =>
        set((state) => ({
          textTiles: [
            ...state.textTiles,
            { id: `tile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...tile },
          ],
        })),
      updateTextTile: (id, updates) =>
        set((state) => ({
          textTiles: state.textTiles.map((tile) => (tile.id === id ? { ...tile, ...updates } : tile)),
        })),
      removeTextTile: (id) =>
        set((state) => ({ textTiles: state.textTiles.filter((tile) => tile.id !== id) })),
    }),
    {
      name: 'visualizer-state',
      partialize: (state) => ({
        cameraMode: state.cameraMode,
        soundEnabled: state.soundEnabled,
        soundVolume: state.soundVolume,
        stationPanelsEnabled: state.stationPanelsEnabled,
        draw: state.draw,
        paintedHexes: state.paintedHexes,
        textTiles: state.textTiles,
      }),
    }
  )
);

// Alias for backwards compatibility during transition
export const useWorkshopVibeStore = useVisualizerStateStore;
