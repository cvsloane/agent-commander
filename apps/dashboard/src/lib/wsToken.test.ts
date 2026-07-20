import { afterEach, describe, expect, it, vi } from 'vitest';

describe('WebSocket ticket client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('exchanges the dashboard JWT for a fresh one-time WebSocket ticket', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ token: 'dashboard-jwt', exp: 4_000_000_000 }))
      .mockResolvedValueOnce(Response.json({
        ticket: 'one-time-ticket',
        expires_at: '2099-01-01T00:00:00.000Z',
      }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const { getWebSocketTicket } = await import('./wsToken');

    await expect(getWebSocketTicket()).resolves.toBe('one-time-ticket');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/v1/auth/ws-ticket',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer dashboard-jwt' },
      })
    );
  });
});
