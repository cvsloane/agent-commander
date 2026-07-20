import { Suspense } from 'react';
import { OrchestratorSurface } from '@/components/orchestrator/OrchestratorSurface';

export const dynamic = 'force-dynamic';

export default function OrchestratorPage() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-6">Loading attention...</div>}>
      <OrchestratorSurface presentation="page" />
    </Suspense>
  );
}
