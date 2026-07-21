import type { SessionWithSnapshot } from '@agent-command/schema';
import { groupSessions, type FleetRosterGroup } from '@/lib/fleetRoster';

export interface RosterTriageSummary {
  approvalCount: number;
  waitingCount: number;
  firstSessionId: string | null;
}

export function summarizeRosterTriage(sessions: SessionWithSnapshot[]): RosterTriageSummary {
  const approvals = sessions.filter((session) => session.status === 'WAITING_FOR_APPROVAL');
  const waiting = sessions.filter((session) => session.status === 'WAITING_FOR_INPUT');
  return {
    approvalCount: approvals.length,
    waitingCount: waiting.length,
    firstSessionId: approvals[0]?.id ?? waiting[0]?.id ?? null,
  };
}

export function firstRosterTriageTarget(
  groups: FleetRosterGroup[]
): { groupKey: string; sessionId: string } | null {
  for (const group of groups) {
    const summary = summarizeRosterTriage(groupSessions(group));
    if (summary.firstSessionId) {
      return { groupKey: group.key, sessionId: summary.firstSessionId };
    }
  }
  return null;
}
