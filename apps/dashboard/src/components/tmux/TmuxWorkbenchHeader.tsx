'use client';

import Link from 'next/link';
import { ExternalLink, Moon, Plug, Power, Send, Sun } from 'lucide-react';
import type { Host, Session } from '@agent-command/schema';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getProviderIcon, getSessionDisplayName } from '@/lib/utils';

interface TmuxWorkbenchHeaderProps {
  session: Session;
  host?: Host;
  idlePending: boolean;
  terminating: boolean;
  onIdleToggle: () => void;
  onSendTo: () => void;
  onOpenMcp: () => void;
  onTerminate: () => void;
}

export function TmuxWorkbenchHeader({
  session,
  host,
  idlePending,
  terminating,
  onIdleToggle,
  onSendTo,
  onOpenMcp,
  onTerminate,
}: TmuxWorkbenchHeaderProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-mono">
                {getProviderIcon(session.provider)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-xl font-semibold">
                    {getSessionDisplayName(session)}
                  </h2>
                  <StatusBadge
                    status={session.status}
                    host={host}
                    className="h-7 px-2 py-0 text-xs"
                  />
                </div>
                <div className="text-sm text-muted-foreground">
                  {session.tmux_target || session.cwd || 'No working directory'}
                </div>
                {session.git_branch && (
                  <div className="text-xs text-muted-foreground">
                    {session.git_branch}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onIdleToggle}
              disabled={idlePending}
              className="gap-1"
              title={session.idled_at ? 'Wake session' : 'Mark idle'}
            >
              {session.idled_at ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {session.idled_at ? 'Wake' : 'Idle'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onSendTo}
              className="gap-1"
            >
              <Send className="h-4 w-4" />
              Send to...
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenMcp}
              className="gap-1"
            >
              <Plug className="h-4 w-4" />
              MCP
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onTerminate}
              disabled={terminating}
              className="gap-1 text-destructive hover:text-destructive"
            >
              <Power className="h-4 w-4" />
              Terminate
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1">
              <Link href={`/sessions/${session.id}`}>
                <ExternalLink className="h-4 w-4" />
                Full page
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
