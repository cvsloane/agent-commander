import { Suspense } from 'react';
import AutomationPageClient from './AutomationPageClient';

export const dynamic = 'force-dynamic';

export default function AutomationPage() {
  return (
    <Suspense
      fallback={
        <div
          className="mx-auto flex w-full max-w-7xl items-center justify-center px-3 py-16 text-sm text-muted-foreground sm:px-4"
          role="status"
        >
          Loading automation…
        </div>
      }
    >
      <AutomationPageClient />
    </Suspense>
  );
}
