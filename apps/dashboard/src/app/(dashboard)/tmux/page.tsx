import { Suspense } from 'react';
import TmuxPageClient from './TmuxPageClient';

export const dynamic = 'force-dynamic';

export default function TmuxPage() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-6">Loading...</div>}>
      <TmuxPageClient />
    </Suspense>
  );
}
