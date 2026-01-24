import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground shadow',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground shadow',
        outline: 'text-foreground',
        running: 'border-transparent bg-green-500 text-white',
        idle: 'border-transparent bg-slate-400 text-white',
        waiting: 'border-transparent bg-amber-500 text-white',
        approval: 'border-transparent bg-orange-500 text-white',
        error: 'border-transparent bg-red-500 text-white',
        done: 'border-transparent bg-blue-500 text-white',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

export function getStatusBadgeVariant(
  status: string
): 'running' | 'idle' | 'waiting' | 'approval' | 'error' | 'done' | 'default' {
  switch (status) {
    case 'RUNNING':
      return 'running';
    case 'IDLE':
      return 'idle';
    case 'STARTING':
      return 'default';
    case 'WAITING_FOR_INPUT':
      return 'waiting';
    case 'WAITING_FOR_APPROVAL':
      return 'approval';
    case 'ERROR':
      return 'error';
    case 'DONE':
      return 'done';
    default:
      return 'default';
  }
}
