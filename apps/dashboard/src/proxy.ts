import { withAuth } from 'next-auth/middleware';

export default withAuth({
  pages: {
    signIn: '/signin',
  },
});

export const config = {
  matcher: ['/((?!api/auth|api/control-plane-token|signin|_next/static|_next/image|favicon.ico).*)'],
};
