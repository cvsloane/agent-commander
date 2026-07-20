'use client';

import type { KeyboardEvent } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TMUX_SHORTCUT_KEYS, type TmuxShortcutKey } from '@/lib/tmuxKeys';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';

interface TmuxKeyBarProps {
  onInput: (data: string) => void;
  className?: string;
  collapsible?: boolean;
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

function handleToolbarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
  );
  const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (currentIndex === -1 || buttons.length === 0) return;
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? buttons.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[nextIndex]?.focus();
}

export function TmuxKeyBar({ onInput, className, collapsible = false }: TmuxKeyBarProps) {
  const expanded = useSettingsStore((state) => state.tmuxKeyBarExpanded);
  const setExpanded = useSettingsStore((state) => state.setTmuxKeyBarExpanded);

  if (collapsible && !expanded) {
    return (
      <div className={cn('flex justify-end border-t bg-background px-2 py-1', className)}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          aria-controls="tmux-key-bar"
        >
          <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
          tmux keys
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <div
      id="tmux-key-bar"
      className={cn('border-t bg-background px-2 pb-2 pt-2', className)}
      role="toolbar"
      aria-label="tmux keyboard shortcuts"
      aria-orientation="horizontal"
      onKeyDown={handleToolbarKeyDown}
    >
      {collapsible && (
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">tmux keys</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => setExpanded(false)}
            aria-expanded={true}
          >
            Collapse
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}
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
