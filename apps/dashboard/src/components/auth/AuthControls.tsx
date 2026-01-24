'use client';

import { signIn, signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { clearControlPlaneTokenCache } from '@/lib/wsToken';

export function AuthControls() {
  const { data, status } = useSession();

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

  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:inline text-xs text-muted-foreground">{label}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          clearControlPlaneTokenCache();
          signOut({ callbackUrl: '/signin' });
        }}
      >
        Log out
      </Button>
    </div>
  );
}
