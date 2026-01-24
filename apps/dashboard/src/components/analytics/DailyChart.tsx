'use client';

import { useMemo } from 'react';
import type { WeeklyUsageDay } from '@/lib/api';

interface DailyChartProps {
  data: WeeklyUsageDay[];
}

export function DailyChart({ data }: DailyChartProps) {
  // Generate all 7 days of the week for display
  const chartData = useMemo(() => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const today = new Date();
    const weekStart = new Date(today);
    // Find Monday of current week
    const dayOfWeek = today.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    weekStart.setDate(today.getDate() + diff);
    weekStart.setHours(0, 0, 0, 0);

    // Create a map of date -> tokens
    const tokensByDate = new Map<string, number>();
    for (const day of data) {
      const dateStr = new Date(day.date).toISOString().split('T')[0];
      tokensByDate.set(dateStr, day.tokens);
    }

    // Build the 7 days
    const result = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      const isFuture = date > today;

      result.push({
        day: days[i],
        date: dateStr,
        tokens: tokensByDate.get(dateStr) || 0,
        isFuture,
        isToday: date.toDateString() === today.toDateString(),
      });
    }

    return result;
  }, [data]);

  // Find max for scaling
  const maxTokens = Math.max(...chartData.map(d => d.tokens), 1);

  return (
    <div className="flex items-end gap-1 h-16">
      {chartData.map((day) => {
        const height = day.isFuture ? 0 : Math.max(4, (day.tokens / maxTokens) * 100);

        return (
          <div
            key={day.date}
            className="flex-1 flex flex-col items-center gap-1"
          >
            <div
              className="w-full bg-muted rounded-sm relative group"
              style={{ height: '48px' }}
            >
              <div
                className={`absolute bottom-0 left-0 right-0 rounded-sm transition-all ${
                  day.isToday
                    ? 'bg-primary'
                    : day.isFuture
                    ? 'bg-muted'
                    : 'bg-primary/60'
                }`}
                style={{ height: `${height}%` }}
              />
              {/* Tooltip on hover */}
              {day.tokens > 0 && (
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                  {(day.tokens / 1000).toFixed(0)}K tokens
                </div>
              )}
            </div>
            <span className={`text-[10px] ${day.isToday ? 'font-medium' : 'text-muted-foreground'}`}>
              {day.day}
            </span>
          </div>
        );
      })}
    </div>
  );
}
