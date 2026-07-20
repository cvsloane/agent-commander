import type { SessionWithSnapshot } from '@agent-command/schema';
import { Button } from '@/components/ui/button';
import { SessionListGrid, type SessionListGridProps } from './SessionListGrid';

export function partitionWorkflowSessions(sessions: SessionWithSnapshot[]) {
  const isIdle = (session: SessionWithSnapshot) =>
    Boolean(session.idled_at) || session.status === 'IDLE';
  return {
    active: sessions.filter(
      (session) => !isIdle(session) && ['RUNNING', 'STARTING'].includes(session.status)
    ),
    needsAttention: sessions.filter(
      (session) =>
        !isIdle(session) &&
        ['WAITING_FOR_INPUT', 'WAITING_FOR_APPROVAL', 'ERROR'].includes(session.status)
    ),
    idle: sessions.filter(isIdle),
  };
}

interface SessionWorkflowListProps extends Omit<SessionListGridProps, 'sessions'> {
  sessions: SessionWithSnapshot[];
  hasNewSessions: boolean;
  onRefresh: () => void;
}

export function SessionWorkflowList({
  sessions,
  hasNewSessions,
  onRefresh,
  ...gridProps
}: SessionWorkflowListProps) {
  const groups = partitionWorkflowSessions(sessions);
  return (
    <div className="space-y-6">
      {hasNewSessions && <NewSessionsNotice onRefresh={onRefresh} />}
      <WorkflowGroup
        title="Active"
        sessions={groups.active}
        empty="No active sessions"
        gridProps={gridProps}
      />
      <WorkflowGroup
        title="Needs Attention"
        sessions={groups.needsAttention}
        empty="No sessions need attention"
        gridProps={gridProps}
      />
      <WorkflowGroup
        title="Idle"
        sessions={groups.idle}
        empty="No idle sessions"
        gridProps={gridProps}
      />
    </div>
  );
}

function WorkflowGroup({
  title,
  sessions,
  empty,
  gridProps,
}: {
  title: string;
  sessions: SessionWithSnapshot[];
  empty: string;
  gridProps: Omit<SessionListGridProps, 'sessions'>;
}) {
  return (
    <section aria-labelledby={`workflow-${title.toLowerCase().replace(/\s/g, '-')}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3
          id={`workflow-${title.toLowerCase().replace(/\s/g, '-')}`}
          className="text-sm font-semibold"
        >
          {title}
        </h3>
        <span className="text-xs text-muted-foreground">{sessions.length}</span>
      </div>
      {sessions.length > 0 ? (
        <SessionListGrid sessions={sessions} {...gridProps} />
      ) : (
        <div className="py-4 text-xs text-muted-foreground">{empty}</div>
      )}
    </section>
  );
}

export function NewSessionsNotice({
  onRefresh,
  className = '',
}: {
  onRefresh: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm ${className}`}
    >
      <span>New sessions available.</span>
      <Button variant="outline" size="mobile" onClick={onRefresh}>
        Refresh
      </Button>
    </div>
  );
}
