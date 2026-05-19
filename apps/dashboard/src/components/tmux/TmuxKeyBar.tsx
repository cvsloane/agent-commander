'use client';

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TMUX_SHORTCUT_KEYS, type TmuxShortcutKey } from '@/lib/tmuxKeys';
import { cn } from '@/lib/utils';

interface TmuxKeyBarProps {
  onInput: (data: string) => void;
  className?: string;
}

function renderIcon(icon: TmuxShortcutKey['icon']) {
  switch (icon) {
    case 'left':
      return <ChevronLeft className="h-4 w-4" />;
    case 'right':
      return <ChevronRight className="h-4 w-4" />;
    case 'up':
      return <ChevronUp className="h-4 w-4" />;
    case 'down':
      return <ChevronDown className="h-4 w-4" />;
    case null:
      return null;
  }
}

export function TmuxKeyBar({ onInput, className }: TmuxKeyBarProps) {
  return (
    <div
      className={cn('border-t bg-background px-2 py-2', className)}
      role="toolbar"
      aria-label="tmux keyboard shortcuts"
    >
      <div className="flex items-center gap-1 overflow-x-auto touch-pan-x">
        {TMUX_SHORTCUT_KEYS.map((key) => (
          <Button
            key={key.ariaLabel}
            type="button"
            variant="outline"
            size="sm"
            className="h-10 min-w-[44px] shrink-0 px-3 active:scale-95"
            onClick={() => onInput(key.data)}
            aria-label={key.ariaLabel}
          >
            {renderIcon(key.icon) || key.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
