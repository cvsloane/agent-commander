'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, Layers, Menu, Rows3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui';

const primaryItems = [
  { href: '/tmux', label: 'tmux', icon: Rows3 },
  { href: '/orchestrator', label: 'Orchestrator', icon: Bot },
  { href: '/sessions', label: 'Sessions', icon: Layers },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname();
  const mobileMenuOpen = useUIStore((state) => state.mobileMenuOpen);
  const setMobileMenuOpen = useUIStore((state) => state.setMobileMenuOpen);
  const moreActive = mobileMenuOpen || !primaryItems.some((item) => (
    pathname === item.href || pathname.startsWith(`${item.href}/`)
  ));

  return (
    <nav
      aria-label="Primary mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="grid h-16 grid-cols-4 px-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        {primaryItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className={cn('h-5 w-5', active && 'stroke-[2.5]')} />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          id="mobile-more-navigation"
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-navigation-drawer"
          className={cn(
            'flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            moreActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Menu className="h-5 w-5" />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
