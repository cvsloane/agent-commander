'use client';

import { useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { createBrowserPushSubscriptionController } from '@/lib/pushSubscription';
import { clearControlPlaneTokenCache } from '@/lib/wsToken';

export function AuthControls() {
  const { data, status } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  if (status === 'loading') {
    return null;
  }

  if (!data?.user) {
    return (
      <Button variant="outline" size="sm" onClick={() => signIn()}>
        Log in
      </Button>
    );
  }

  const label = data.user.name || data.user.email || 'Account';
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // Remove the origin-scoped browser subscription while this user's
      // control-plane credential is still active. Local unsubscribe still
      // happens if the server is temporarily unavailable.
      await createBrowserPushSubscriptionController(data.user.id).unsubscribe();
    } catch (error) {
      console.warn('Could not remove the server push subscription during logout', error);
    } finally {
      clearControlPlaneTokenCache();
      await signOut({ callbackUrl: '/signin' });
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:inline text-xs text-muted-foreground">{label}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleSignOut()}
        disabled={signingOut}
      >
        {signingOut ? 'Logging out…' : 'Log out'}
      </Button>
    </div>
  );
}
