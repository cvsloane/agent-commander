import { Suspense } from 'react';
import SessionsPageClient from './SessionsPageClient';

export const dynamic = 'force-dynamic';

export default function SessionsPage() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-6">Loading...</div>}>
      <SessionsPageClient />
    </Suspense>
  );
}
