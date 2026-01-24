'use client';

import { cn } from '@/lib/utils';

interface UsageMeterProps {
  current: number;
  limit: number;
  percentage: number;
}

export function UsageMeter({ percentage }: UsageMeterProps) {
  // Determine color based on usage percentage
  const getColor = () => {
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 75) return 'bg-orange-500';
    if (percentage >= 50) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="space-y-1">
      <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            getColor()
          )}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
    </div>
  );
}
