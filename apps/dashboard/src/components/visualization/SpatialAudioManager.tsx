'use client';

import { useEffect, useRef } from 'react';
import { useSpatialAudio } from '@/hooks/useSpatialAudio';

// Map tool names to station positions (same as WorkshopScene)
const TOOL_TO_STATION: Record<string, [number, number, number]> = {
  Read: [-3, 0, 0],
  Write: [-1, 0, 0],
  Edit: [-1, 0, 0],
  NotebookEdit: [-1, 0, 0],
  Bash: [1, 0, 0],
  Grep: [3, 0, 0],
  Glob: [3, 0, 0],
  WebFetch: [0, 0, 2],
  WebSearch: [0, 0, 2],
  Task: [0, 0, -2],
  TodoWrite: [0, 0, -2],
  EnterPlanMode: [0, 0, -2],
  ExitPlanMode: [0, 0, -2],
  default: [0, 0, 0],
};

interface SpatialAudioManagerProps {
  enabled: boolean;
  sessionTools: Record<string, string | null>;
}

/**
 * Manages spatial audio for tool execution.
 * Plays positioned sounds when tools start.
 */
export function SpatialAudioManager({
  enabled,
  sessionTools,
}: SpatialAudioManagerProps) {
  const { playSound } = useSpatialAudio({ enabled });
  const previousToolsRef = useRef<Record<string, string | null>>({});

  // Detect new tool starts and play sounds
  useEffect(() => {
    if (!enabled) return;

    const previousTools = previousToolsRef.current;

    // Check for newly started tools
    Object.entries(sessionTools).forEach(([sessionId, tool]) => {
      const previousTool = previousTools[sessionId];

      // If tool changed from null/different to a new tool, play sound
      if (tool && tool !== previousTool) {
        const position = TOOL_TO_STATION[tool] || TOOL_TO_STATION.default;
        playSound(tool, position);
      }
    });

    // Update previous tools ref
    previousToolsRef.current = { ...sessionTools };
  }, [sessionTools, enabled, playSound]);

  // This component doesn't render anything
  return null;
}
