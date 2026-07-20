import { Suspense } from 'react';
import AutomationPageClient from './AutomationPageClient';

export const dynamic = 'force-dynamic';

export default function AutomationPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-16 text-sm text-muted-foreground">Loading automation…</div>}>
      <AutomationPageClient />
    </Suspense>
  );
}
