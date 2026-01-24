import type { NextAuthOptions } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';
import CredentialsProvider from 'next-auth/providers/credentials';

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

function resolveRole(email?: string | null): 'admin' | 'operator' | 'viewer' {
  if (email && adminEmails.includes(email)) return 'admin';
  return 'operator';
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
      async authorize(credentials) {
        if (credentials?.code === process.env.ACCESS_SECRET) {
          return {
            id: 'admin',
            name: 'Admin',
            email: adminEmails[0] || 'admin@local',
          };
        }
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
      if (allowedEmails.length > 0 && (!email || !allowedEmails.includes(email))) {
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
      if (!token.role) {
        token.role = resolveRole(token.email as string | undefined);
      }
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
