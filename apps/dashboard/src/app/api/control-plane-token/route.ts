import { getServerSession } from 'next-auth';
import { SignJWT } from 'jose';
import { authOptions } from '@/lib/auth';

const TOKEN_TTL_SECONDS = 300; // 5 minutes

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const secret = process.env.CONTROL_PLANE_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ error: 'Missing CONTROL_PLANE_JWT_SECRET' }), { status: 500 });
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_TTL_SECONDS;

  const token = await new SignJWT({
    email: session.user.email,
    name: session.user.name,
    role: (session.user as { role?: string }).role || 'viewer',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.user.id || session.user.email || 'unknown')
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));

  return Response.json({ token, exp });
}
