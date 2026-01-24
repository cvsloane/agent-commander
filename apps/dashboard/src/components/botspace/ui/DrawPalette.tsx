'use client';

import { DRAW_COLORS } from '@/lib/workshop/draw';
import { useWorkshopVibeStore } from '@/stores/workshopVibe';

export function DrawPalette() {
  const {
    draw,
    selectColor,
    selectEraser,
    increaseBrush,
    decreaseBrush,
    toggle3DMode,
    clearPaintedHexes,
  } = useWorkshopVibeStore();

  return (
    <div id="draw-palette" className={draw.enabled ? 'visible' : ''}>
      {DRAW_COLORS.map((color, idx) => (
        <button
          key={color.id}
          type="button"
          className={`draw-color-btn ${draw.selectedColorIndex === idx && !draw.isEraser ? 'selected' : ''}`}
          style={{ ['--color' as any]: color.hex }}
          onClick={() => selectColor(idx)}
        >
          <span className="draw-color-key">{color.key}</span>
        </button>
      ))}
      <button
        type="button"
        className={`draw-eraser-btn ${draw.isEraser ? 'selected' : ''}`}
        onClick={selectEraser}
      >
        <span className="draw-eraser-icon">⌫</span>
        <span className="draw-color-key">0</span>
      </button>
      <button type="button" className="draw-clear-btn" onClick={clearPaintedHexes}>
        <span className="draw-clear-icon">✕</span>
      </button>
      <div className="draw-brush-size">
        <button type="button" className="draw-brush-btn" onClick={decreaseBrush}>−</button>
        <span className="draw-brush-size-value">{draw.brushSize}</span>
        <button type="button" className="draw-brush-btn" onClick={increaseBrush}>+</button>
      </div>
      <button
        type="button"
        className={`draw-3d-toggle ${draw.is3DMode ? 'active' : ''}`}
        onClick={toggle3DMode}
      >
        <span className="draw-3d-icon">{draw.is3DMode ? '3D' : '2D'}</span>
      </button>
    </div>
  );
}
