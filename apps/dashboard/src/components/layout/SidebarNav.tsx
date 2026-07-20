'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Bell,
  Layers,
  Server,
  Boxes,
  Workflow,
  Brain,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSettingsStore } from '@/stores/settings';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  prefetch?: boolean;
}

interface SidebarNavProps {
  collapsed?: boolean;
}

export function SidebarNav({ collapsed }: SidebarNavProps) {
  const pathname = usePathname();
  const { showVisualizerInSidebar } = useSettingsStore();

  const navItems: NavItem[] = [
    {
      href: '/',
      label: 'Command Center',
      icon: <LayoutDashboard className="h-4 w-4" />,
    },
    {
      href: '/orchestrator?tab=attention',
      label: 'Attention',
      icon: <Bell className="h-4 w-4" />,
    },
    {
      href: '/sessions',
      label: 'Sessions',
      icon: <Layers className="h-4 w-4" />,
    },
    {
      href: '/automation',
      label: 'Automation',
      icon: <Workflow className="h-4 w-4" />,
    },
    {
      href: '/memory',
      label: 'Memory',
      icon: <Brain className="h-4 w-4" />,
    },
    ...(showVisualizerInSidebar
      ? [
          {
            href: '/visualizer',
            label: 'Visualizer',
            icon: <Boxes className="h-4 w-4" />,
            prefetch: false,
          },
        ]
      : []),
    {
      href: '/hosts',
      label: 'Hosts',
      icon: <Server className="h-4 w-4" />,
    },
    {
      href: '/settings',
      label: 'Settings',
      icon: <Settings className="h-4 w-4" />,
    },
  ];

  const isActive = (href: string) => {
    const path = href.split('?')[0];
    if (path === '/') {
      return pathname === '/';
    }
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  if (collapsed) {
    return (
      <>
        {navItems.map((item) => (
          <Tooltip key={item.href} delayDuration={0}>
            <TooltipTrigger asChild>
              <Link
                href={item.href}
                prefetch={item.prefetch}
                className={cn(
                  'relative flex h-11 w-11 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive(item.href)
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                {item.icon}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{item.label}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </>
    );
  }

  return (
    <nav className="p-2 space-y-1">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={item.prefetch}
          className={cn(
            'flex min-h-11 items-center gap-3 rounded-md px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isActive(item.href)
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          {item.icon}
          <span className="flex-1 text-sm font-medium">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
