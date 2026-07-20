import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Approval } from '@agent-command/schema';
import {
  runApprovalTimeoutSweep,
  runRetentionSweep,
  startDataMaintenanceService,
  type DataMaintenanceRepository,
} from '../src/services/dataMaintenance.js';

function repository(): DataMaintenanceRepository {
  const approval = {
    id: '11111111-1111-4111-8111-111111111111',
    session_id: '22222222-2222-4222-8222-222222222222',
    provider: 'codex',
    ts_requested: new Date().toISOString(),
    requested_payload: {},
  } as Approval;
  return {
    pruneExpiredData: vi.fn(async () => ({ events: 12, snapshots: 7 })),
    markExpiredApprovalsTimedOut: vi.fn(async () => ({ approvals: [approval], sessions: [] })),
  };
}

describe('data maintenance sweeps', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps retention off when the retention window is unset', async () => {
    const db = repository();
    await expect(runRetentionSweep(undefined, db)).resolves.toEqual({
      enabled: false,
      events: 0,
      snapshots: 0,
    });
    expect(db.pruneExpiredData).not.toHaveBeenCalled();
  });

  it('prunes events and snapshots using the configured retention window', async () => {
    const db = repository();
    await expect(runRetentionSweep(30, db)).resolves.toEqual({
      enabled: true,
      events: 12,
      snapshots: 7,
    });
    expect(db.pruneExpiredData).toHaveBeenCalledWith(30, 10_000);
  });

  it('drains bounded retention batches up to the per-sweep cap', async () => {
    const db = repository();
    vi.mocked(db.pruneExpiredData).mockResolvedValue({ events: 10_000, snapshots: 0 });

    await expect(runRetentionSweep(30, db)).resolves.toEqual({
      enabled: true,
      events: 100_000,
      snapshots: 0,
    });
    expect(db.pruneExpiredData).toHaveBeenCalledTimes(10);
  });

  it('wires the approval timeout helper into the sweep', async () => {
    const db = repository();
    await expect(runApprovalTimeoutSweep(600_000, db)).resolves.toMatchObject({
      approvals: [{ id: '11111111-1111-4111-8111-111111111111' }],
      sessions: [],
    });
    expect(db.markExpiredApprovalsTimedOut).toHaveBeenCalledWith(600_000);
  });

  it('publishes approvals reconciled by the periodic timeout sweep', async () => {
    const db = repository();
    const publisher = {
      publishApprovalTimedOut: vi.fn(),
      publishSessionsChanged: vi.fn(),
    };
    const handle = startDataMaintenanceService({
      logger: { info: vi.fn(), error: vi.fn() } as never,
      retentionSweepIntervalMs: 60_000,
      approvalTimeoutMs: 600_000,
      approvalSweepIntervalMs: 60_000,
      repository: db,
      publisher: publisher as never,
    });

    await vi.waitFor(() => expect(publisher.publishApprovalTimedOut).toHaveBeenCalledOnce());
    await handle.stop();
  });

  it('does not overlap retention sweeps and waits for in-flight work on stop', async () => {
    vi.useFakeTimers();
    let finishPrune!: (value: { events: number; snapshots: number }) => void;
    const pruneExpiredData = vi.fn(() => new Promise<{ events: number; snapshots: number }>(
      (resolve) => { finishPrune = resolve; }
    ));
    const db: DataMaintenanceRepository = {
      pruneExpiredData,
      markExpiredApprovalsTimedOut: vi.fn(async () => ({ approvals: [], sessions: [] })),
    };
    const handle = startDataMaintenanceService({
      logger: { info: vi.fn(), error: vi.fn() } as never,
      retentionDays: 30,
      retentionSweepIntervalMs: 10,
      approvalTimeoutMs: 600_000,
      approvalSweepIntervalMs: 10,
      repository: db,
      publisher: {
        publishApprovalTimedOut: vi.fn(),
        publishSessionsChanged: vi.fn(),
      } as never,
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(pruneExpiredData).toHaveBeenCalledOnce();

    let stopped = false;
    const stopping = handle.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finishPrune({ events: 0, snapshots: 0 });
    await stopping;
    expect(stopped).toBe(true);
  });
});
