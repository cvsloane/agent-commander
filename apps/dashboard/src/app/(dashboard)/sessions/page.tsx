import { Suspense } from 'react';
import SessionsPageClient from './SessionsPageClient';

export const dynamic = 'force-dynamic';

export default function SessionsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-4 sm:py-6" role="status">
          Loading sessions…
        </div>
      }
    >
      <SessionsPageClient />
    </Suspense>
  );
}
