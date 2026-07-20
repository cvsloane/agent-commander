import { Suspense } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { AttentionSummary } from '@/components/layout/AttentionSummary';
import { LaunchRail } from '@/components/launch/LaunchRail';
import TmuxPageClient from './tmux/TmuxPageClient';

export const dynamic = 'force-dynamic';

export default function CommandCenterPage() {
  return (
    <div className="pb-6">
      <div className="mx-auto w-full max-w-[1800px] space-y-3 py-4 sm:px-4 sm:py-6">
        <header className="flex items-start gap-3 px-4 sm:px-0">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <LayoutDashboard className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold sm:text-2xl">Command Center</h1>
            <p className="text-sm text-muted-foreground">Your live tmux fleet, ready for the next operator action.</p>
          </div>
        </header>
        <AttentionSummary />
        <LaunchRail />
      </div>

      <Suspense fallback={<div className="px-4 py-8 text-sm text-muted-foreground">Loading Command Center…</div>}>
        <TmuxPageClient />
      </Suspense>
    </div>
  );
}
