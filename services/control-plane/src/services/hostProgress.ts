import * as db from '../db/index.js';

export const HOST_PROGRESS_FLUSH_MS = 5_000;

type PendingProgress = {
  lastSeen: boolean;
  ackedSeq: number | null;
  timer: NodeJS.Timeout | null;
  flushing: Promise<void> | null;
};

class HostProgressBatcher {
  private pending = new Map<string, PendingProgress>();

  record(hostId: string, ackedSeq?: number): void {
    const progress = this.pending.get(hostId) ?? {
      lastSeen: false,
      ackedSeq: null,
      timer: null,
      flushing: null,
    };
    progress.lastSeen = true;
    if (ackedSeq !== undefined) {
      progress.ackedSeq = Math.max(progress.ackedSeq ?? 0, ackedSeq);
    }
    if (!progress.timer) {
      progress.timer = setTimeout(() => {
        progress.timer = null;
        void this.flush(hostId).catch(() => undefined);
      }, HOST_PROGRESS_FLUSH_MS);
      progress.timer.unref?.();
    }
    this.pending.set(hostId, progress);
  }

  async flush(hostId: string): Promise<void> {
    const progress = this.pending.get(hostId);
    if (!progress) return;
    if (progress.flushing) {
      await progress.flushing;
      return this.flush(hostId);
    }

    if (progress.timer) {
      clearTimeout(progress.timer);
      progress.timer = null;
    }

    const writeLastSeen = progress.lastSeen;
    const ackedSeq = progress.ackedSeq;
    progress.lastSeen = false;
    progress.ackedSeq = null;

    if (!writeLastSeen && ackedSeq === null) {
      this.pending.delete(hostId);
      return;
    }

    progress.flushing = Promise.all([
      writeLastSeen ? db.updateHostLastSeen(hostId) : Promise.resolve(),
      ackedSeq !== null ? db.updateHostAckedSeq(hostId, ackedSeq) : Promise.resolve(),
    ]).then(() => undefined);

    try {
      await progress.flushing;
    } catch (error) {
      progress.lastSeen ||= writeLastSeen;
      if (ackedSeq !== null) {
        progress.ackedSeq = Math.max(progress.ackedSeq ?? 0, ackedSeq);
      }
      throw error;
    } finally {
      progress.flushing = null;
      if (!progress.lastSeen && progress.ackedSeq === null) {
        this.pending.delete(hostId);
      } else if (!progress.timer) {
        progress.timer = setTimeout(() => {
          progress.timer = null;
          void this.flush(hostId).catch(() => undefined);
        }, HOST_PROGRESS_FLUSH_MS);
        progress.timer.unref?.();
      }
    }
  }
}

export const hostProgress = new HostProgressBatcher();
