import { Inter } from 'next/font/google';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LayoutShell } from '@/components/layout';
import { HeaderConnectionStatus } from '@/components/layout/HeaderConnectionStatus';
import { AuthControls } from '@/components/auth/AuthControls';
import { OrchestratorButton, OrchestratorSheet } from '@/components/orchestrator';

const inter = Inter({ subsets: ['latin'] });

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${inter.className} flex h-dvh flex-col overflow-hidden bg-background`}>
      {/* Header */}
      <header className="shrink-0 border-b pt-[env(safe-area-inset-top)]">
        <div className="flex h-[57px] items-center justify-between pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex min-h-11 items-center text-xl font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="hidden sm:inline">Agent Commander</span>
              <span className="sm:hidden">AC</span>
            </Link>
            <HeaderConnectionStatus />
          </div>
          <div className="flex items-center gap-2">
            <OrchestratorButton />
            <ThemeToggle />
            <AuthControls />
          </div>
        </div>
      </header>

      {/* Main content with sidebar */}
      <LayoutShell>{children}</LayoutShell>

      {/* Global overlay */}
      <OrchestratorSheet />
    </div>
  );
}
