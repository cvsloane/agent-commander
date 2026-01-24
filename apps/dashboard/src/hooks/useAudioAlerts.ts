'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useOrchestratorStore } from '@/stores/orchestrator';
import { useSettingsStore } from '@/stores/settings';
import { shouldTriggerAlertChannel } from '@/lib/alertPolicy';

/**
 * Plays an audio alert when new orchestrator items appear.
 * Deduplicates by item ID to prevent repeat sounds.
 * Only plays when audio is enabled.
 */
export function useAudioAlerts() {
  const items = useOrchestratorStore((s) => s.items);
  const alertSettings = useSettingsStore((s) => s.alertSettings);
  const seen = useRef<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playFallbackBeep = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const ctx = audioContextRef.current;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.value = 0.05;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.15);
    } catch {
      // Ignore audio failures
    }
  }, []);

  // Initialize audio element
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Create audio element with notification sound
    const audio = new Audio('/sounds/notification.mp3');
    audio.volume = 0.5;
    audio.onerror = () => {
      audioRef.current = null;
    };
    audioRef.current = audio;

    return () => {
      audioRef.current = null;
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!alertSettings.audio.enabled) return;
    if (!audioRef.current) return;

    let shouldPlay = false;

    for (const item of items) {
      // Skip dismissed items
      if (item.dismissedAt) continue;
      // Skip idled items
      if (item.idledAt) continue;
      // Skip already alerted items
      if (seen.current.has(item.id)) continue;

      const provider = item.sessionProvider || 'unknown';
      const eventType =
        item.source === 'approval'
          ? 'approvals'
          : item.source === 'snapshot'
            ? 'snapshot_action'
            : item.sessionStatus === 'WAITING_FOR_INPUT'
              ? 'waiting_input'
              : item.sessionStatus === 'WAITING_FOR_APPROVAL'
                ? 'waiting_approval'
                : item.sessionStatus === 'ERROR'
                  ? 'error'
                  : null;
      if (!eventType) continue;
      const isFocused = typeof document !== 'undefined' ? document.hasFocus() : true;
      if (!shouldTriggerAlertChannel(alertSettings, 'audio', eventType, provider, isFocused)) {
        continue;
      }
      seen.current.add(item.id);
      shouldPlay = true;
    }

    // Play sound once if we found any new items
    if (shouldPlay) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.volume = alertSettings.audio.volume ?? 0.5;
        audioRef.current.play().catch(() => {
          playFallbackBeep();
        });
      } else {
        playFallbackBeep();
      }
    }
  }, [items, alertSettings, playFallbackBeep]);
}
