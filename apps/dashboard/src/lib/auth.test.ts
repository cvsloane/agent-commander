import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadAuth(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  vi.stubEnv('ACCESS_SECRET', env.ACCESS_SECRET ?? 'correct-access-code');
  vi.stubEnv('ADMIN_EMAILS', env.ADMIN_EMAILS ?? 'owner@example.test');
  vi.stubEnv('ALLOWED_EMAILS', env.ALLOWED_EMAILS ?? '');
  vi.stubEnv('ACCESS_CODE_MAX_ATTEMPTS', env.ACCESS_CODE_MAX_ATTEMPTS ?? '2');
  vi.stubEnv('ACCESS_CODE_WINDOW_SECONDS', env.ACCESS_CODE_WINDOW_SECONDS ?? '300');
  return import('./auth');
}

function jwtInput(email: string, role?: string) {
  return {
    token: { sub: email, email, ...(role ? { role } : {}) },
    user: undefined,
    account: null,
    profile: undefined,
    isNewUser: false,
    trigger: undefined,
    session: undefined,
  } as never;
}

function credentialsRequest(ip: string) {
  return {
    headers: { 'x-forwarded-for': ip },
    body: {},
    query: {},
    method: 'POST',
  } as never;
}

describe('dashboard authentication policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults authenticated non-admin users to viewer while retaining owner admin access', async () => {
    const { authOptions } = await loadAuth();

    const viewerToken = await authOptions.callbacks!.jwt!(jwtInput('member@example.test'));
    const adminToken = await authOptions.callbacks!.jwt!(jwtInput('owner@example.test'));

    expect(viewerToken).toMatchObject({ role: 'viewer' });
    expect(adminToken).toMatchObject({ role: 'admin' });
  });

  it('downgrades a stale operator session that no longer has an admin email', async () => {
    const { authOptions } = await loadAuth();

    const token = await authOptions.callbacks!.jwt!(jwtInput('member@example.test', 'operator'));

    expect(token).toMatchObject({ role: 'viewer' });
  });

  it('refuses GitHub OAuth when ALLOWED_EMAILS is empty', async () => {
    const { authOptions } = await loadAuth({ ALLOWED_EMAILS: '' });

    const allowed = await authOptions.callbacks!.signIn!({
      user: { id: 'github-user', email: 'anyone@example.test' },
      account: {
        provider: 'github',
        type: 'oauth',
        providerAccountId: 'github-user',
      },
      profile: { email: 'anyone@example.test' },
      email: undefined,
      credentials: undefined,
    });

    expect(allowed).toBe(false);
  });

  it('allows only listed GitHub OAuth emails', async () => {
    const { authOptions } = await loadAuth({ ALLOWED_EMAILS: 'owner@example.test' });
    const signIn = authOptions.callbacks!.signIn!;
    const account = {
      provider: 'github',
      type: 'oauth' as const,
      providerAccountId: 'github-user',
    };

    await expect(signIn({
      user: { id: 'owner', email: 'owner@example.test' },
      account,
      profile: { email: 'owner@example.test' },
      email: undefined,
      credentials: undefined,
    })).resolves.toBe(true);
    await expect(signIn({
      user: { id: 'other', email: 'other@example.test' },
      account,
      profile: { email: 'other@example.test' },
      email: undefined,
      credentials: undefined,
    })).resolves.toBe(false);
  });

  it('throttles repeated access-code failures without blocking another source address', async () => {
    const { authOptions } = await loadAuth();
    const credentials = authOptions.providers.find((provider) => provider.id === 'credentials');
    expect(credentials?.type).toBe('credentials');
    const authorize = (credentials as {
      options: { authorize: (
        credentials: { code?: string },
        request: ReturnType<typeof credentialsRequest>
      ) => Promise<unknown> };
    }).options.authorize;

    await expect(Promise.resolve(authorize({ code: 'wrong' }, credentialsRequest('192.0.2.10')))).resolves.toBeNull();
    await expect(Promise.resolve(authorize({ code: 'also-wrong' }, credentialsRequest('192.0.2.10')))).resolves.toBeNull();
    await expect(Promise.resolve(authorize({ code: 'correct-access-code' }, credentialsRequest('192.0.2.10')))).resolves.toBeNull();
    await expect(Promise.resolve(authorize({ code: 'correct-access-code' }, credentialsRequest('192.0.2.11')))).resolves.toMatchObject({
      id: 'admin',
    });
  });
});
