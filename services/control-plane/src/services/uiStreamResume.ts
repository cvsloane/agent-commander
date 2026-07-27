import type {
  AutomationRunEvent,
  Event,
  ServerToUIMessage,
  Session,
  SessionSnapshot,
} from '@agent-command/schema';
import type { QueryResult, QueryResultRow } from 'pg';
import * as db from '../db/index.js';

export type UIStreamTopic = {
  type: string;
  filter?: Record<string, unknown>;
};

export type UIResumeCursor = number | Record<string, number>;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string')
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  return [];
}

function filteredSessionIds(filter?: Record<string, unknown>): string[] {
  if (typeof filter?.session_id === 'string') return [filter.session_id];
  return stringList(filter?.session_ids);
}

function matchesSessionFilter(session: Session, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  const ids = filteredSessionIds(filter);
  if (ids.length > 0 && !ids.includes(session.id)) return false;
  if (typeof filter.host_id === 'string' && filter.host_id !== session.host_id) return false;
  if (typeof filter.provider === 'string' && filter.provider !== session.provider) return false;
  const statuses = stringList(filter.status);
  if (statuses.length > 0 && !statuses.includes(session.status)) return false;
  if (
    filter.needs_attention === true &&
    !session.attention_reason &&
    !['WAITING_FOR_INPUT', 'WAITING_FOR_APPROVAL', 'ERROR'].includes(session.status)
  )
    return false;
  return true;
}

function sessionsForTopics(sessions: Session[], topics: UIStreamTopic[], type: string): Session[] {
  const relevant = topics.filter((topic) => topic.type === type);
  if (relevant.length === 0) return [];
  return sessions.filter((session) =>
    relevant.some((topic) => matchesSessionFilter(session, topic.filter))
  );
}

function eventsMessage(event: Event): ServerToUIMessage {
  return {
    v: 1,
    type: 'events.appended',
    ts: iso(event.ts),
    seq: event.id,
    payload: {
      session_id: event.session_id,
      event: {
        id: event.id!,
        ts: iso(event.ts),
        type: event.type,
        payload: event.payload,
      },
    },
  };
}

interface UIStreamDatabase {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
}

export function createUIStreamResumeService(database: UIStreamDatabase) {
  async function replayTopic(
    userId: string,
    topic: UIStreamTopic,
    since: number
  ): Promise<ServerToUIMessage[]> {
    if (topic.type === 'events' || topic.type === 'attention') {
      const params: unknown[] = [userId, since];
      let query = `SELECT e.*
         FROM events e
         JOIN sessions s ON s.id = e.session_id
         WHERE (s.user_id = $1 OR s.user_id IS NULL)
           AND e.id > $2`;
      if (topic.type === 'attention') query += ` AND e.type = 'attention.changed'`;
      const sessionIds = filteredSessionIds(topic.filter);
      if (sessionIds.length > 0) {
        params.push(sessionIds);
        query += ` AND e.session_id = ANY($${params.length}::uuid[])`;
      }
      query += ' ORDER BY e.id ASC LIMIT 500';
      const result = await database.query<Event>(query, params);
      if (topic.type === 'events') return result.rows.map(eventsMessage);
      return result.rows.map((event) => ({
        v: 1,
        type: 'attention.changed',
        ts: iso(event.ts),
        seq: event.id,
        payload: {
          session_id: event.session_id,
          attention_reason:
            typeof event.payload.attention_reason === 'string'
              ? event.payload.attention_reason
              : null,
          ...(typeof event.payload.question === 'string'
            ? { question: event.payload.question }
            : {}),
          ...(typeof event.payload.confidence === 'number'
            ? { confidence: event.payload.confidence }
            : {}),
          ...(typeof event.payload.capture_hash === 'string'
            ? { capture_hash: event.payload.capture_hash }
            : {}),
        },
      }));
    }

    if (topic.type === 'automation_run_events') {
      const params: unknown[] = [userId, since];
      let query = `SELECT e.*
         FROM automation_run_events e
         JOIN automation_runs r ON r.id = e.automation_run_id
         JOIN automation_agents a ON a.id = r.automation_agent_id
         WHERE a.user_id = $1 AND e.seq > $2`;
      if (typeof topic.filter?.automation_run_id === 'string') {
        params.push(topic.filter.automation_run_id);
        query += ` AND e.automation_run_id = $${params.length}`;
      }
      query += ' ORDER BY e.automation_run_id, e.seq ASC LIMIT 500';
      const result = await database.query<AutomationRunEvent>(query, params);
      return result.rows.map((event) => ({
        v: 1,
        type: 'automation.run.event',
        ts: iso(event.created_at ?? new Date()),
        seq: event.seq,
        payload: { ...event, created_at: iso(event.created_at) },
      }));
    }

    return [];
  }

  return {
    async replay(
      userId: string,
      topics: UIStreamTopic[],
      since: UIResumeCursor
    ): Promise<ServerToUIMessage[]> {
      const replayable = topics.filter((topic) =>
        ['events', 'attention', 'automation_run_events'].includes(topic.type)
      );
      const messages = await Promise.all(
        replayable.map((topic) => {
          const cursor = typeof since === 'number' ? since : since[topic.type];
          return cursor === undefined
            ? Promise.resolve<ServerToUIMessage[]>([])
            : replayTopic(userId, topic, cursor);
        })
      );
      return messages.flat();
    },

    async initialSnapshot(userId: string, topics: UIStreamTopic[]): Promise<ServerToUIMessage[]> {
      const wantsSessions = topics.some((topic) => topic.type === 'sessions');
      const wantsSnapshots = topics.some((topic) => topic.type === 'snapshots');
      const wantsAttention = topics.some((topic) => topic.type === 'attention');
      if (!wantsSessions && !wantsSnapshots && !wantsAttention) return [];

      const sessionsResult = await database.query<Session>(
        `SELECT *
         FROM sessions
         WHERE archived_at IS NULL
           AND (user_id = $1 OR user_id IS NULL)
         ORDER BY last_activity_at DESC NULLS LAST`,
        [userId]
      );
      const sessions = sessionsResult.rows;
      const messages: ServerToUIMessage[] = [];
      if (wantsSessions) {
        const subscribedSessions = sessionsForTopics(sessions, topics, 'sessions');
        messages.push({
          v: 1,
          type: 'sessions.changed',
          ts: new Date().toISOString(),
          payload: { sessions: subscribedSessions },
        });
      }

      const snapshotSessions = sessionsForTopics(sessions, topics, 'snapshots');
      if (wantsSnapshots && snapshotSessions.length > 0) {
        const snapshotResult = await database.query<SessionSnapshot>(
          `SELECT DISTINCT ON (ss.session_id) ss.*
           FROM session_snapshots ss
           WHERE ss.session_id = ANY($1::uuid[])
           ORDER BY ss.session_id, ss.id DESC`,
          [snapshotSessions.map((session) => session.id)]
        );
        for (const snapshot of snapshotResult.rows) {
          messages.push({
            v: 1,
            type: 'snapshots.updated',
            ts: iso(snapshot.created_at),
            payload: {
              session_id: snapshot.session_id,
              capture_text: snapshot.capture_text,
              capture_hash: snapshot.capture_hash,
              created_at: iso(snapshot.created_at),
            },
          });
        }
      }

      if (wantsAttention) {
        for (const session of sessionsForTopics(sessions, topics, 'attention')) {
          if (!session.attention_reason) continue;
          messages.push({
            v: 1,
            type: 'attention.changed',
            ts: new Date().toISOString(),
            payload: {
              session_id: session.id,
              attention_reason: session.attention_reason,
            },
          });
        }
      }
      return messages;
    },
  };
}

const lazyPool: UIStreamDatabase = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) =>
    db.pool.query<T>(text, values),
};

export const uiStreamResume = createUIStreamResumeService(lazyPool);
