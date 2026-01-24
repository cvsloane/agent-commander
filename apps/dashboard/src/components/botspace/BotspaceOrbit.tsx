'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionUsageSummary } from '@agent-command/schema';
import type { ToolEvent } from '@/lib/api';
import {
  deleteSession,
  getProjects,
  getSessionEvents,
  getSessionUsageLatest,
  getToolEvents,
  sendCommand,
  spawnSession,
} from '@/lib/api';
import { parseWorkshopEventFromEvent } from '@/lib/workshop/events';
import type { WorkshopEvent } from '@/lib/workshop/types';
import { getToolContext } from '@/lib/workshop/toolContext';
import { DRAW_COLORS } from '@/lib/workshop/draw';
import { getModuleForTool, MODULE_POSITIONS } from '@/lib/botspace/moduleMap';
import { getNotificationForTool, type ZoneNotification } from '@/lib/workshop/notifications';
import type { PlatformCoord } from '@/lib/botspace/platformGrid';
import { getToolIcon } from '@/lib/workshop/toolIcons';
import { useWorkshopSessions } from '@/components/botspace/hooks/useWorkshopSessions';
import { useWorkshopEventStream } from '@/components/botspace/hooks/useWorkshopEventStream';
import { useVisualizerStateStore } from '@/stores/visualizerState';
import { VisualizerApprovals } from '@/components/visualizer/shared/VisualizerApprovals';
import { FeedPanel } from './ui/FeedPanel';
import { DrawPalette } from '@/components/botspace/ui/DrawPalette';
import { ContextMenu, type ContextMenuItem } from '@/components/botspace/ui/ContextMenu';
import { OrbitInfoModal, type OrbitInfoStats } from './ui/OrbitInfoModal';
import { OrbitCommandModal } from './ui/OrbitCommandModal';
import { OrbitScene, type SessionVizState, type ToolHistoryItem, type OrbitSceneHandle, ORBIT_COLORS } from './scene/OrbitScene';
import { useSpatialAudio } from '@/hooks/useSpatialAudio';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import type { PaintedPlatform } from '@/stores/visualizerState';

const MAX_EVENTS = 400;
const MAX_HISTORY = 3;
const NOTIFICATION_DURATION = 3000;
const MAX_NOTIFICATIONS = 20;
const NOTIFICATION_THROTTLE_MS = 500;

function extractFilePaths(toolInput?: Record<string, unknown>): string[] {
  if (!toolInput) return [];
  const paths: string[] = [];
  const pick = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) paths.push(value);
  };

  pick(toolInput.file_path);
  pick(toolInput.path);
  pick(toolInput.filePath);
  pick(toolInput.filepath);
  pick(toolInput.target);
  pick(toolInput.source);

  const listCandidates = [toolInput.paths, toolInput.files, toolInput.file_paths];
  listCandidates.forEach((candidate) => {
    if (Array.isArray(candidate)) {
      candidate.forEach((entry) => {
        if (typeof entry === 'string') {
          pick(entry);
        } else if (entry && typeof entry === 'object') {
          pick((entry as any).path);
          pick((entry as any).file_path);
          pick((entry as any).filePath);
        }
      });
    }
  });

  return paths;
}

type PromptStatus = { type: 'idle' | 'success' | 'error'; message?: string };

type VoiceState = {
  status: 'idle' | 'recording' | 'error';
  transcript: string;
  interim: string;
  bars: number[];
  error?: string;
};

type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  context: Record<string, unknown>;
};

type TextLabelState = {
  platform: PlatformCoord;
  title: string;
  initialText?: string;
  tileId?: string;
};

export function BotspaceOrbit() {
  const sessions = useWorkshopSessions();
  const {
    selectedSessionId,
    setSelectedSessionId,
    cameraMode,
    draw,
    paintedHexes,
    setPaintedHexes,
    textTiles,
    soundEnabled,
    soundVolume,
    setSoundEnabled,
    setSoundVolume,
    stationPanelsEnabled,
    toggleStationPanels,
  } = useVisualizerStateStore();

  // Convert painted hexes to platforms (reuse the same storage)
  const paintedPlatforms = useMemo(() => {
    return paintedHexes.map(h => ({ x: h.q, y: h.r, color: h.color, height: h.height }));
  }, [paintedHexes]);

  const [sessionEvents, setSessionEvents] = useState<Record<string, WorkshopEvent[]>>({});
  const [sessionStates, setSessionStates] = useState<Record<string, SessionVizState>>({});
  const [sessionStats, setSessionStats] = useState<Record<string, OrbitInfoStats>>({});
  const [sendToTmux, setSendToTmux] = useState(true);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [promptStatus, setPromptStatus] = useState<PromptStatus>({ type: 'idle' });
  const [notifications, setNotifications] = useState<ZoneNotification[]>([]);
  const [usageMap, setUsageMap] = useState<Record<string, SessionUsageSummary>>({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    items: [],
    context: {},
  });
  const [orbitInfoSessionId, setOrbitInfoSessionId] = useState<string | null>(null);
  const [orbitCommandSession, setOrbitCommandSession] = useState<{
    sessionId: string;
    target: { x: number; y: number };
  } | null>(null);
  const [preferredAssignments, setPreferredAssignments] = useState<Record<string, PlatformCoord>>({});
  const [pendingSpawnPlatform, setPendingSpawnPlatform] = useState<PlatformCoord | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>({
    status: 'idle',
    transcript: '',
    interim: '',
    bars: Array.from({ length: 10 }, () => 8),
  });
  const [userChangedCamera, setUserChangedCamera] = useState(false);
  const [hoverPlatform, setHoverPlatform] = useState<PlatformCoord | null>(null);
  const [textLabelModal, setTextLabelModal] = useState<TextLabelState | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const hoverPlatformRef = useRef<PlatformCoord | null>(null);
  const notifiedRef = useRef<Map<string, string>>(new Map());
  const notificationTimers = useRef<Map<string, number>>(new Map());
  const lastNotificationTimeRef = useRef<Record<string, number>>({});
  const loadedSessionsRef = useRef<Set<string>>(new Set());
  const workshopEventSessionsRef = useRef<Set<string>>(new Set());
  const sceneRef = useRef<OrbitSceneHandle | null>(null);
  const voiceOriginalPromptRef = useRef('');

  const { playSound } = useSpatialAudio({ enabled: soundEnabled, volume: soundVolume });

  useEffect(() => {
    hoverPlatformRef.current = hoverPlatform;
  }, [hoverPlatform]);

  useEffect(() => {
    setVoiceSupported(
      typeof navigator !== 'undefined' &&
        !!navigator.mediaDevices?.getUserMedia
    );
  }, []);

  const upsertWorkshopEvent = useCallback((event: WorkshopEvent) => {
    setSessionEvents((prev) => {
      const next = { ...prev };
      const list = next[event.sessionId] ? [...next[event.sessionId]] : [];
      const existing = list.findIndex((e) => e.id === event.id);
      if (existing === -1) {
        list.push(event);
      } else {
        list[existing] = event;
      }
      list.sort((a, b) => a.timestamp - b.timestamp);
      next[event.sessionId] = list.slice(-MAX_EVENTS);
      return next;
    });
  }, []);

  const toolEventToWorkshopEvents = useCallback((event: ToolEvent): WorkshopEvent[] => {
    const parseTs = (value?: string) => {
      if (!value) return NaN;
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? NaN : parsed;
    };
    const startedAt = parseTs(event.started_at);
    const completedAt = parseTs(event.completed_at);
    const startTs = Number.isNaN(startedAt) ? Date.now() : startedAt;
    const endTs = Number.isNaN(completedAt)
      ? startTs + (event.duration_ms ?? 0)
      : completedAt;
    const base = {
      sessionId: event.session_id,
      provider: event.provider,
    };
    const pre: WorkshopEvent = {
      ...base,
      id: `tool-${event.id}-pre`,
      timestamp: startTs,
      type: 'pre_tool_use',
      tool: event.tool_name,
      toolInput: event.tool_input,
      toolUseId: event.id,
    };
    const post: WorkshopEvent = {
      ...base,
      id: `tool-${event.id}-post`,
      timestamp: endTs,
      type: 'post_tool_use',
      tool: event.tool_name,
      toolInput: event.tool_input,
      toolResponse: event.tool_output,
      toolUseId: event.id,
      success: event.success,
      duration: event.duration_ms,
    };
    return [pre, post];
  }, []);

  const sessionColors = useMemo(() => {
    const map = new Map<string, string>();
    sessions.forEach((session, index) => {
      map.set(session.id, ORBIT_COLORS[index % ORBIT_COLORS.length]);
    });
    return map;
  }, [sessions]);

  useEffect(() => {
    if (selectedSessionId && sessions.length > 0) {
      const exists = sessions.some((s) => s.id === selectedSessionId);
      if (!exists) {
        setSelectedSessionId(null);
      }
    }
  }, [selectedSessionId, sessions, setSelectedSessionId]);

  useEffect(() => {
    if (sessions.length === 0) return;
    setPreferredAssignments((prev) => {
      const next: Record<string, PlatformCoord> = {};
      sessions.forEach((session) => {
        if (prev[session.id]) {
          next[session.id] = prev[session.id];
        }
      });
      return next;
    });
  }, [sessions]);

  // Prune state for sessions that no longer exist
  useEffect(() => {
    if (sessions.length === 0) return;
    const sessionIds = new Set(sessions.map((s) => s.id));

    setSessionEvents((prev) => {
      const next: Record<string, WorkshopEvent[]> = {};
      for (const id of Object.keys(prev)) {
        if (sessionIds.has(id)) next[id] = prev[id];
      }
      return next;
    });

    setSessionStates((prev) => {
      const next: Record<string, SessionVizState> = {};
      for (const id of Object.keys(prev)) {
        if (sessionIds.has(id)) next[id] = prev[id];
      }
      return next;
    });

    setSessionStats((prev) => {
      const next: Record<string, OrbitInfoStats> = {};
      for (const id of Object.keys(prev)) {
        if (sessionIds.has(id)) next[id] = prev[id];
      }
      return next;
    });

    const times = lastNotificationTimeRef.current;
    for (const id of Object.keys(times)) {
      if (!sessionIds.has(id)) delete times[id];
    }
  }, [sessions]);

  useEffect(() => {
    let cancelled = false;
    sessions.forEach((session) => {
      if (loadedSessionsRef.current.has(session.id)) return;
      loadedSessionsRef.current.add(session.id);
      getSessionEvents(session.id)
        .then(({ events }) => {
          if (cancelled) return;
          const parsed = events
            .map((event) => parseWorkshopEventFromEvent(event))
            .filter((event): event is WorkshopEvent => !!event)
            .slice(-MAX_EVENTS);
          if (parsed.length > 0) {
            workshopEventSessionsRef.current.add(session.id);
            setSessionEvents((prev) => ({ ...prev, [session.id]: parsed }));
            return;
          }
          getToolEvents(session.id)
            .then(({ events: toolEvents }) => {
              if (cancelled) return;
              const synthetic = toolEvents
                .flatMap((toolEvent) => toolEventToWorkshopEvents(toolEvent))
                .sort((a, b) => a.timestamp - b.timestamp)
                .slice(-MAX_EVENTS);
              if (synthetic.length > 0) {
                setSessionEvents((prev) => ({ ...prev, [session.id]: synthetic }));
              }
            })
            .catch(() => {});
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [sessions, toolEventToWorkshopEvents]);

  useEffect(() => {
    if (sessions.length > 1 && !userChangedCamera) {
      useVisualizerStateStore.getState().setCameraMode('overview');
      if (selectedSessionId) {
        setSelectedSessionId(null);
      }
    }
  }, [sessions.length, selectedSessionId, setSelectedSessionId, userChangedCamera]);

  useEffect(() => {
    if (sessions.length === 1 && !userChangedCamera && !selectedSessionId) {
      setSelectedSessionId(sessions[0]?.id || null);
      useVisualizerStateStore.getState().setCameraMode('focused');
    }
  }, [sessions, selectedSessionId, userChangedCamera, setSelectedSessionId]);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((notification) => notification.id !== id));
    const timer = notificationTimers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      notificationTimers.current.delete(id);
    }
  }, []);

  const addNotification = useCallback(
    (sessionId: string, tool: string, text: string) => {
      const now = Date.now();
      const lastTime = lastNotificationTimeRef.current[sessionId] || 0;
      if (now - lastTime < NOTIFICATION_THROTTLE_MS) return;
      lastNotificationTimeRef.current[sessionId] = now;

      const { style, icon } = getNotificationForTool(tool);
      const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setNotifications((prev) => {
        const slot = prev.filter((notification) => notification.sessionId === sessionId).length;
        const newArray = [
          ...prev,
          {
            id,
            sessionId,
            text,
            style,
            icon,
            createdAt: performance.now(),
            duration: NOTIFICATION_DURATION,
            slot,
          },
        ];
        return newArray.slice(-MAX_NOTIFICATIONS);
      });
      const timer = window.setTimeout(() => removeNotification(id), NOTIFICATION_DURATION + 50);
      notificationTimers.current.set(id, timer);
    },
    [removeNotification]
  );

  useEffect(() => {
    const timers = notificationTimers.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const applyWorkshopEvent = useCallback(
    (event: WorkshopEvent) => {
      workshopEventSessionsRef.current.add(event.sessionId);
      upsertWorkshopEvent(event);

      setSessionStates((prev) => {
        const current = prev[event.sessionId] || { status: 'idle' };
        const next = { ...current } as SessionVizState;

        if (event.type === 'user_prompt_submit') {
          next.status = 'thinking';
        }

        if (event.type === 'pre_tool_use') {
          next.status = 'working';
          next.currentTool = event.tool;
          next.toolContext = getToolContext(event.tool, event.toolInput, event.cwd || undefined);
          next.lastToolAt = event.timestamp;
          next.highlightUntil = event.timestamp + 1500;
          const toolModule = getModuleForTool(event.tool);
          const offset = MODULE_POSITIONS[toolModule] || [0, 0, 0];
          playSound(event.tool, [offset[0], offset[1], offset[2]]);
          if (event.tool === 'Task') {
            next.subagents = (next.subagents || 0) + 1;
          }
        }

        if (event.type === 'post_tool_use') {
          next.status = 'thinking';
          next.lastToolAt = event.timestamp;
          const toolModule = getModuleForTool(event.tool);
          const context = getToolContext(event.tool, event.toolInput, event.cwd || undefined) || event.tool;
          const history = next.moduleHistory?.[toolModule] ? [...next.moduleHistory[toolModule]!] : [];
          history.push({
            text: context,
            success: event.success ?? true,
            timestamp: event.timestamp,
          } as ToolHistoryItem);
          if (history.length > MAX_HISTORY) {
            history.splice(0, history.length - MAX_HISTORY);
          }
          next.moduleHistory = {
            ...(next.moduleHistory || {}),
            [toolModule]: history,
          };
          addNotification(event.sessionId, event.tool, context);
          const sessionId = event.sessionId;
          setTimeout(() => {
            setSessionStates((state) => {
              const latest = state[sessionId];
              if (!latest) return state;
              if (latest.status !== 'thinking') return state;
              return { ...state, [sessionId]: { ...latest, currentTool: null, toolContext: null } };
            });
          }, 1500);
        }

        if (event.type === 'stop') {
          next.status = 'finished';
          next.highlightUntil = event.timestamp + 3000;
          next.currentTool = null;
          next.toolContext = null;
          const sessionId = event.sessionId;
          setTimeout(() => {
            setSessionStates((state) => {
              const latest = state[sessionId];
              if (!latest || latest.status !== 'finished') return state;
              return { ...state, [sessionId]: { ...latest, status: 'idle' } };
            });
          }, 4000);
        }

        if (event.type === 'subagent_stop') {
          next.subagents = Math.max(0, (next.subagents || 1) - 1);
        }

        if (event.type === 'notification' && event.message) {
          addNotification(event.sessionId, event.notificationType || 'Notification', event.message);
        }

        return { ...prev, [event.sessionId]: next };
      });

      setSessionStats((prev) => {
        const current = prev[event.sessionId] || { toolsUsed: 0, filesTouched: [], activeSubagents: 0 };
        const files = new Set(current.filesTouched);
        let toolsUsed = current.toolsUsed;
        let activeSubagents = current.activeSubagents;

        if (event.type === 'post_tool_use') {
          toolsUsed += 1;
          extractFilePaths(event.toolInput).forEach((path) => files.add(path));
        }

        if (event.type === 'pre_tool_use' && event.tool === 'Task') {
          activeSubagents += 1;
        }

        if (event.type === 'subagent_stop') {
          activeSubagents = Math.max(0, activeSubagents - 1);
        }

        return {
          ...prev,
          [event.sessionId]: {
            toolsUsed,
            filesTouched: Array.from(files),
            activeSubagents,
            currentTool: event.type === 'pre_tool_use' ? event.tool : current.currentTool,
          },
        };
      });
    },
    [addNotification, playSound, upsertWorkshopEvent]
  );

  const applyToolEvent = useCallback((event: ToolEvent, phase: 'started' | 'completed') => {
    if (!workshopEventSessionsRef.current.has(event.session_id)) {
      const synthetic = toolEventToWorkshopEvents(event);
      const toApply = phase === 'started' ? [synthetic[0]] : [synthetic[1]];
      toApply.forEach(upsertWorkshopEvent);
    }
    setSessionStates((prev) => {
      const current = prev[event.session_id] || { status: 'idle' };
      if (phase === 'started') {
        return {
          ...prev,
          [event.session_id]: {
            ...current,
            status: 'working',
            currentTool: event.tool_name,
            toolContext: getToolContext(event.tool_name, event.tool_input),
            lastToolAt: Date.now(),
          },
        };
      }
      const sessionId = event.session_id;
      const toolModule = getModuleForTool(event.tool_name);
      const context = getToolContext(event.tool_name, event.tool_input) || event.tool_name;
      addNotification(event.session_id, event.tool_name, context);
      setTimeout(() => {
        setSessionStates((state) => {
          const latest = state[sessionId];
          if (!latest || latest.status !== 'thinking') return state;
          return { ...state, [sessionId]: { ...latest, currentTool: null, toolContext: null } };
        });
      }, 1500);
      return {
        ...prev,
        [event.session_id]: {
          ...current,
          status: 'thinking',
          moduleHistory: {
            ...(current.moduleHistory || {}),
            [toolModule]: [
              ...((current.moduleHistory && current.moduleHistory[toolModule]) || []).slice(-MAX_HISTORY + 1),
              {
                text: context,
                success: event.success ?? true,
                timestamp: Date.now(),
              } as ToolHistoryItem,
            ],
          },
        },
      };
    });

    if (phase === 'completed') {
      setSessionStats((prev) => {
        const current = prev[event.session_id] || { toolsUsed: 0, filesTouched: [], activeSubagents: 0 };
        const files = new Set(current.filesTouched);
        extractFilePaths(event.tool_input || undefined).forEach((path) => files.add(path));
        return {
          ...prev,
          [event.session_id]: {
            ...current,
            toolsUsed: current.toolsUsed + 1,
            filesTouched: Array.from(files),
          },
        };
      });
    }
  }, [addNotification, toolEventToWorkshopEvents, upsertWorkshopEvent]);

  useWorkshopEventStream(applyWorkshopEvent, applyToolEvent);

  useWebSocket(
    [{ type: 'session_usage' }],
    useCallback((message) => {
      if (message.type !== 'session_usage.updated') return;
      const payload = message.payload as SessionUsageSummary;
      setUsageMap((prev) => ({ ...prev, [payload.session_id]: payload }));
    }, [])
  );

  useEffect(() => {
    if (sessions.length === 0) return;
    const ids = sessions.map((session) => session.id);
    getSessionUsageLatest(ids)
      .then(({ usage }) => {
        const map: Record<string, SessionUsageSummary> = {};
        usage.forEach((item) => {
          map[item.session_id] = item;
        });
        setUsageMap(map);
      })
      .catch(() => {});
  }, [sessions]);

  useEffect(() => {
    const needsAttention = sessions.filter(
      (s) => s.status === 'WAITING_FOR_INPUT' || s.status === 'WAITING_FOR_APPROVAL' || s.status === 'ERROR'
    );
    if (needsAttention.length > 0) {
      document.title = `(${needsAttention.length}) Botspace Station`;
    } else {
      document.title = 'Botspace Station';
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      const notified = notifiedRef.current;
      for (const session of sessions) {
        const status = session.status;
        const attention =
          status === 'WAITING_FOR_INPUT' ||
          status === 'WAITING_FOR_APPROVAL' ||
          status === 'ERROR';
        if (!attention) {
          notified.delete(session.id);
          continue;
        }
        const lastStatus = notified.get(session.id);
        if (lastStatus !== status) {
          new Notification('Botspace Attention', {
            body: `${session.title || session.cwd || 'Orbit'} is ${status.toLowerCase().replace(/_/g, ' ')}`,
          });
          notified.set(session.id, status);
        }
      }
    }
  }, [sessions]);

  const handleSendPrompt = useCallback(
    async (promptText: string, send: boolean) => {
      if (!selectedSessionId) return;
      if (!send) return;
      try {
        await sendCommand(selectedSessionId, {
          type: 'send_input',
          payload: { text: promptText, enter: true },
        });
        setPromptStatus({ type: 'success', message: 'Sent' });
      } catch (error) {
        setPromptStatus({ type: 'error', message: 'Failed to send' });
      } finally {
        setTimeout(() => setPromptStatus({ type: 'idle' }), 2000);
      }
    },
    [selectedSessionId]
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, open: false }));
  }, []);

  const openContextMenu = useCallback((state: Omit<ContextMenuState, 'open'>) => {
    setContextMenu({ ...state, open: true });
  }, []);

  const openOrbitCommand = useCallback((sessionId: string) => {
    const target = sceneRef.current?.getOrbitScreenPosition(sessionId);
    if (!target) return;
    setOrbitCommandSession({ sessionId, target });
  }, []);

  const handleContextMenuAction = useCallback(
    async (action: string) => {
      const ctx = contextMenu.context as Record<string, unknown>;
      if (action === 'create' && ctx.platform) {
        setPendingSpawnPlatform(ctx.platform as PlatformCoord);
        setShowNewSession(true);
      }
      if (action === 'command' && ctx.sessionId) {
        openOrbitCommand(ctx.sessionId as string);
      }
      if (action === 'info' && ctx.sessionId) {
        setOrbitInfoSessionId(ctx.sessionId as string);
      }
      if (action === 'delete' && ctx.sessionId) {
        try {
          await deleteSession(ctx.sessionId as string);
        } catch {
          // ignore
        }
      }
      if (action === 'create_text_tile' && ctx.platform) {
        setTextLabelModal({ platform: ctx.platform as PlatformCoord, title: 'Add Label' });
      }
      if (action === 'edit_text_tile' && ctx.textTileId) {
        const tile = textTiles.find((t) => t.id === (ctx.textTileId as string));
        if (tile) {
          setTextLabelModal({
            platform: { x: tile.q, y: tile.r },
            title: 'Edit Label',
            initialText: tile.text,
            tileId: tile.id,
          });
        }
      }
      if (action === 'delete_text_tile' && ctx.textTileId) {
        useVisualizerStateStore.getState().removeTextTile(ctx.textTileId as string);
      }

      closeContextMenu();
    },
    [closeContextMenu, contextMenu.context, openOrbitCommand, textTiles]
  );

  const handleSelectSession = useCallback(
    (sessionId: string | null) => {
      setSelectedSessionId(sessionId);
      setUserChangedCamera(true);
      if (sessionId) {
        useVisualizerStateStore.getState().setCameraMode('focused');
      } else {
        useVisualizerStateStore.getState().setCameraMode('overview');
      }
    },
    [setSelectedSessionId]
  );

  const handleUserCameraControl = useCallback(() => {
    setUserChangedCamera(true);
    const store = useVisualizerStateStore.getState();
    if (store.cameraMode !== 'overview') {
      store.setCameraMode('overview');
      setSelectedSessionId(null);
    }
  }, [setSelectedSessionId]);

  const handleFloorContextMenu = useCallback(
    (payload: { platform: PlatformCoord; screenX: number; screenY: number; world: { x: number; z: number } }) => {
      const existingTile = textTiles.find((tile) => tile.q === payload.platform.x && tile.r === payload.platform.y);
      if (existingTile) {
        openContextMenu({
          x: payload.screenX,
          y: payload.screenY,
          items: [
            { key: 'E', label: `Edit "${existingTile.text}"`, action: 'edit_text_tile' },
            { key: 'D', label: 'Delete label', action: 'delete_text_tile', danger: true },
          ],
          context: { textTileId: existingTile.id },
        });
        return;
      }

      openContextMenu({
        x: payload.screenX,
        y: payload.screenY,
        items: [
          { key: 'C', label: 'Create orbit', action: 'create' },
          { key: 'T', label: 'Add text label', action: 'create_text_tile' },
        ],
        context: { platform: payload.platform, worldPosition: payload.world },
      });
    },
    [openContextMenu, textTiles]
  );

  const handleOrbitContextMenu = useCallback(
    (payload: { sessionId: string; screenX: number; screenY: number }) => {
      const session = sessions.find((s) => s.id === payload.sessionId);
      const orbitName = session?.title || session?.cwd?.split('/').pop() || payload.sessionId.slice(0, 8);
      openContextMenu({
        x: payload.screenX,
        y: payload.screenY,
        items: [
          { key: 'C', label: 'Command', action: 'command' },
          { key: 'I', label: 'Info', action: 'info' },
          { key: 'D', label: `Dismiss "${orbitName}"`, action: 'delete', danger: true },
        ],
        context: { sessionId: payload.sessionId },
      });
    },
    [openContextMenu, sessions]
  );

  const handleInterrupt = useCallback(async () => {
    if (!selectedSessionId) return;
    await sendCommand(selectedSessionId, { type: 'interrupt', payload: {} });
  }, [selectedSessionId]);

  const handlePaintPlatform = useCallback(
    (platforms: PlatformCoord[], color: string | null) => {
      // Convert to hex format for storage compatibility
      const current = [...paintedHexes];
      const map = new Map(current.map((h) => [`${h.q},${h.r}`, h]));
      for (const platform of platforms) {
        const key = `${platform.x},${platform.y}`;
        if (!color) {
          map.delete(key);
          continue;
        }
        const existing = map.get(key);
        if (existing && draw.is3DMode && existing.color === color) {
          map.set(key, { ...existing, height: existing.height + 1 });
        } else {
          map.set(key, { q: platform.x, r: platform.y, color, height: 1 });
        }
      }
      setPaintedHexes(Array.from(map.values()));
    },
    [paintedHexes, draw.is3DMode, setPaintedHexes]
  );

  const {
    isListening,
    isConnecting,
    transcript,
    interimTranscript,
    error: voiceError,
    startListening,
    stopListening,
    clearTranscript,
  } = useVoiceInput({
    onSpectrum: (levels) => {
      setVoiceState((prev) => ({
        ...prev,
        bars: levels.map((level) => 8 + level * 28),
      }));
    },
  });

  const startVoice = useCallback(async () => {
    if (!voiceSupported) return;
    voiceOriginalPromptRef.current = prompt;
    await startListening();
  }, [prompt, startListening, voiceSupported]);

  const stopVoice = useCallback(() => {
    stopListening();
    clearTranscript();
    setVoiceState((prev) => ({ ...prev, bars: prev.bars.map(() => 8) }));
  }, [clearTranscript, stopListening]);

  const toggleVoice = useCallback(() => {
    if (isListening || isConnecting) {
      stopVoice();
    } else {
      startVoice();
    }
  }, [isConnecting, isListening, startVoice, stopVoice]);

  useEffect(() => {
    setVoiceState((prev) => ({
      ...prev,
      status: voiceError ? 'error' : isListening || isConnecting ? 'recording' : 'idle',
      transcript,
      interim: interimTranscript,
      error: voiceError || undefined,
    }));
  }, [interimTranscript, isConnecting, isListening, transcript, voiceError]);

  useEffect(() => {
    if (!isListening && !isConnecting) return;
    const combined = [voiceOriginalPromptRef.current, transcript, interimTranscript]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (combined) {
      setPrompt(combined);
    }
  }, [interimTranscript, isConnecting, isListening, transcript]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const inInput = activeTag === 'textarea' || activeTag === 'input';

      if ((isListening || isConnecting) && event.key === 'Escape') {
        event.preventDefault();
        stopVoice();
        return;
      }

      if ((isListening || isConnecting) && event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        stopVoice();
        if (prompt.trim()) {
          handleSendPrompt(prompt, sendToTmux);
          setPrompt('');
        }
        return;
      }

      if (event.ctrlKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        toggleVoice();
        return;
      }

      if (event.ctrlKey && event.key.toLowerCase() === 'c' && !event.shiftKey && !event.altKey) {
        const selection = window.getSelection()?.toString() || '';
        if (!selection && selectedSessionId && sessionStates[selectedSessionId]?.status === 'working') {
          event.preventDefault();
          handleInterrupt();
        }
        return;
      }

      if (event.key === 'Tab') {
        const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement | null;
        if (inInput) {
          (document.activeElement as HTMLElement)?.blur();
        } else {
          promptInput?.focus();
        }
        return;
      }

      if (!inInput) {
        if (event.key === 'd' || event.key === 'D') {
          useVisualizerStateStore.getState().toggleDraw();
        }
        if (event.key === 'Escape') {
          useVisualizerStateStore.getState().exitDraw();
        }
        if (event.key === 'p' || event.key === 'P') {
          toggleStationPanels();
        }
        if (event.key === 'f' || event.key === 'F') {
          const store = useVisualizerStateStore.getState();
          store.setCameraMode(store.cameraMode === 'follow-active' ? 'focused' : 'follow-active');
          setUserChangedCamera(true);
        }
        if (event.altKey && (event.key === 'n' || event.key === 'N')) {
          setPendingSpawnPlatform(null);
          setShowNewSession(true);
        }
        if (event.altKey && (event.key === 'l' || event.key === 'L')) {
          if (hoverPlatformRef.current) {
            setTextLabelModal({ platform: hoverPlatformRef.current, title: 'Add Label' });
          }
        }
        if (event.key === '0' || event.key === '`') {
          useVisualizerStateStore.getState().setCameraMode('overview');
          setSelectedSessionId(null);
          setUserChangedCamera(true);
        }
        if (event.key >= '1' && event.key <= '6') {
          const idx = parseInt(event.key, 10) - 1;
          const session = sessions[idx];
          if (session) {
            handleSelectSession(session.id);
          }
        }
      }

      if (draw.enabled) {
        const colorIndex = DRAW_COLORS.findIndex((c) => c.key === event.key);
        if (colorIndex >= 0) {
          useVisualizerStateStore.getState().selectColor(colorIndex);
        }
        if (event.key === '0') {
          useVisualizerStateStore.getState().selectEraser();
        }
        if (event.key === 'q' || event.key === 'Q') {
          useVisualizerStateStore.getState().decreaseBrush();
        }
        if (event.key === 'e' || event.key === 'E') {
          useVisualizerStateStore.getState().increaseBrush();
        }
        if (event.key === 'r' || event.key === 'R') {
          useVisualizerStateStore.getState().toggle3DMode();
        }
        if (event.key === 'x' || event.key === 'X' || event.key === 'Backspace') {
          useVisualizerStateStore.getState().clearPaintedHexes();
        }
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [draw.enabled, handleInterrupt, handleSelectSession, handleSendPrompt, isConnecting, isListening, prompt, selectedSessionId, sendToTmux, sessions, stopVoice, toggleStationPanels, setSelectedSessionId, toggleVoice, sessionStates]);

  const effectiveSessionStates = useMemo(() => {
    const next: Record<string, SessionVizState> = { ...sessionStates };
    sessions.forEach((session) => {
      const current = next[session.id];
      let fallback: SessionVizState['status'] = 'idle';
      if (session.status === 'RUNNING' || session.status === 'STARTING') {
        fallback = 'working';
      } else if (session.status === 'WAITING_FOR_INPUT' || session.status === 'WAITING_FOR_APPROVAL') {
        fallback = 'thinking';
      } else if (session.status === 'ERROR' || session.status === 'DONE') {
        fallback = 'finished';
      }
      if (!current || current.status === 'idle') {
        next[session.id] = { ...(current || { status: fallback }), status: fallback };
      }
    });
    return next;
  }, [sessionStates, sessions]);

  const eventsForFeed = useMemo(() => {
    const list = selectedSessionId
      ? sessionEvents[selectedSessionId] || []
      : Object.values(sessionEvents).flat();
    const sorted = [...list].sort((a, b) => a.timestamp - b.timestamp);
    return sorted.slice(-MAX_EVENTS);
  }, [selectedSessionId, sessionEvents]);

  const voiceTranscript = useMemo(() => {
    if (voiceState.status !== 'recording' && voiceState.status !== 'error') {
      return { visible: false, text: '', interim: false };
    }
    const text = voiceState.interim || voiceState.transcript || voiceState.error || '';
    return { visible: true, text, interim: !!voiceState.interim };
  }, [voiceState]);

  const timelineItems = useMemo(() => {
    const map = new Map<string, { tool: string; success?: boolean; timestamp: number }>();
    for (const event of eventsForFeed) {
      if (event.type === 'pre_tool_use') {
        map.set(event.toolUseId || event.id, {
          tool: event.tool,
          success: undefined,
          timestamp: event.timestamp,
        });
      }
      if (event.type === 'post_tool_use') {
        map.set(event.toolUseId || event.id, {
          tool: event.tool,
          success: event.success,
          timestamp: event.timestamp,
        });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-12);
  }, [eventsForFeed]);

  const usageForSelected = selectedSessionId ? usageMap[selectedSessionId] : undefined;
  const totalTokens = usageForSelected?.total_tokens ?? usageForSelected?.input_tokens ?? 0;

  const attentionCount = sessions.filter(
    (s) => s.status === 'WAITING_FOR_INPUT' || s.status === 'WAITING_FOR_APPROVAL' || s.status === 'ERROR'
  ).length;
  const hasWorking = Object.values(effectiveSessionStates).some(
    (state) => state.status === 'working' || state.status === 'thinking'
  );
  const hasRunning = sessions.some((s) => s.status === 'RUNNING');
  const statusDotClass = hasWorking ? 'working' : hasRunning ? 'connected' : '';
  const statusText = hasWorking ? 'Working' : hasRunning ? 'Connected' : 'Offline';

  return (
    <>
      <div id="scene-panel">
        <div id="canvas-container">
          <OrbitScene
            ref={sceneRef}
            sessions={sessions}
            sessionStates={effectiveSessionStates}
            selectedSessionId={selectedSessionId}
            onSelectSession={(id) => handleSelectSession(id)}
            cameraMode={cameraMode}
            paintedPlatforms={paintedPlatforms}
            textTiles={textTiles}
            notifications={notifications}
            preferredAssignments={preferredAssignments}
            drawEnabled={draw.enabled}
            drawBrushSize={draw.brushSize}
            drawColor={draw.isEraser ? null : DRAW_COLORS[draw.selectedColorIndex]?.hex}
            drawIs3D={draw.is3DMode}
            onPaintPlatform={handlePaintPlatform}
            modulePanelsEnabled={stationPanelsEnabled}
            onHoverPlatformChange={setHoverPlatform}
            onFloorContextMenu={handleFloorContextMenu}
            onOrbitContextMenu={handleOrbitContextMenu}
            onUserCameraControl={handleUserCameraControl}
          />
        </div>

        <div id="scene-hud">
          <div className="scene-badge unified-hud">
            <div
              id="status-dot"
              className={statusDotClass}
            />
            <a href="/" className="hud-link" title="Back to console">
              Console
            </a>
            <span id="username" className="hud-user">Agent</span>
            <span id="status-text">{statusText}</span>
            <span className="hud-sep">|</span>
            <span id="token-counter" className="hud-tokens" title="Tokens used this session">
              {totalTokens ?? 0} tok
            </span>
            <span className="hud-sep">|</span>
            <button
              className={`hud-btn ${cameraMode === 'overview' ? 'active' : ''}`}
              title="Overview camera"
              type="button"
              onClick={() => {
                useVisualizerStateStore.getState().setCameraMode('overview');
                setSelectedSessionId(null);
                setUserChangedCamera(true);
              }}
            >
              Overview
            </button>
            <button
              id="settings-btn"
              className="hud-btn"
              title="Settings"
              type="button"
              onClick={() => setShowSettings(true)}
            >
              Settings
            </button>
          </div>
        </div>

        <div id="keybind-helper">
          <div className="keybind-list">
            <span className="keybind">
              <kbd>1-6</kbd> orbits | <kbd>`</kbd><kbd>0</kbd> all | <kbd>Tab</kbd> focus | <kbd>D</kbd> draw
            </span>
          </div>
        </div>

        <div
          id="voice-control"
          className={`voice-control ${voiceState.status === 'recording' ? 'recording' : ''} ${!voiceSupported ? 'disabled' : ''}`}
        >
          <div className="voice-idle">
            <button
              type="button"
              id="voice-btn"
              className="voice-trigger"
              title="Start voice input"
              onClick={toggleVoice}
              disabled={!voiceSupported}
            >
              Voice
            </button>
            <span className="voice-hint"><kbd>Ctrl</kbd><kbd>M</kbd></span>
          </div>
          <div className="voice-recording">
            <div className="voice-bars">
              {voiceState.bars.map((height, idx) => (
                <div key={idx} className="voice-bar" data-bar={idx} style={{ height }} />
              ))}
            </div>
            <div className="voice-status-row">
              <div className="voice-record-dot" />
              <span className="voice-send-hint"><kbd>Enter</kbd> to send</span>
            </div>
          </div>
        </div>

        <div id="draw-indicator" className={draw.enabled ? 'visible' : ''}>
          <span className="draw-mode-label">DRAW MODE</span>
          <span className="draw-mode-hint">
            <kbd>D</kbd> exit | <kbd>X</kbd> clear | <kbd>Q</kbd><kbd>E</kbd> brush | <kbd>R</kbd> 3D
          </span>
        </div>

        <DrawPalette />

        <div id="timeline-container">
          <div id="timeline">
            {timelineItems.map((item, idx) => (
              <div
                key={`${item.tool}-${item.timestamp}-${idx}`}
                className={`timeline-icon ${
                  item.success === undefined ? 'pending' : item.success ? 'success' : 'fail'
                }`}
                title={item.tool}
              >
                {getToolIcon(item.tool)}
              </div>
            ))}
          </div>
        </div>
      </div>

      <FeedPanel
        sessions={sessions}
        sessionStates={effectiveSessionStates}
        selectedSessionId={selectedSessionId}
        events={eventsForFeed}
        sessionColors={sessionColors}
        onSelectSession={(id) => handleSelectSession(id)}
        onSendPrompt={handleSendPrompt}
        onInterrupt={handleInterrupt}
        onToggleNewSession={() => {
          setPendingSpawnPlatform(null);
          setShowNewSession(true);
        }}
        sendToTmux={sendToTmux}
        setSendToTmux={setSendToTmux}
        prompt={prompt}
        setPrompt={setPrompt}
        promptStatus={promptStatus}
        voiceTranscript={voiceTranscript}
        attentionCount={attentionCount}
      />

      {showNewSession && (
        <NewSessionModal
          onClose={() => {
            setShowNewSession(false);
            setPendingSpawnPlatform(null);
          }}
          hostId={sessions.find((s) => s.id === selectedSessionId)?.host_id || sessions[0]?.host_id}
          onCreate={async (cwd, title, flags) => {
            const hostId = sessions.find((s) => s.id === selectedSessionId)?.host_id || sessions[0]?.host_id;
            if (!hostId) return;
            const result = await spawnSession({
              host_id: hostId,
              provider: 'claude_code',
              working_directory: cwd,
              title: title || undefined,
              flags,
            }).catch(() => null);
            if (result?.session && pendingSpawnPlatform) {
              setPreferredAssignments((prev) => ({ ...prev, [result.session.id]: pendingSpawnPlatform }));
              setPendingSpawnPlatform(null);
            }
            setShowNewSession(false);
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          soundEnabled={soundEnabled}
          soundVolume={soundVolume}
          onClose={() => setShowSettings(false)}
          onToggleSound={() => setSoundEnabled(!soundEnabled)}
          onVolumeChange={setSoundVolume}
        />
      )}

      <VisualizerApprovals sessions={sessions} />

      <ContextMenu
        open={contextMenu.open}
        x={contextMenu.x}
        y={contextMenu.y}
        items={contextMenu.items}
        onAction={handleContextMenuAction}
        onClose={closeContextMenu}
      />

      <OrbitInfoModal
        open={!!orbitInfoSessionId}
        session={orbitInfoSessionId ? sessions.find((s) => s.id === orbitInfoSessionId) || null : null}
        stats={
          orbitInfoSessionId
            ? {
                ...sessionStats[orbitInfoSessionId],
                activeSubagents: sessionStates[orbitInfoSessionId]?.subagents ?? sessionStats[orbitInfoSessionId]?.activeSubagents ?? 0,
                currentTool: sessionStates[orbitInfoSessionId]?.currentTool ?? sessionStats[orbitInfoSessionId]?.currentTool,
              }
            : undefined
        }
        usage={orbitInfoSessionId ? usageMap[orbitInfoSessionId] : undefined}
        onClose={() => setOrbitInfoSessionId(null)}
      />

      <OrbitCommandModal
        open={!!orbitCommandSession}
        target={orbitCommandSession?.target || null}
        sessionName={
          orbitCommandSession
            ? sessions.find((s) => s.id === orbitCommandSession.sessionId)?.title ||
              sessions.find((s) => s.id === orbitCommandSession.sessionId)?.cwd?.split('/').pop() ||
              orbitCommandSession.sessionId.slice(0, 8)
            : ''
        }
        sessionColor={
          orbitCommandSession
            ? sessionColors.get(orbitCommandSession.sessionId) || '#F5A623'
            : '#F5A623'
        }
        onSend={async (text) => {
          if (!orbitCommandSession) return false;
          try {
            await sendCommand(orbitCommandSession.sessionId, {
              type: 'send_input',
              payload: { text, enter: true },
            });
            return true;
          } catch {
            return false;
          }
        }}
        onClose={() => setOrbitCommandSession(null)}
      />

      {textLabelModal && (
        <TextLabelModal
          title={textLabelModal.title}
          initialText={textLabelModal.initialText}
          onClose={() => setTextLabelModal(null)}
          onSave={(text) => {
            if (!text.trim()) return;
            if (textLabelModal.tileId) {
              useVisualizerStateStore.getState().updateTextTile(textLabelModal.tileId, { text: text.trim() });
            } else {
              useVisualizerStateStore.getState().addTextTile({
                q: textLabelModal.platform.x,
                r: textLabelModal.platform.y,
                text: text.trim(),
                color: '#CAD3F5',
              });
            }
            setTextLabelModal(null);
          }}
        />
      )}
    </>
  );
}

function NewSessionModal({
  onClose,
  hostId,
  onCreate,
}: {
  onClose: () => void;
  hostId?: string;
  onCreate: (cwd: string, title: string, flags: string[]) => void;
}) {
  const [cwd, setCwd] = useState('');
  const [title, setTitle] = useState('');
  const [continueSession, setContinueSession] = useState(false);
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [chromeMode, setChromeMode] = useState(false);
  const [dirSuggestions, setDirSuggestions] = useState<string[]>([]);
  const [dirOpen, setDirOpen] = useState(false);
  const [dirIndex, setDirIndex] = useState(0);
  const [dirFocused, setDirFocused] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!title && cwd) {
      const parts = cwd.split('/').filter(Boolean);
      const suggestion = parts[parts.length - 1] || cwd;
      setTitle(suggestion);
    }
  }, [cwd, title]);

  useEffect(() => {
    if (!hostId) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const query = cwd.trim();
    debounceRef.current = window.setTimeout(() => {
      getProjects({ host_id: hostId, q: query || undefined, limit: 10 })
        .then(({ projects }) => {
          const paths = projects.map((project) => project.path);
          setDirSuggestions(paths);
          setDirIndex(0);
        })
        .catch(() => {
          setDirSuggestions([]);
        });
    }, query ? 150 : 100);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [cwd, hostId]);

  useEffect(() => {
    setDirOpen(dirFocused && dirSuggestions.length > 0);
  }, [dirFocused, dirSuggestions]);

  const selectDirectory = (path: string) => {
    setCwd(path);
    setDirOpen(false);
    setDirFocused(false);
  };

  const flags = useMemo(() => {
    const next: string[] = [];
    if (continueSession) next.push('-c');
    if (skipPermissions) next.push('--dangerously-skip-permissions');
    if (chromeMode) next.push('--chrome');
    return next;
  }, [continueSession, skipPermissions, chromeMode]);

  return (
    <div id="new-session-modal" className="visible" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>New Orbit</h3>
        </div>
        <div className="modal-field">
          <label htmlFor="session-cwd-input">Directory</label>
          <div className="directory-input-wrapper">
            <input
              id="session-cwd-input"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="e.g. /home/user/my-project"
              autoComplete="off"
              onFocus={() => setDirFocused(true)}
              onBlur={() => {
                setTimeout(() => setDirFocused(false), 150);
              }}
              onKeyDown={(e) => {
                if (!dirOpen) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setDirIndex((prev) => (prev + 1) % dirSuggestions.length);
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setDirIndex((prev) => (prev - 1 + dirSuggestions.length) % dirSuggestions.length);
                }
                if (e.key === 'Tab' || e.key === 'Enter') {
                  if (dirSuggestions[dirIndex]) {
                    e.preventDefault();
                    selectDirectory(dirSuggestions[dirIndex]);
                  }
                }
                if (e.key === 'Escape') {
                  setDirOpen(false);
                }
              }}
            />
            {dirOpen && (
              <div className="directory-autocomplete-dropdown">
                {dirSuggestions.map((path, idx) => {
                  const name = path.replace(/\/+$/, '').split('/').pop() || path;
                  const shortPath = path.startsWith('/home/')
                    ? `~${path.slice(path.indexOf('/', 6))}`
                    : path;
                  return (
                    <div
                      key={`${path}-${idx}`}
                      className={`dir-item${idx === dirIndex ? ' selected' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectDirectory(path);
                      }}
                    >
                      <span className="dir-name">{name}</span>
                      <span className="dir-path">{shortPath}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="field-hint">
            Default: <code id="modal-default-cwd">~</code>
          </div>
        </div>
        <div className="modal-field">
          <label htmlFor="session-name-input">Name</label>
          <input
            id="session-name-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Auto-filled from directory..."
            autoComplete="off"
          />
        </div>
        <div className="modal-field">
          <label>Options</label>
          <div className="modal-checkboxes">
            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={continueSession}
                onChange={(e) => setContinueSession(e.target.checked)}
              />
              <span className="checkbox-label">Continue <code>-c</code></span>
            </label>
            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={skipPermissions}
                onChange={(e) => setSkipPermissions(e.target.checked)}
              />
              <span className="checkbox-label">Skip permissions <code>--dangerously-skip-permissions</code></span>
            </label>
            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={chromeMode}
                onChange={(e) => setChromeMode(e.target.checked)}
              />
              <span className="checkbox-label">Chrome <code>--chrome</code></span>
            </label>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="modal-btn modal-btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-btn modal-btn-create"
            onClick={() => cwd.trim() && onCreate(cwd.trim(), title, flags)}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsModal({
  soundEnabled,
  soundVolume,
  onClose,
  onToggleSound,
  onVolumeChange,
}: {
  soundEnabled: boolean;
  soundVolume: number;
  onClose: () => void;
  onToggleSound: () => void;
  onVolumeChange: (volume: number) => void;
}) {
  return (
    <div id="settings-modal" className="visible" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Settings</h3>
        </div>
        <div className="settings-checkbox-row">
          <label className="checkbox-label">
            <input type="checkbox" checked={soundEnabled} onChange={onToggleSound} />
            <span>Enable sounds</span>
          </label>
        </div>
        <div className="settings-slider-row">
          <span className="slider-label">Volume</span>
          <input
            className="settings-slider"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={soundVolume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          />
          <span className="slider-value">{Math.round(soundVolume * 100)}</span>
        </div>
        <div className="modal-actions">
          <button type="button" className="modal-btn modal-btn-cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function TextLabelModal({
  title,
  initialText,
  onClose,
  onSave,
}: {
  title: string;
  initialText?: string;
  onClose: () => void;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(initialText || '');
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        onSave(text);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, onSave, text]);

  return (
    <div id="text-label-modal" className="visible" onClick={onClose}>
      <div className="modal-content text-label-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="text-label-title">{title}</h3>
        </div>

        <div className="text-label-body">
          <textarea
            id="text-label-input"
            className="text-label-textarea"
            placeholder="Enter your label text here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={500}
          />
          <div className="text-label-footer">
            <span className="text-label-char-count">{text.length}/500</span>
            <span className="text-label-hint">Enter to save, Shift+Enter for newline</span>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="modal-btn modal-btn-cancel" id="text-label-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="modal-btn modal-btn-create" id="text-label-save" onClick={() => onSave(text)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
