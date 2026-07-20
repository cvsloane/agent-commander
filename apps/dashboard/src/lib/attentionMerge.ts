export type AttentionItemSource =
  | 'snapshot'
  | 'approval'
  | 'status'
  | 'governance'
  | 'run';

export interface MergeableAttentionItem {
  id: string;
  source: AttentionItemSource;
  sessionId: string | null;
  sessionStatus: string;
  createdAt: number;
  dismissedAt?: number;
  idledAt?: number;
  attentionReason?: string;
  action?: {
    type:
      | 'multi_choice'
      | 'yes_no'
      | 'text_input'
      | 'plan_review'
      | 'error'
      | 'needs_attention';
  } | null;
  automationRunId?: string;
  governanceRunId?: string | null;
}

function sessionPreference(item: MergeableAttentionItem): number {
  if (item.attentionReason) return 40;
  if (item.source === 'snapshot') return 30;
  return 20;
}

function priority(item: MergeableAttentionItem, now: number): number {
  const actionType = item.action?.type;
  let score = 0;
  if (item.source === 'governance') score += 120;
  else if (item.source === 'approval') score += 110;
  else if (item.source === 'run' && actionType === 'error') score += 100;
  else if (item.attentionReason) score += 90;
  else if (item.source === 'run') score += 80;
  else if (item.source === 'snapshot') score += 70;
  else if (item.source === 'status') score += 60;

  if (actionType === 'plan_review') score += 8;
  if (actionType === 'yes_no') score += 6;
  if (actionType === 'multi_choice') score += 4;
  if (actionType === 'error') score += 3;

  const waitMinutes = Math.max(0, Math.floor((now - item.createdAt) / 60_000));
  return score + Math.min(waitMinutes, 30);
}

/**
 * Produce the operator's single attention queue.
 *
 * Session status, snapshot detection, and approval events can describe the
 * same underlying interruption, so only the most authoritative one survives.
 * A governance request also subsumes the blocked run that created it, while
 * unrelated failed/blocked runs remain visible.
 */
export function mergeAttentionItems<T extends MergeableAttentionItem>(
  items: T[],
  now: number = Date.now()
): T[] {
  const visible = items.filter((item) => !item.dismissedAt && !item.idledAt);
  const governedRunIds = new Set(
    visible
      .filter((item) => item.source === 'governance' && item.governanceRunId)
      .map((item) => item.governanceRunId as string)
  );
  const candidates = visible.filter(
    (item) =>
      !(
        item.source === 'run' &&
        item.automationRunId &&
        governedRunIds.has(item.automationRunId)
      )
  );
  const sessionsWithApprovals = new Set(
    candidates
      .filter((item) => item.source === 'approval' && item.sessionId)
      .map((item) => item.sessionId as string)
  );

  const sessionItems = new Map<string, T>();
  const independentItems: T[] = [];

  for (const item of candidates) {
    // Every approval is an independently actionable decision. Its presence
    // suppresses the less-specific snapshot/status signal for that session,
    // but never another pending approval.
    if (item.source === 'approval') {
      independentItems.push(item);
      continue;
    }

    const isSessionSignal = ['snapshot', 'status'].includes(item.source);
    if (!isSessionSignal || !item.sessionId) {
      independentItems.push(item);
      continue;
    }
    if (sessionsWithApprovals.has(item.sessionId)) continue;

    const existing = sessionItems.get(item.sessionId);
    if (
      !existing ||
      sessionPreference(item) > sessionPreference(existing) ||
      (sessionPreference(item) === sessionPreference(existing) && item.createdAt > existing.createdAt)
    ) {
      sessionItems.set(item.sessionId, item);
    }
  }

  return [...independentItems, ...sessionItems.values()].sort((left, right) => {
    const scoreDifference = priority(right, now) - priority(left, now);
    if (scoreDifference !== 0) return scoreDifference;
    return right.createdAt - left.createdAt;
  });
}

export interface OrchestratorAttentionFamily {
  orchestratorId: string;
  sessionIds: string[];
}

/** Assign attention to the orchestrator that owns the affected session or run. */
export function assignAttentionToOrchestrators<T extends MergeableAttentionItem>(
  items: T[],
  families: OrchestratorAttentionFamily[],
  runSessionById: Record<string, string | null | undefined> = {}
): Record<string, T[]> {
  const ownerBySessionId = new Map<string, string>();
  for (const family of families) {
    ownerBySessionId.set(family.orchestratorId, family.orchestratorId);
    family.sessionIds.forEach((sessionId) => ownerBySessionId.set(sessionId, family.orchestratorId));
  }

  const assigned: Record<string, T[]> = Object.fromEntries(
    families.map((family) => [family.orchestratorId, []])
  );
  for (const item of items) {
    const runId = item.automationRunId || item.governanceRunId || undefined;
    const targetSessionId = item.sessionId || (runId ? runSessionById[runId] : null);
    if (!targetSessionId) continue;
    const ownerId = ownerBySessionId.get(targetSessionId);
    if (ownerId) assigned[ownerId]?.push(item);
  }
  return assigned;
}
