import { Inter } from 'next/font/google';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LayoutShell } from '@/components/layout';
import { MobileHeader } from '@/components/layout/MobileHeader';
import { SettingsButton } from '@/components/settings';
import { AuthControls } from '@/components/auth/AuthControls';

const inter = Inter({ subsets: ['latin'] });

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${inter.className} min-h-screen bg-background`}>
      {/* Header */}
      <header className="border-b h-[57px]">
        <div className="h-full px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MobileHeader />
            <a href="/" className="text-xl font-bold">
              <span className="hidden sm:inline">Agent Commander</span>
              <span className="sm:hidden">AC</span>
            </a>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <SettingsButton />
            <AuthControls />
          </div>
        </div>
      </header>

      {/* Main content with sidebar */}
      <LayoutShell>{children}</LayoutShell>
    </div>
  );
}
