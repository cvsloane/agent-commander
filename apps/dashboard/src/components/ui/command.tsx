'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

const Command = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-md bg-background text-foreground',
        className
      )}
      {...props}
    />
  )
);
Command.displayName = 'Command';

interface CommandDialogProps extends React.ComponentProps<typeof Dialog> {
  title?: string;
  description?: string;
  contentClassName?: string;
}

function CommandDialog({
  children,
  title = 'Command palette',
  description = 'Search for a command to run',
  contentClassName,
  ...props
}: CommandDialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent
        hideClose
        className={cn(
          'top-[15dvh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl',
          contentClassName
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

const CommandInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { loading?: boolean }
>(({ className, loading, ...props }, ref) => (
  <div className="flex min-h-12 items-center gap-2 border-b px-3" data-command-input-wrapper="">
    <Search
      className={cn('h-4 w-4 shrink-0 text-muted-foreground', loading && 'animate-pulse')}
      aria-hidden="true"
    />
    <input
      ref={ref}
      className={cn(
        'h-12 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = 'CommandInput';

const CommandList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="listbox"
      className={cn('max-h-[min(55dvh,28rem)] overflow-y-auto p-1', className)}
      {...props}
    />
  )
);
CommandList.displayName = 'CommandList';

const CommandEmpty = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('py-8 text-center text-sm text-muted-foreground', className)}
      {...props}
    />
  )
);
CommandEmpty.displayName = 'CommandEmpty';

const CommandGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      className={cn(
        'overflow-hidden p-1 text-foreground [&_[data-command-heading]]:px-2 [&_[data-command-heading]]:py-1.5',
        '[&_[data-command-heading]]:text-xs [&_[data-command-heading]]:font-medium [&_[data-command-heading]]:text-muted-foreground',
        className
      )}
      {...props}
    />
  )
);
CommandGroup.displayName = 'CommandGroup';

function CommandHeading({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-command-heading="" className={className} {...props} />;
}

const CommandSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} role="separator" className={cn('-mx-1 h-px bg-border', className)} {...props} />
  )
);
CommandSeparator.displayName = 'CommandSeparator';

const CommandItem = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, type = 'button', 'aria-selected': ariaSelected = false, ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    role="option"
    className={cn(
      'relative flex min-h-11 w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none transition-colors',
      'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
      'aria-selected:bg-accent aria-selected:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
      className
    )}
    {...props}
    aria-selected={ariaSelected}
  />
));
CommandItem.displayName = 'CommandItem';

function CommandShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandHeading,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
