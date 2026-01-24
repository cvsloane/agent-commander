import { Suspense } from 'react';
import OrchestratorPageClient from './OrchestratorPageClient';

export const dynamic = 'force-dynamic';

export default function OrchestratorPage() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-6">Loading orchestrator...</div>}>
      <OrchestratorPageClient />
    </Suspense>
  );
}
