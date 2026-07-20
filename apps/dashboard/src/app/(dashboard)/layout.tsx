import { Inter } from 'next/font/google';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LayoutShell } from '@/components/layout';
import { MobileHeader } from '@/components/layout/MobileHeader';
import { SettingsButton } from '@/components/settings';
import { AuthControls } from '@/components/auth/AuthControls';
import { OrchestratorButton, OrchestratorModal } from '@/components/orchestrator';

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
            <MobileHeader />
            <a href="/" className="text-xl font-bold">
              <span className="hidden sm:inline">Agent Commander</span>
              <span className="sm:hidden">AC</span>
            </a>
          </div>
          <div className="flex items-center gap-2">
            <OrchestratorButton />
            <ThemeToggle />
            <SettingsButton />
            <AuthControls />
          </div>
        </div>
      </header>

      {/* Main content with sidebar */}
      <LayoutShell>{children}</LayoutShell>

      {/* Global overlay */}
      <OrchestratorModal />
    </div>
  );
}
