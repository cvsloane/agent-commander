'use client';

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ServerToUIMessage, SessionWithSnapshot } from '@agent-command/schema';
import { getTmuxRoster } from '@/lib/api';
import { useTmuxTopologyStore } from '@/stores/tmuxTopology';
import { useWebSocket } from './useWebSocket';

export function useTmuxTopologyFeed(hostIds: string[], rosterSessions: SessionWithSnapshot[]) {
  const setRoster = useTmuxTopologyStore((state) => state.setRoster);
  const receiveTopology = useTmuxTopologyStore((state) => state.receiveTopology);
  const hostIdsKey = [...hostIds].sort().join(',');
  const stableHostIds = useMemo(() => (hostIdsKey ? hostIdsKey.split(',') : []), [hostIdsKey]);

  useEffect(() => {
    const grouped = new Map<string, SessionWithSnapshot[]>();
    for (const hostId of stableHostIds) grouped.set(hostId, []);
    for (const session of rosterSessions) {
      const sessions = grouped.get(session.host_id) ?? [];
      sessions.push(session);
      grouped.set(session.host_id, sessions);
    }
    for (const [hostId, sessions] of grouped) setRoster(hostId, sessions);
  }, [rosterSessions, setRoster, stableHostIds]);

  useWebSocket(
    [{ type: 'tmux.topology' }],
    (message: ServerToUIMessage) => {
      if (message.type !== 'tmux.topology') return;
      receiveTopology(message.payload.host_id, message.payload, message.ts);
    },
    stableHostIds.length > 0,
    'tmux-topology'
  );
}

export function useTmuxHostTopology(hostId: string, seedSessions?: SessionWithSnapshot[]) {
  const storedRoster = useTmuxTopologyStore((state) => state.rosterByHost[hostId]);
  const { data } = useQuery({
    queryKey: ['sessions', 'tmux', hostId, 'topology-fallback'],
    queryFn: () => getTmuxRoster({ host_id: hostId }),
    enabled: Boolean(hostId && !seedSessions),
    staleTime: 30_000,
  });
  const fallbackSessions = useMemo(
    () => seedSessions ?? data?.sessions ?? storedRoster ?? [],
    [data?.sessions, seedSessions, storedRoster]
  );

  useTmuxTopologyFeed(hostId ? [hostId] : [], fallbackSessions);
  return useTmuxTopologyStore((state) => state.hosts[hostId]);
}
