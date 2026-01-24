'use client';
import { Clock, ExternalLink } from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/lib/utils';

export function RecentSessions() {
  const { recentSessions } = useUIStore();

  if (recentSessions.length === 0) {
    return (
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2 text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span className="text-xs font-medium uppercase">Recent</span>
        </div>
        <p className="text-xs text-muted-foreground">No recent sessions</p>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="flex items-center gap-2 mb-2 text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        <span className="text-xs font-medium uppercase">Recent</span>
      </div>
      <div className="space-y-1">
        {recentSessions.map((session) => (
          <a
            key={session.id}
            href={`/sessions/${session.id}`}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm',
              'text-muted-foreground hover:bg-accent hover:text-foreground',
              'transition-colors group'
            )}
          >
            <span
              className={cn(
                'w-2 h-2 rounded-full flex-shrink-0',
                session.status === 'RUNNING' && 'bg-green-500',
                session.status === 'IDLE' && 'bg-blue-500',
                session.status === 'WAITING_FOR_INPUT' && 'bg-yellow-500',
                session.status === 'WAITING_FOR_APPROVAL' && 'bg-orange-500',
                session.status === 'ERROR' && 'bg-red-500',
                session.status === 'DONE' && 'bg-gray-400',
                session.status === 'STARTING' && 'bg-purple-500'
              )}
            />
            <span className="flex-1 truncate text-xs">
              {session.title || session.cwd?.split('/').pop() || 'Untitled'}
            </span>
            <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
          </a>
        ))}
      </div>
    </div>
  );
}
