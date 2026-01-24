'use client';

import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Bell,
  Layers,
  Server,
  Boxes,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSettingsStore } from '@/stores/settings';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  prefetch?: boolean;
}

interface SidebarNavProps {
  pendingApprovalCount?: number; // Deprecated - kept for backwards compatibility
  collapsed?: boolean;
}

export function SidebarNav({ collapsed }: SidebarNavProps) {
  const pathname = usePathname();
  const { showVisualizerInSidebar } = useSettingsStore();

  const navItems: NavItem[] = [
    {
      href: '/',
      label: 'Dashboard',
      icon: <LayoutDashboard className="h-4 w-4" />,
    },
    {
      href: '/orchestrator',
      label: 'Orchestrator',
      icon: <Bell className="h-4 w-4" />,
    },
    {
      href: '/sessions',
      label: 'Sessions',
      icon: <Layers className="h-4 w-4" />,
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
    if (href === '/') {
      return pathname === '/';
    }
    return pathname.startsWith(href);
  };

  if (collapsed) {
    return (
      <>
        {navItems.map((item) => (
          <Tooltip key={item.href} delayDuration={0}>
            <TooltipTrigger asChild>
              <a
                href={item.href}
                className={cn(
                  'relative flex items-center justify-center h-10 w-10 rounded-md transition-colors',
                  isActive(item.href)
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                {item.icon}
                {item.badge !== undefined && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[10px] text-white font-medium">
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </a>
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
        <a
          key={item.href}
          href={item.href}
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-md transition-colors',
            isActive(item.href)
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          {item.icon}
          <span className="flex-1 text-sm font-medium">{item.label}</span>
          {item.badge !== undefined && (
            <Badge variant="secondary" className="bg-orange-500 text-white text-xs px-1.5">
              {item.badge}
            </Badge>
          )}
        </a>
      ))}
    </nav>
  );
}
