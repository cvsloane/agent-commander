import { afterEach, describe, expect, it, vi } from 'vitest';
import * as db from '../src/db/index.js';

describe('data model hygiene', () => {
  afterEach(() => vi.restoreAllMocks());

  it('atomically rebinds recoverable legacy settings to the authenticated UUID', async () => {
    const authenticatedUserId = '11111111-1111-4111-8111-111111111111';
    const legacyUserId = '22222222-2222-4222-8222-222222222222';
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: legacyUserId }] })
      .mockResolvedValueOnce({ rows: [{ settings: { theme: 'dark' } }] })
      .mockResolvedValue({ rows: [] });
    const release = vi.fn();
    vi.spyOn(db.pool, 'connect').mockResolvedValue({ query, release } as never);

    await db.claimLegacyUserSettings(authenticatedUserId, 'legacy-subject');

    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/).slice(0, 3).join(' ')))
      .toEqual([
        'BEGIN',
        'SELECT user_id FROM',
        'SELECT settings FROM',
        'INSERT INTO user_settings',
        'DELETE FROM user_settings_legacy_subjects',
        'DELETE FROM user_settings',
        'DELETE FROM users',
        'COMMIT',
      ]);
    expect(query.mock.calls[3]?.[1]).toEqual([
      authenticatedUserId,
      JSON.stringify({ theme: 'dark' }),
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('stores summaries without a session as SQL null', async () => {
    const query = vi.spyOn(db.pool, 'query').mockResolvedValue({
      rows: [{ id: 1, capture_hash: 'capture', session_id: null }],
      rowCount: 1,
      command: 'INSERT',
      oid: 0,
      fields: [],
    });

    await db.saveSummary('capture', null, 'status', 'Summary');

    expect(query.mock.calls[0]?.[1]).toEqual(['capture', null, 'status', 'Summary']);
  });

  it('times out approvals and reconciles matching session state in one statement', async () => {
    const query = vi.spyOn(db.pool, 'query').mockResolvedValue({
      rows: [{ approvals: [], sessions: [] }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    await db.markExpiredApprovalsTimedOut(600_000);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('WITH timed_out AS');
    expect(sql).toContain('updated_sessions AS');
    expect(sql).toContain("THEN 'IDLE'::session_status");
    expect(query.mock.calls[0]?.[1]).toEqual([600_000]);
  });
});
