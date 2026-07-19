import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostId = '11111111-1111-4111-8111-111111111111';

describe('hostProgress', () => {
  const updateHostLastSeen = vi.fn(async () => undefined);
  const updateHostAckedSeq = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    updateHostLastSeen.mockClear();
    updateHostAckedSeq.mockClear();
    vi.doMock('../src/db/index.js', () => ({
      updateHostLastSeen,
      updateHostAckedSeq,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../src/db/index.js');
  });

  it('coalesces per-message writes and persists the maximum sequence within five seconds', async () => {
    const { hostProgress, HOST_PROGRESS_FLUSH_MS } =
      await import('../src/services/hostProgress.js');

    hostProgress.record(hostId, 2);
    hostProgress.record(hostId, 7);
    hostProgress.record(hostId, 4);

    await vi.advanceTimersByTimeAsync(HOST_PROGRESS_FLUSH_MS - 1);
    expect(updateHostLastSeen).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(updateHostLastSeen).toHaveBeenCalledOnce();
    expect(updateHostAckedSeq).toHaveBeenCalledOnce();
    expect(updateHostAckedSeq).toHaveBeenCalledWith(hostId, 7);
  });

  it('flushes immediately when the connection closes', async () => {
    const { hostProgress } = await import('../src/services/hostProgress.js');
    hostProgress.record(hostId, 9);

    await hostProgress.flush(hostId);

    expect(updateHostLastSeen).toHaveBeenCalledOnce();
    expect(updateHostAckedSeq).toHaveBeenCalledWith(hostId, 9);
  });
});
