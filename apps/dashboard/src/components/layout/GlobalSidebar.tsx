'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { PanelLeft, PanelLeftClose, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarNav } from './SidebarNav';
import { GroupTree } from '@/components/groups/GroupTree';
import { RecentSessions } from './RecentSessions';
import { QuickSpawn } from './QuickSpawn';
import { AttentionSettings } from './AttentionSettings';
import { useUIStore } from '@/stores/ui';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import type { GroupWithChildren } from '@/lib/groupTypes';

interface GlobalSidebarProps {
  onCreateGroup?: () => void;
  onEditGroup?: (group: GroupWithChildren) => void;
  pendingApprovalCount?: number; // Deprecated - kept for backwards compatibility
  isMobileOverlay?: boolean;
}

export function GlobalSidebar({
  onCreateGroup,
  onEditGroup,
  isMobileOverlay = false,
}: GlobalSidebarProps) {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar, mobileMenuOpen, setMobileMenuOpen } = useUIStore();
  const isMobile = useIsMobile();

  const isSessionsPage = pathname.startsWith('/sessions');

  // Close mobile menu on navigation
  useEffect(() => {
    if (isMobileOverlay) {
      setMobileMenuOpen(false);
    }
  }, [pathname, isMobileOverlay, setMobileMenuOpen]);

  // Ensure mobile menu is closed when leaving mobile viewport
  useEffect(() => {
    if (!isMobile && mobileMenuOpen) {
      setMobileMenuOpen(false);
    }
  }, [isMobile, mobileMenuOpen, setMobileMenuOpen]);

  // Mobile overlay mode: only render on mobile viewports
  if (isMobileOverlay) {
    if (!isMobile) {
      return null;
    }
    return (
      <Dialog.Root open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content
            id="mobile-navigation-drawer"
            className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-background pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] shadow-xl focus:outline-none"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              document.getElementById('mobile-more-navigation')?.focus();
            }}
          >
          {/* Header with close button */}
          <div className="flex items-center justify-between p-2 border-b h-12">
            <Dialog.Title className="px-2 text-sm font-medium">Navigation</Dialog.Title>
            <Dialog.Description className="sr-only">Navigate to the rest of Agent Commander.</Dialog.Description>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Close menu">
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <SidebarNav />

            {isSessionsPage && onCreateGroup && onEditGroup && (
              <div className="flex-1 border-t overflow-hidden">
                <GroupTree onCreateGroup={onCreateGroup} onEditGroup={onEditGroup} />
              </div>
            )}

            <div className="border-t">
              <RecentSessions />
            </div>

            <div className="border-t p-3">
              <QuickSpawn />
            </div>

            <div className="border-t p-3">
              <AttentionSettings />
            </div>
          </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  // Desktop mode: hidden on mobile
  if (isMobile) {
    return null;
  }

  return (
    <div
      className={cn(
        'h-full border-r bg-muted/30 flex flex-col transition-all duration-200 ease-in-out',
        sidebarCollapsed ? 'w-12' : 'w-64'
      )}
    >
      {/* Collapse toggle header */}
      <div className="flex items-center justify-between p-2 border-b h-12">
        {!sidebarCollapsed && (
          <span className="text-sm font-medium px-2">Navigation</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', sidebarCollapsed && 'mx-auto')}
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      </div>

      {!sidebarCollapsed ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Navigation links */}
          <SidebarNav />

          {/* Session Groups - only show on sessions page */}
          {isSessionsPage && onCreateGroup && onEditGroup && (
            <div className="flex-1 border-t overflow-hidden">
              <GroupTree
                onCreateGroup={onCreateGroup}
                onEditGroup={onEditGroup}
              />
            </div>
          )}

          {/* Recent Sessions */}
          <div className="border-t">
            <RecentSessions />
          </div>

          {/* Quick Spawn */}
          <div className="border-t p-3">
            <QuickSpawn />
          </div>

          {/* Attention/Visualization settings */}
          <div className="border-t p-3">
            <AttentionSettings />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center py-2 gap-2">
          <SidebarNav collapsed />
        </div>
      )}
    </div>
  );
}
