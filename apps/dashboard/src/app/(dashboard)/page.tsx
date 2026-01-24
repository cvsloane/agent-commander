'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, AlertCircle, Activity, Clock, Users } from 'lucide-react';
import type { ServerToUIMessage, Session } from '@agent-command/schema';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SessionCard } from '@/components/SessionCard';
import { SessionGenerator } from '@/components/session-generator';
import { AccountUsage } from '@/components/analytics';
import { getSessions, getHosts } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useSessionStore } from '@/stores/session';
import { useOrchestratorStore } from '@/stores/orchestrator';

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [showSpawnDialog, setShowSpawnDialog] = useState(false);
  const { sessions, setSessions, updateSessions } = useSessionStore();
  const {
    ingestSessions: ingestOrchestratorSessions,
    ingestSnapshot,
    getWaitingItems,
  } = useOrchestratorStore();
  const workflowStatuses = 'RUNNING,STARTING,WAITING_FOR_INPUT,WAITING_FOR_APPROVAL,ERROR,IDLE';

  // Fetch initial data
  const { data: sessionData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['sessions', 'dashboard'],
    queryFn: () => getSessions({ include_archived: false, status: workflowStatuses }),
    refetchInterval: false,
  });

  const { data: hostsData } = useQuery({
    queryKey: ['hosts'],
    queryFn: getHosts,
  });

  // Update local state when query data changes
  useEffect(() => {
    if (sessionData?.sessions) {
      setSessions(sessionData.sessions);
      ingestOrchestratorSessions(sessionData.sessions as any, { fullSync: true });
    }
  }, [sessionData, setSessions, ingestOrchestratorSessions]);

  // WebSocket for real-time updates
  const handleWebSocketMessage = useCallback((message: ServerToUIMessage) => {
    if (message.type === 'sessions.changed') {
      const payload = message.payload as { sessions: Session[]; deleted?: string[] };
      updateSessions(payload.sessions, payload.deleted);
      if (payload.sessions.length > 0) {
        ingestOrchestratorSessions(payload.sessions as any);
      }
    }
    if (message.type === 'snapshots.updated') {
      const payload = message.payload as {
        session_id: string;
        capture_text: string;
        capture_hash?: string;
      };
      ingestSnapshot(payload.session_id, payload.capture_text, payload.capture_hash);
    }
  }, [updateSessions, ingestOrchestratorSessions, ingestSnapshot]);

  useWebSocket(
    [
      { type: 'sessions', filter: { include_archived: false, status: workflowStatuses } },
      { type: 'snapshots' },
    ],
    handleWebSocketMessage
  );

  const waitingOrchestratorItems = getWaitingItems();
  const waitingSessions = useMemo(() => {
    if (waitingOrchestratorItems.length === 0) return [];
    const byId = new Map(sessions.map((session) => [session.id, session]));
    return waitingOrchestratorItems
      .map((item) => byId.get(item.sessionId))
      .filter((session): session is (typeof sessions)[number] => Boolean(session));
  }, [sessions, waitingOrchestratorItems]);

  // Compute dashboard sections
  const waitingSessionIds = useMemo(() => {
    return new Set(waitingOrchestratorItems.map((item) => item.sessionId));
  }, [waitingOrchestratorItems]);

  const needsAttentionSessions = useMemo(() => {
    return sessions.filter(s =>
      !s.idled_at &&
      (s.status === 'WAITING_FOR_INPUT' ||
        s.status === 'WAITING_FOR_APPROVAL' ||
        s.status === 'ERROR') &&
      !waitingSessionIds.has(s.id)
    );
  }, [sessions, waitingSessionIds]);

  const activeSessions = useMemo(() => {
    return sessions.filter(s =>
      !s.idled_at &&
      (s.status === 'RUNNING' || s.status === 'STARTING')
    );
  }, [sessions]);

  const idleSessions = useMemo(() => {
    return sessions.filter(s => s.status === 'IDLE' || s.idled_at);
  }, [sessions]);

  const onlineHosts = useMemo(() => {
    if (!hostsData?.hosts) return 0;
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    return hostsData.hosts.filter(h =>
      h.last_seen_at && new Date(h.last_seen_at).getTime() > fiveMinutesAgo
    ).length;
  }, [hostsData]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
    queryClient.invalidateQueries({ queryKey: ['hosts'] });
  };

  const isLoading = sessionsLoading;

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setShowSpawnDialog(true)}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            New Session
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Link href="/sessions?status=RUNNING,STARTING" className="block">
          <Card className="hover:border-primary/50 transition-colors">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Sessions</p>
                <p className="text-2xl font-bold">{activeSessions.length}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/sessions?needs_attention=true" className="block">
          <Card className="hover:border-orange-500/50 transition-colors">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-orange-500/10 rounded-lg">
                <AlertCircle className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Needs Attention</p>
                <p className="text-2xl font-bold">{needsAttentionSessions.length}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/hosts" className="block">
          <Card className="hover:border-green-500/50 transition-colors">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Users className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Hosts Online</p>
                <p className="text-2xl font-bold">{onlineHosts}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/sessions?view=workflow" className="block">
          <Card className="hover:border-blue-500/50 transition-colors">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Clock className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Idle Sessions</p>
                <p className="text-2xl font-bold">{idleSessions.length}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Usage Widget */}
      <div className="mb-6">
        <AccountUsage />
      </div>

      {/* Waiting Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            Waiting
          </h2>
          <Link href="/sessions?status=WAITING_FOR_INPUT,WAITING_FOR_APPROVAL">
            <Button variant="ghost" size="sm">View Sessions</Button>
          </Link>
        </div>
        {waitingSessions.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {waitingSessions.slice(0, 6).map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                host={hostsData?.hosts?.find((host) => host.id === session.host_id)}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No waiting sessions.</p>
        )}
      </div>

      {/* Active Sessions Section */}
      {activeSessions.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Activity className="h-5 w-5 text-green-500" />
              Active Sessions
            </h2>
            <Link href="/sessions?status=RUNNING,STARTING">
              <Button variant="ghost" size="sm">View All</Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeSessions.slice(0, 6).map(session => (
              <SessionCard
                key={session.id}
                session={session}
                host={hostsData?.hosts?.find(h => h.id === session.host_id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Needs Attention Section removed from dashboard to keep focus on active flow */}

      {/* Idle Sessions Section */}
      {idleSessions.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              Recently Idle
            </h2>
            <Link href="/sessions?status=IDLE">
              <Button variant="ghost" size="sm">View All</Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {idleSessions.slice(0, 4).map(session => (
              <SessionCard
                key={session.id}
                session={session}
                host={hostsData?.hosts?.find(h => h.id === session.host_id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && sessions.length === 0 && (
        <Card className="mt-8">
          <CardContent className="p-12 text-center">
            <Activity className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Active Sessions</h3>
            <p className="text-muted-foreground mb-4">
              Get started by creating a new session or check if your hosts are connected.
            </p>
            <div className="flex gap-2 justify-center">
              <Button onClick={() => setShowSpawnDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New Session
              </Button>
              <Link href="/hosts">
                <Button variant="outline">
                  <Users className="h-4 w-4 mr-2" />
                  View Hosts
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Session Generator */}
      <SessionGenerator
        isOpen={showSpawnDialog}
        onClose={() => setShowSpawnDialog(false)}
      />
    </div>
  );
}
