import type { NextAuthOptions } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';
import CredentialsProvider from 'next-auth/providers/credentials';
import { createHash, timingSafeEqual } from 'node:crypto';

function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const adminEmails = parseList(process.env.ADMIN_EMAILS);
const allowedEmails = parseList(process.env.ALLOWED_EMAILS);
const sessionDaysRaw = Number.parseInt(process.env.AUTH_SESSION_DAYS || '30', 10);
const sessionDays = Number.isFinite(sessionDaysRaw) && sessionDaysRaw > 0 ? sessionDaysRaw : 30;
const sessionMaxAge = sessionDays * 24 * 60 * 60;
const accessCodeMaxAttemptsRaw = Number.parseInt(process.env.ACCESS_CODE_MAX_ATTEMPTS || '5', 10);
const accessCodeMaxAttempts = Number.isFinite(accessCodeMaxAttemptsRaw) && accessCodeMaxAttemptsRaw > 0
  ? accessCodeMaxAttemptsRaw
  : 5;
const accessCodeWindowSecondsRaw = Number.parseInt(process.env.ACCESS_CODE_WINDOW_SECONDS || '300', 10);
const accessCodeWindowMs = (
  Number.isFinite(accessCodeWindowSecondsRaw) && accessCodeWindowSecondsRaw > 0
    ? accessCodeWindowSecondsRaw
    : 300
) * 1000;
const maxTrackedAccessCodeSources = 10_000;
const accessCodeAttempts = new Map<string, { failures: number; resetAt: number }>();

function resolveRole(email?: string | null): 'admin' | 'operator' | 'viewer' {
  if (email && adminEmails.includes(email)) return 'admin';
  return 'viewer';
}

function secureSecretMatch(provided: string, expected: string): boolean {
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function accessCodeAttemptKey(headers: Record<string, string | string[] | undefined>): string {
  const forwarded = headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (forwardedValue) return forwardedValue.split(',', 1)[0]?.trim() || 'unknown';
  const realIp = headers['x-real-ip'];
  return (Array.isArray(realIp) ? realIp[0] : realIp)?.trim() || 'unknown';
}

function accessCodeAttemptAllowed(key: string, now: number): boolean {
  const attempt = accessCodeAttempts.get(key);
  if (!attempt) return true;
  if (attempt.resetAt <= now) {
    accessCodeAttempts.delete(key);
    return true;
  }
  return attempt.failures < accessCodeMaxAttempts;
}

function recordAccessCodeFailure(key: string, now: number): void {
  for (const [candidateKey, attempt] of accessCodeAttempts) {
    if (attempt.resetAt <= now) accessCodeAttempts.delete(candidateKey);
  }
  if (!accessCodeAttempts.has(key) && accessCodeAttempts.size >= maxTrackedAccessCodeSources) {
    const oldestKey = accessCodeAttempts.keys().next().value;
    if (oldestKey) accessCodeAttempts.delete(oldestKey);
  }
  const current = accessCodeAttempts.get(key);
  if (!current || current.resetAt <= now) {
    accessCodeAttempts.set(key, { failures: 1, resetAt: now + accessCodeWindowMs });
    return;
  }
  current.failures += 1;
}

// Build providers list dynamically based on env vars
const providers: NextAuthOptions['providers'] = [];

// Add Credentials provider if ACCESS_SECRET is set
if (process.env.ACCESS_SECRET) {
  providers.push(
    CredentialsProvider({
      name: 'Access Code',
      credentials: {
        code: { label: 'Access Code', type: 'password', placeholder: 'Enter access code' },
      },
      async authorize(credentials, request) {
        const attemptKey = accessCodeAttemptKey(request.headers || {});
        const now = Date.now();
        if (!accessCodeAttemptAllowed(attemptKey, now)) {
          return null;
        }

        const submittedCode = credentials?.code || '';
        const expectedCode = process.env.ACCESS_SECRET || '';
        if (submittedCode && expectedCode && secureSecretMatch(submittedCode, expectedCode)) {
          accessCodeAttempts.delete(attemptKey);
          return {
            id: 'admin',
            name: 'Admin',
            email: adminEmails[0] || 'admin@local',
          };
        }
        recordAccessCodeFailure(attemptKey, now);
        return null;
      },
    })
  );
}

// Add GitHub provider if credentials are set
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  providers.push(
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    })
  );
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers,
  pages: {
    signIn: '/signin',
  },
  session: {
    strategy: 'jwt',
    maxAge: sessionMaxAge,
    updateAge: 24 * 60 * 60,
  },
  jwt: {
    maxAge: sessionMaxAge,
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      // Credentials provider (access code) - always allow if authorize() succeeded
      if (account?.provider === 'credentials') {
        return true;
      }
      // OAuth providers - check allowed emails
      const email = (profile as { email?: string | null })?.email || user?.email || null;
      if (allowedEmails.length === 0 || !email || !allowedEmails.includes(email)) {
        return false;
      }
      return true;
    },
    async jwt({ token, profile, user }) {
      if (user) {
        const userEmail = (user as { email?: string | null })?.email || undefined;
        const userName = (user as { name?: string | null })?.name || undefined;
        const userId = (user as { id?: string | number })?.id;
        if (userEmail) token.email = userEmail;
        if (userName) token.name = userName;
        if (!token.sub && userId) token.sub = String(userId);
      }
      if (profile) {
        const email = (profile as { email?: string | null })?.email || undefined;
        token.email = email || token.email;
        token.name = (profile as { name?: string | null })?.name || token.name;
        if (!token.sub && (profile as { id?: string })?.id) {
          token.sub = String((profile as { id?: string }).id);
        }
      }
      token.role = resolveRole(token.email as string | undefined);
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub || '';
        session.user.role = (token.role as string) || 'viewer';
      }
      return session;
    },
  },
};
