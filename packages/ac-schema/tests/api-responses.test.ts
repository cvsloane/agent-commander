import { describe, expect, it } from 'vitest';

import {
  ApprovalsResponseSchema,
  HostsResponseSchema,
  MemorySearchResponseSchema,
  SessionEventsResponseSchema,
  UserSettingsResponseSchema,
  WorkItemsResponseSchema,
} from '../src/apiResponses.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

function host(extra: Record<string, unknown> = {}) {
  return {
    id: hostId,
    name: 'heavisidelinux',
    capabilities: { tmux: true, terminal: true },
    agent_version: '0.1.0',
    last_seen_at: '2026-07-24T12:00:00.000Z',
    last_acked_seq: 10,
    created_at: '2026-07-24T10:00:00.000Z',
    updated_at: '2026-07-24T11:00:00.000Z',
    ...extra,
  };
}

describe('API response envelopes', () => {
  /**
   * The whole point of these schemas is diagnosing drift. Zod strips unknown
   * keys on a successful parse, so a strict schema would silently delete fields
   * the route legitimately adds -- GET /v1/hosts merges `online` and
   * `last_heartbeat_at` from in-memory presence, which are not on HostSchema.
   * Stripping those would break host status while reporting success.
   */
  it('preserves route-decorated fields that are not on the base entity schema', () => {
    const payload = {
      hosts: [host({ online: true, last_heartbeat_at: '2026-07-24T12:00:05.000Z' })],
    };

    const result = HostsResponseSchema.parse(payload);

    expect(result.hosts[0]).toMatchObject({
      id: hostId,
      online: true,
      last_heartbeat_at: '2026-07-24T12:00:05.000Z',
    });
  });

  it('preserves unknown keys added to the envelope itself', () => {
    const result = HostsResponseSchema.parse({
      hosts: [host()],
      total: 1,
      generated_at: '2026-07-24T12:00:00.000Z',
    });

    expect(result).toMatchObject({ total: 1, generated_at: '2026-07-24T12:00:00.000Z' });
  });

  it('still rejects a genuinely wrong shape so drift is reported', () => {
    expect(HostsResponseSchema.safeParse({ hosts: 'not-an-array' }).success).toBe(false);
    expect(HostsResponseSchema.safeParse({}).success).toBe(false);
    expect(ApprovalsResponseSchema.safeParse({ approvals: [{ id: 1 }] }).success).toBe(false);
  });

  it('matches the envelope key each route actually returns', () => {
    // Guards against the class of mistake where the envelope key is guessed:
    // memory search returns `results`, not `entries`.
    expect(MemorySearchResponseSchema.safeParse({ results: [] }).success).toBe(true);
    expect(MemorySearchResponseSchema.safeParse({ entries: [] }).success).toBe(false);

    expect(WorkItemsResponseSchema.safeParse({ work_items: [] }).success).toBe(true);
    expect(ApprovalsResponseSchema.safeParse({ approvals: [] }).success).toBe(true);
  });

  it('accepts a null settings payload for a user with no saved settings', () => {
    expect(UserSettingsResponseSchema.safeParse({ settings: null }).success).toBe(true);
  });

  it('accepts an events page with and without a cursor', () => {
    const event = {
      session_id: sessionId,
      type: 'output',
      payload: { text: 'hello' },
      ts: '2026-07-24T12:00:00.000Z',
    };
    expect(SessionEventsResponseSchema.safeParse({ events: [event] }).success).toBe(true);
    expect(
      SessionEventsResponseSchema.safeParse({ events: [event], next_cursor: 42 }).success
    ).toBe(true);
  });
});
