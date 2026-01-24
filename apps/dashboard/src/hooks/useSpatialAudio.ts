'use client';

import { useRef, useCallback, useEffect } from 'react';

// Space-themed sound config per tool type
// Lower frequencies, softer attacks, muffled/retro-futuristic feel
const TOOL_SOUNDS: Record<string, { frequency: number; duration: number; type: OscillatorType }> = {
  Read: { frequency: 380, duration: 120, type: 'sine' },       // Data access ping
  Write: { frequency: 440, duration: 150, type: 'sine' },      // System confirm
  Edit: { frequency: 440, duration: 150, type: 'sine' },       // Fabrication tone
  NotebookEdit: { frequency: 440, duration: 150, type: 'sine' },
  Bash: { frequency: 280, duration: 180, type: 'triangle' },   // Shell activation
  Grep: { frequency: 340, duration: 140, type: 'sine' },       // Sensor scan
  Glob: { frequency: 340, duration: 140, type: 'sine' },       // Sensor scan
  WebFetch: { frequency: 520, duration: 160, type: 'sine' },   // Comm signal
  WebSearch: { frequency: 520, duration: 160, type: 'sine' },  // Comm signal
  Task: { frequency: 460, duration: 200, type: 'sine' },       // Airlock whoosh
  TodoWrite: { frequency: 420, duration: 120, type: 'sine' },  // Mission update
  default: { frequency: 360, duration: 100, type: 'sine' },
};

interface SpatialAudioOptions {
  enabled: boolean;
  volume?: number;
}

/**
 * Hook to manage spatial audio for tool sounds.
 * Uses Web Audio API with basic panning based on position.
 */
export function useSpatialAudio({ enabled, volume = 1 }: SpatialAudioOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeOscillators = useRef<Set<OscillatorNode>>(new Set());

  // Initialize audio context on first use
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current && typeof window !== 'undefined') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  // Play a positioned sound
  const playSound = useCallback(
    (tool: string, position: [number, number, number]) => {
      if (!enabled) return;

      const ctx = getAudioContext();
      if (!ctx) return;

      // Resume context if suspended (browser autoplay policy)
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const soundConfig = TOOL_SOUNDS[tool] || TOOL_SOUNDS.default;

      // Create oscillator
      const oscillator = ctx.createOscillator();
      oscillator.type = soundConfig.type;
      oscillator.frequency.setValueAtTime(soundConfig.frequency, ctx.currentTime);

      // Create gain node for volume envelope
      const gainNode = ctx.createGain();
      const baseGain = 0.3 * Math.max(0, Math.min(1, volume));
      gainNode.gain.setValueAtTime(baseGain, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        ctx.currentTime + soundConfig.duration / 1000
      );

      // Create stereo panner for basic spatial audio
      // Position X maps to stereo position (-1 left, 1 right)
      const panner = ctx.createStereoPanner();
      const panValue = Math.max(-1, Math.min(1, position[0] / 5)); // Normalize X position
      panner.pan.setValueAtTime(panValue, ctx.currentTime);

      // Connect nodes
      oscillator.connect(gainNode);
      gainNode.connect(panner);
      panner.connect(ctx.destination);

      // Track and play
      activeOscillators.current.add(oscillator);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + soundConfig.duration / 1000);

      oscillator.onended = () => {
        activeOscillators.current.delete(oscillator);
        oscillator.disconnect();
        gainNode.disconnect();
        panner.disconnect();
      };
    },
    [enabled, getAudioContext, volume]
  );

  // Cleanup on unmount
  useEffect(() => {
    const oscillators = activeOscillators.current;
    return () => {
      oscillators.forEach((osc) => {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // Ignore errors on cleanup
        }
      });
      oscillators.clear();
    };
  }, []);

  return { playSound };
}
