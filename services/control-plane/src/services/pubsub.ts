import type { WebSocket } from '@fastify/websocket';
import type { ServerToUIMessage, Session, Approval, ToolEvent } from '@agent-command/schema';
import { clawdbotNotifier } from './clawdbot.js';

type TopicType =
  | 'sessions'
  | 'approvals'
  | 'events'
  | 'console'
  | 'snapshots'
  | 'tool_events'
  | 'session_usage';

interface Subscription {
  type: TopicType;
  filter?: Record<string, unknown>;
}

interface UIClient {
  ws: WebSocket;
  subscriptions: Subscription[];
}

interface AgentConnection {
  ws: WebSocket;
  hostId: string;
  lastAckedSeq: number;
}

class PubSub {
  private uiClients: Map<string, UIClient> = new Map();
  private agentConnections: Map<string, AgentConnection> = new Map();

  // UI Client management
  addUIClient(clientId: string, ws: WebSocket): void {
    this.uiClients.set(clientId, { ws, subscriptions: [] });
  }

  removeUIClient(clientId: string): void {
    this.uiClients.delete(clientId);
  }

  setUISubscriptions(clientId: string, subscriptions: Subscription[]): void {
    const client = this.uiClients.get(clientId);
    if (client) {
      client.subscriptions = subscriptions;
    }
  }

  // Agent connection management
  addAgentConnection(hostId: string, ws: WebSocket, lastAckedSeq = 0): void {
    this.agentConnections.set(hostId, { ws, hostId, lastAckedSeq });
  }

  removeAgentConnection(hostId: string): void {
    this.agentConnections.delete(hostId);
  }

  getAgentConnection(hostId: string): AgentConnection | undefined {
    return this.agentConnections.get(hostId);
  }

  updateAgentAckedSeq(hostId: string, seq: number): void {
    const conn = this.agentConnections.get(hostId);
    if (conn) {
      conn.lastAckedSeq = seq;
    }
  }

  // Publish to UI clients
  publishToUI(message: ServerToUIMessage): void {
    for (const client of this.uiClients.values()) {
      const filtered = this.filterMessageForClient(client.subscriptions, message);
      if (!filtered) continue;
      try {
        client.ws.send(JSON.stringify(filtered));
      } catch {
        // Client disconnected, will be cleaned up
      }
    }
  }

  private filterMessageForClient(
    subscriptions: Subscription[],
    message: ServerToUIMessage
  ): ServerToUIMessage | null {
    // Map message type to topic
    const topicMap: Record<string, TopicType> = {
      'sessions.changed': 'sessions',
      'approvals.created': 'approvals',
      'approvals.updated': 'approvals',
      'events.appended': 'events',
      'console.chunk': 'console',
      'snapshots.updated': 'snapshots',
      'tool_event.started': 'tool_events',
      'tool_event.completed': 'tool_events',
      'session_usage.updated': 'session_usage',
    };

    const topic = topicMap[message.type];
    if (!topic) return null;

    const relevantSubs = subscriptions.filter((sub) => sub.type === topic);
    if (relevantSubs.length === 0) return null;

    if (message.type === 'sessions.changed') {
      const payload = message.payload as { sessions: Session[]; deleted?: string[] };
      const filteredSessions: Session[] = [];
      const deletedIds = payload.deleted ?? [];
      let filteredDeleted: string[] | undefined;

      for (const sub of relevantSubs) {
        const filter = sub.filter || {};
        for (const session of payload.sessions) {
          if (this.matchesSessionFilter(session, filter)) {
            filteredSessions.push(session);
          }
        }
        if (deletedIds.length > 0) {
          const allowedIds = this.extractSessionIdFilter(filter);
          if (allowedIds) {
            const next = deletedIds.filter((id) => allowedIds.has(id));
            if (next.length > 0) {
              filteredDeleted = filteredDeleted ? filteredDeleted.concat(next) : next;
            }
          }
        }
      }

      const unique = new Map(filteredSessions.map((s) => [s.id, s]));
      const uniqueDeleted = filteredDeleted
        ? Array.from(new Set(filteredDeleted))
        : payload.deleted;
      if (unique.size === 0 && (!uniqueDeleted || uniqueDeleted.length === 0)) {
        return null;
      }

      return {
        ...message,
        payload: {
          sessions: Array.from(unique.values()),
          deleted: uniqueDeleted,
        },
      };
    }

    if (message.type === 'events.appended') {
      const payload = message.payload as { session_id: string };
      for (const sub of relevantSubs) {
        const filter = sub.filter || {};
        if (!filter.session_id || filter.session_id === payload.session_id) {
          return message;
        }
      }
      return null;
    }

    if (message.type === 'console.chunk') {
      const payload = message.payload as { subscription_id: string; session_id: string };
      for (const sub of relevantSubs) {
        const filter = sub.filter || {};
        if (filter.subscription_id && filter.subscription_id === payload.subscription_id) {
          return message;
        }
        if (filter.session_id && filter.session_id === payload.session_id) {
          return message;
        }
      }
      return null;
    }

    if (message.type === 'snapshots.updated') {
      const payload = message.payload as { session_id: string };
      for (const sub of relevantSubs) {
        const filter = sub.filter || {};
        if (!filter.session_id || filter.session_id === payload.session_id) {
          return message;
        }
      }
      return null;
    }

    if (message.type.startsWith('approvals.')) {
      for (const sub of relevantSubs) {
        const filter = sub.filter || {};
        const status = filter.status as string | undefined;
        if (!status) return message;

        if (status === 'pending') {
          return message;
        }
        if (status === 'decided' && message.type === 'approvals.updated') {
          return message;
        }
      }
      return null;
    }

    if (message.type.startsWith('tool_event.')) {
      const payload = message.payload as { session_id: string };
      for (const sub of relevantSubs) {
        const filter = sub.filter || {};
        if (!filter.session_id || filter.session_id === payload.session_id) {
          return message;
        }
      }
      return null;
    }

    if (message.type === 'session_usage.updated') {
      const payload = message.payload as { session_id: string };
      for (const sub of relevantSubs) {
        const filter = sub.filter || {};
        if (!filter.session_id || filter.session_id === payload.session_id) {
          return message;
        }
      }
      return null;
    }

    return message;
  }

  private matchesSessionFilter(session: Session, filter: Record<string, unknown>): boolean {
    if (filter.session_ids) {
      const ids = Array.isArray(filter.session_ids) ? filter.session_ids : [];
      if (ids.length > 0 && !ids.includes(session.id)) return false;
    }
    if (filter.session_id && filter.session_id !== session.id) return false;
    if (filter.host_id && filter.host_id !== session.host_id) return false;
    if (filter.status) {
      const statuses = typeof filter.status === 'string'
        ? filter.status.split(',').map((s) => s.trim()).filter(Boolean)
        : Array.isArray(filter.status)
          ? filter.status
          : [];
      if (statuses.length > 0 && !statuses.includes(session.status)) return false;
    }
    if (filter.provider && filter.provider !== session.provider) return false;
    if (filter.group_id !== undefined) {
      if (filter.group_id !== session.group_id) return false;
    }
    if (filter.ungrouped) {
      if (session.group_id) return false;
    }
    if (filter.archived_only) {
      if (!session.archived_at) return false;
    } else if (!filter.include_archived) {
      if (session.archived_at) return false;
    }
    if (filter.needs_attention) {
      const needs = ['WAITING_FOR_INPUT', 'WAITING_FOR_APPROVAL', 'ERROR'].includes(
        session.status
      );
      if (!needs) return false;
    }
    if (filter.q && typeof filter.q === 'string') {
      const q = filter.q.toLowerCase();
      const hay = [
        session.title,
        session.cwd,
        session.repo_root,
        session.git_branch,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  private extractSessionIdFilter(filter: Record<string, unknown>): Set<string> | null {
    if (filter.session_id && typeof filter.session_id === 'string') {
      return new Set([filter.session_id]);
    }
    if (Array.isArray(filter.session_ids)) {
      return new Set(filter.session_ids.filter((id): id is string => typeof id === 'string'));
    }
    return null;
  }

  // Publish to specific agent
  sendToAgent(hostId: string, message: unknown): boolean {
    const conn = this.agentConnections.get(hostId);
    if (!conn) return false;

    try {
      conn.ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  // Publish sessions changed
  publishSessionsChanged(sessions: Session[], deleted?: string[]): void {
    this.publishToUI({
      v: 1,
      type: 'sessions.changed',
      ts: new Date().toISOString(),
      payload: { sessions, deleted },
    });

    // Send clawdbot notifications for status changes
    for (const session of sessions) {
      if (session.status === 'ERROR') {
        clawdbotNotifier.notifySessionError(session).catch((err) => {
          console.error('[pubsub] Error sending clawdbot error notification:', err);
        });
      } else if (session.status === 'WAITING_FOR_INPUT') {
        clawdbotNotifier.notifyWaitingInput(session).catch((err) => {
          console.error('[pubsub] Error sending clawdbot waiting input notification:', err);
        });
      } else if (session.status === 'WAITING_FOR_APPROVAL') {
        clawdbotNotifier.notifyWaitingApproval(session).catch((err) => {
          console.error('[pubsub] Error sending clawdbot waiting approval notification:', err);
        });
      }
    }
  }

  // Publish approval created
  publishApprovalCreated(approval: Approval, session?: Session | null): void {
    this.publishToUI({
      v: 1,
      type: 'approvals.created',
      ts: new Date().toISOString(),
      payload: {
        approval_id: approval.id,
        session_id: approval.session_id,
        provider: approval.provider,
        requested_payload: approval.requested_payload as Record<string, unknown>,
      },
    });

    // Send clawdbot notification for new approvals
    clawdbotNotifier.notifyApprovalCreated(approval, session ?? null).catch((err) => {
      console.error('[pubsub] Error sending clawdbot approval notification:', err);
    });
  }

  // Publish approval updated
  publishApprovalUpdated(
    approvalId: string,
    decision: 'allow' | 'deny',
    userId?: string
  ): void {
    this.publishToUI({
      v: 1,
      type: 'approvals.updated',
      ts: new Date().toISOString(),
      payload: {
        approval_id: approvalId,
        decision,
        decided_by_user_id: userId,
      },
    });
  }

  // Publish event appended
  publishEventAppended(
    sessionId: string,
    event: { id: number; ts: string; type: string; payload: Record<string, unknown> }
  ): void {
    this.publishToUI({
      v: 1,
      type: 'events.appended',
      ts: new Date().toISOString(),
      payload: {
        session_id: sessionId,
        event,
      },
    });
  }

  // Publish console chunk
  publishConsoleChunk(
    subscriptionId: string,
    sessionId: string,
    data: string,
    offset: number
  ): void {
    this.publishToUI({
      v: 1,
      type: 'console.chunk',
      ts: new Date().toISOString(),
      payload: {
        subscription_id: subscriptionId,
        session_id: sessionId,
        data,
        offset,
      },
    });
  }

  // Publish snapshot updated
  publishSnapshotUpdated(
    sessionId: string,
    captureText: string,
    captureHash: string,
    createdAt?: string
  ): void {
    this.publishToUI({
      v: 1,
      type: 'snapshots.updated',
      ts: new Date().toISOString(),
      payload: {
        session_id: sessionId,
        capture_text: captureText,
        capture_hash: captureHash,
        created_at: createdAt,
      },
    });
  }

  // Publish tool event started
  publishToolEventStarted(sessionId: string, event: ToolEvent): void {
    this.publishToUI({
      v: 1,
      type: 'tool_event.started',
      ts: new Date().toISOString(),
      payload: {
        session_id: sessionId,
        event,
      },
    });
  }

  // Publish tool event completed
  publishToolEventCompleted(sessionId: string, event: ToolEvent): void {
    this.publishToUI({
      v: 1,
      type: 'tool_event.completed',
      ts: new Date().toISOString(),
      payload: {
        session_id: sessionId,
        event,
      },
    });
  }

  // Check if agent is connected
  isAgentConnected(hostId: string): boolean {
    return this.agentConnections.has(hostId);
  }

  // Get stats
  getStats(): { uiClients: number; agents: number } {
    return {
      uiClients: this.uiClients.size,
      agents: this.agentConnections.size,
    };
  }
}

export const pubsub = new PubSub();
