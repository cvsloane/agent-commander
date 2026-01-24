'use client';

import { useEffect, useMemo, useState } from 'react';
import { getProviders, signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

const errorMessages: Record<string, string> = {
  CredentialsSignin: 'Invalid access code.',
  OAuthSignin: 'OAuth sign-in failed. Try again.',
  OAuthCallback: 'OAuth callback failed. Try again.',
  OAuthCreateAccount: 'Could not create OAuth account.',
  EmailCreateAccount: 'Could not create email account.',
  Callback: 'Sign-in callback failed.',
  OAuthAccountNotLinked: 'Account not linked. Use the same provider you signed in with.',
  EmailSignin: 'Email sign-in failed.',
  InvalidToken: 'Session token is invalid. Sign in again.',
  SessionExpired: 'Session expired. Please sign in again.',
  Default: 'Sign-in failed. Try again.',
};

export default function SignInPage() {
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [providers, setProviders] = useState<Record<string, { id: string; name: string }> | null>(
    null
  );

  useEffect(() => {
    getProviders()
      .then((next) => setProviders(next))
      .catch(() => setProviders(null));

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      setError(params.get('error'));
    }
  }, []);

  const hasCredentials = useMemo(
    () => Boolean(providers?.credentials),
    [providers]
  );
  const hasGithub = useMemo(
    () => Boolean(providers?.github),
    [providers]
  );

  const errorText = error ? errorMessages[error] || errorMessages.Default : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 space-y-4">
          <div>
            <h1 className="text-lg font-semibold">Sign in</h1>
            <p className="text-sm text-muted-foreground">Access your Agent Commander dashboard.</p>
          </div>

          {errorText && (
            <div className="text-sm text-destructive">{errorText}</div>
          )}

          {hasCredentials && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                signIn('credentials', {
                  code,
                  callbackUrl: '/',
                });
              }}
            >
              <div className="space-y-2">
                <label htmlFor="access-code" className="text-xs font-medium text-muted-foreground">Access code</label>
                <Input
                  id="access-code"
                  type="password"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Enter access code"
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full">
                Sign in with access code
              </Button>
            </form>
          )}

          {hasGithub && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => signIn('github', { callbackUrl: '/' })}
            >
              Sign in with GitHub
            </Button>
          )}

          {!hasCredentials && !hasGithub && (
            <div className="text-sm text-muted-foreground">
              No sign-in providers are configured.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
