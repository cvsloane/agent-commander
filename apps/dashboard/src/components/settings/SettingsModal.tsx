'use client';

import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { SettingsQuickPanel } from './SettingsQuickPanel';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

export function SettingsModal({ isOpen, onClose, className }: SettingsModalProps) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className={cn('gap-0 overflow-hidden p-0', className)}>
        <SheetHeader className="border-b px-4 py-3 pr-16">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" aria-hidden="true" />
              <div>
                <SheetTitle className="text-base">Settings</SheetTitle>
                <SheetDescription className="sr-only">
                  Quick settings for Agent Commander
                </SheetDescription>
              </div>
            </div>
            <Button variant="ghost" size="mobile" asChild>
              <Link href="/settings" onClick={onClose}>
                Full settings
              </Link>
            </Button>
          </div>
        </SheetHeader>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(100%-57px)] p-4">
          <SettingsQuickPanel />
        </div>
      </SheetContent>
    </Sheet>
  );
}
