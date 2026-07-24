import type { FastifyBaseLogger } from 'fastify';
import type { Approval, Session } from '@agent-command/schema';
import * as db from '../db/index.js';
import { pubsub } from './pubsub.js';

const RETENTION_BATCH_SIZE = 10_000;
const RETENTION_MAX_BATCHES_PER_SWEEP = 10;

export interface DataMaintenanceRepository {
  pruneExpiredData(
    retentionDays: number,
    batchSize?: number
  ): Promise<{ events: number; snapshots: number }>;
  markExpiredApprovalsTimedOut(
    timeoutMs: number
  ): Promise<{ approvals: Approval[]; sessions: Session[] }>;
}

export async function runRetentionSweep(
  retentionDays: number | undefined,
  repository: DataMaintenanceRepository = db
): Promise<{ enabled: boolean; events: number; snapshots: number }> {
  if (retentionDays === undefined) {
    return { enabled: false, events: 0, snapshots: 0 };
  }
  let events = 0;
  let snapshots = 0;
  for (let batch = 0; batch < RETENTION_MAX_BATCHES_PER_SWEEP; batch += 1) {
    const result = await repository.pruneExpiredData(retentionDays, RETENTION_BATCH_SIZE);
    events += result.events;
    snapshots += result.snapshots;
    if (result.events < RETENTION_BATCH_SIZE && result.snapshots < RETENTION_BATCH_SIZE) {
      break;
    }
  }
  return { enabled: true, events, snapshots };
}

export async function runApprovalTimeoutSweep(
  timeoutMs: number,
  repository: DataMaintenanceRepository = db
): Promise<{ approvals: Approval[]; sessions: Session[] }> {
  return repository.markExpiredApprovalsTimedOut(timeoutMs);
}

export function startDataMaintenanceService(options: {
  logger: FastifyBaseLogger;
  retentionDays?: number;
  retentionSweepIntervalMs: number;
  approvalTimeoutMs: number;
  approvalSweepIntervalMs: number;
  repository?: DataMaintenanceRepository;
  publisher?: Pick<typeof pubsub, 'publishApprovalTimedOut' | 'publishSessionsChanged'>;
}): { stop: () => Promise<void> } {
  const repository = options.repository ?? db;
  const publisher = options.publisher ?? pubsub;
  let stopped = false;
  let retentionInFlight: Promise<void> | null = null;
  let approvalsInFlight: Promise<void> | null = null;

  const sweepRetention = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (retentionInFlight) return retentionInFlight;
    const sweep = (async () => {
      try {
        const result = await runRetentionSweep(options.retentionDays, repository);
        if (result.enabled && (result.events > 0 || result.snapshots > 0)) {
          options.logger.info(result, 'Pruned expired events and session snapshots');
        }
      } catch (error) {
        options.logger.error({ error }, 'Failed to prune expired data');
      }
    })().finally(() => { retentionInFlight = null; });
    retentionInFlight = sweep;
    return sweep;
  };

  const sweepApprovals = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (approvalsInFlight) return approvalsInFlight;
    const sweep = (async () => {
      try {
        const timedOut = await runApprovalTimeoutSweep(options.approvalTimeoutMs, repository);
        for (const approval of timedOut.approvals) {
          publisher.publishApprovalTimedOut(approval);
        }
        if (timedOut.sessions.length > 0) {
          publisher.publishSessionsChanged(timedOut.sessions);
        }
        if (timedOut.approvals.length > 0) {
          options.logger.info(
            { timedOut: timedOut.approvals.length },
            'Marked stale approvals as timed out'
          );
        }
      } catch (error) {
        options.logger.error({ error }, 'Failed to sweep stale approvals');
      }
    })().finally(() => { approvalsInFlight = null; });
    approvalsInFlight = sweep;
    return sweep;
  };

  void sweepRetention();
  void sweepApprovals();

  const retentionTimer = options.retentionDays === undefined
    ? null
    : setInterval(() => void sweepRetention(), options.retentionSweepIntervalMs);
  const approvalTimer = setInterval(
    () => void sweepApprovals(),
    options.approvalSweepIntervalMs
  );
  retentionTimer?.unref?.();
  approvalTimer.unref?.();

  return {
    stop: async () => {
      stopped = true;
      if (retentionTimer) clearInterval(retentionTimer);
      clearInterval(approvalTimer);
      await Promise.all(
        [retentionInFlight, approvalsInFlight].filter(
          (inFlight): inFlight is Promise<void> => inFlight !== null
        )
      );
    },
  };
}
