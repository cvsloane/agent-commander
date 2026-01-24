import { create } from 'zustand';
import type { Session, Approval, ApprovalInput, ApprovalType } from '@agent-command/schema';
import {
  analyzeSnapshot,
  generateCaptureHash,
  stripAnsi,
  type DetectedAction,
} from '@/components/orchestrator/DetectionEngine';

/**
 * Orchestrator Item - represents something that needs user attention
 */
export interface OrchestratorItem {
  id: string;
  sessionId: string;
  sessionTitle: string | null;
  sessionCwd: string | null;
  sessionProvider: string | null;
  sessionStatus: string;
  source: 'snapshot' | 'approval' | 'status';
  action: DetectedAction | null;
  approval?: Approval;
  approvalInput?: ApprovalInput;
  approvalType?: ApprovalType;
  createdAt: number;
  dismissedAt?: number;
  idledAt?: number;
  summary?: string;
  summaryLoading?: boolean;
  summaryFailed?: boolean;
  captureHash?: string;
}

/**
 * Session with optional snapshot data
 */
interface SessionWithSnapshot extends Session {
  latest_snapshot?: {
    created_at: string;
    capture_text: string;
    capture_hash?: string;
  } | null;
}

/**
 * Orchestrator Store State
 */
interface OrchestratorState {
  // Modal state
  isOpen: boolean;

  // Items needing attention
  items: OrchestratorItem[];

  // Session tracking
  sessionsById: Record<string, SessionWithSnapshot>;

  // Deduplication
  lastHashBySession: Record<string, string>;
  lastDetectedAt: Record<string, number>;

  // Throttling config (ms between re-analyses per session)
  throttleMs: number;

  // Idle session tracking (server persisted)
  idledSessionsById: Record<string, number>;

  // Actions
  open: () => void;
  close: () => void;
  toggle: () => void;

  // Data ingestion
  ingestSessions: (
    sessions: SessionWithSnapshot[],
    options?: { analyzeSnapshots?: boolean; fullSync?: boolean }
  ) => void;
  ingestSnapshot: (sessionId: string, captureText: string, captureHash?: string) => void;
  ingestApproval: (approval: Approval, session?: Session) => void;
  removeApprovalItem: (approvalId: string) => void;
  pruneApprovals: (approvalIds: string[]) => void;

  // Item management
  dismissItem: (itemId: string) => void;
  clearDismissed: () => void;

  // Idle management
  applySessionIdle: (sessionId: string, idledAt?: number) => void;

  // Summary management
  setSummary: (itemId: string, summary: string) => void;
  setSummaryLoading: (itemId: string, loading: boolean) => void;
  setSummaryFailed: (itemId: string, failed: boolean) => void;

  // Computed getters
  getActiveItems: () => OrchestratorItem[];
  getWaitingItems: () => OrchestratorItem[];
  getIdledItems: () => OrchestratorItem[];
  getItemCount: () => number;
  getIdledCount: () => number;
}

// Minimum time between re-analyses for a session (prevent spam)
const DEFAULT_THROTTLE_MS = 3000;

// Statuses that indicate a session needs attention
const ATTENTION_STATUSES = new Set([
  'WAITING_FOR_INPUT',
  'WAITING_FOR_APPROVAL',
  'ERROR',
]);

const ACTIONABLE_CONFIDENCE_THRESHOLD = 0.75;
const SNAPSHOT_CONTEXT_LINES = 60;
const APPROVAL_PRUNE_GRACE_MS = 60 * 1000;

function buildSnapshotContext(captureText: string): string {
  if (!captureText) return '';
  const cleanText = stripAnsi(captureText);
  const lines = cleanText.split('\n');
  return lines.slice(-SNAPSHOT_CONTEXT_LINES).join('\n');
}

function buildApprovalFallbackContext(requestedPayload: Record<string, unknown>): string {
  const details = (requestedPayload.details || {}) as Record<string, unknown>;
  const parts: string[] = [];

  const tool = requestedPayload.tool || requestedPayload.tool_name || details.tool || details.tool_name;
  if (tool) parts.push(`Tool: ${String(tool)}`);

  const command = details.bash_command || requestedPayload.bash_command || details.command || requestedPayload.command;
  if (command) parts.push(`Command: ${String(command)}`);

  const path = requestedPayload.path || requestedPayload.file || details.path || details.file;
  if (path) parts.push(`Path: ${String(path)}`);

  const description = requestedPayload.description || details.description;
  if (description) parts.push(`Description: ${String(description)}`);

  const reason = requestedPayload.reason || details.reason;
  if (reason) parts.push(`Reason: ${String(reason)}`);

  const args = requestedPayload.args || details.args;
  if (args && typeof args === 'object') {
    parts.push(`Args: ${JSON.stringify(args)}`);
  }

  return parts.join('\n');
}

function applySnapshotContext(
  items: OrchestratorItem[],
  sessionId: string,
  context: string
): OrchestratorItem[] {
  if (!context) return items;
  return items.map((item) => {
    if (item.sessionId !== sessionId) return item;
    if (!item.action) return item;
    if (item.source === 'snapshot') return item;
    if (item.source === 'approval') {
      if (item.action.context === context) return item;
      return {
        ...item,
        action: {
          ...item.action,
          context,
        },
      };
    }
    const existing = item.action.context ?? '';
    const hasAnsi = /\x1B\[[0-?]*[ -/]*[@-~]/.test(existing);
    if (existing.trim() && !hasAnsi) return item;
    return {
      ...item,
      action: {
        ...item.action,
        context,
      },
    };
  });
}

function hasNonEmptyValue(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}

function approvalHasDecisionPayload(payload: Record<string, unknown>): boolean {
  const details = (payload.details || {}) as Record<string, unknown>;
  const command =
    details.bash_command ||
    payload.bash_command ||
    details.command ||
    payload.command;
  const path = payload.path || payload.file || details.path || details.file;
  const args = payload.args || details.args;
  const url = payload.url || details.url || payload.uri || details.uri;

  return (
    hasNonEmptyValue(command) ||
    hasNonEmptyValue(path) ||
    hasNonEmptyValue(args) ||
    hasNonEmptyValue(url)
  );
}

function extractApprovalTool(payload: Record<string, unknown>): string | null {
  const details = (payload.details || {}) as Record<string, unknown>;
  const tool = payload.tool || payload.tool_name || details.tool || details.tool_name;
  if (!tool) return null;
  return String(tool);
}

const NON_BLOCKING_APPROVAL_TOOLS = new Set([
  'askuserquestion',
  'exitplanmode',
  'enterplanmode',
]);

function normalizeApprovalOption(option: unknown): { value: string; label: string } | null {
  if (typeof option === 'string') {
    const trimmed = option.trim();
    return trimmed ? { value: trimmed, label: trimmed } : null;
  }
  if (typeof option === 'number') {
    return { value: String(option), label: String(option) };
  }
  if (typeof option === 'object' && option) {
    const record = option as Record<string, unknown>;
    const value =
      record.value ??
      record.id ??
      record.key ??
      record.slug ??
      record.name ??
      record.label;
    if (!value) return null;
    const label =
      record.label ??
      record.name ??
      record.title ??
      record.value ??
      record.id ??
      record.key;
    return {
      value: String(value),
      label: String(label ?? value),
    };
  }
  return null;
}

function extractApprovalOptions(payload: Record<string, unknown>): { value: string; label: string }[] {
  const details = (payload.details || {}) as Record<string, unknown>;
  const rawOptions =
    payload.options ||
    details.options ||
    payload.choices ||
    details.choices ||
    payload.responses ||
    details.responses;
  if (!Array.isArray(rawOptions)) return [];
  return rawOptions
    .map((option) => normalizeApprovalOption(option))
    .filter((option): option is { value: string; label: string } => Boolean(option));
}

function isActionableApproval(item: OrchestratorItem): boolean {
  if (!item.approval) return false;
  const approvalType = item.approvalType || item.approvalInput?.type || 'binary';
  const inputSchema = item.approvalInput;
  const requestedPayload = item.approval.requested_payload as Record<string, unknown>;
  const tool = extractApprovalTool(requestedPayload);
  if (tool && NON_BLOCKING_APPROVAL_TOOLS.has(tool.toLowerCase())) {
    return false;
  }

  if (approvalType === 'plan_review') {
    const tabs = (inputSchema as { type?: string; tabs?: unknown[] } | undefined)?.tabs;
    return inputSchema?.type === 'plan_review' && Array.isArray(tabs) && tabs.length > 0;
  }

  if (item.sessionStatus !== 'WAITING_FOR_APPROVAL') {
    return false;
  }

  if (approvalType === 'multi_choice') {
    const options = (inputSchema as { type?: string; options?: unknown[] } | undefined)?.options;
    if (!approvalHasDecisionPayload(requestedPayload)) {
      return false;
    }
    if (inputSchema?.type === 'multi_choice' && Array.isArray(options) && options.length > 0) {
      return true;
    }
    return item.action?.type === 'multi_choice' && (item.action.options?.length || 0) > 0;
  }

  if (approvalType === 'text_input') {
    return false;
  }

  if (!approvalHasDecisionPayload(requestedPayload)) {
    return false;
  }

  return true;
}

function isActionableItem(item: OrchestratorItem): boolean {
  if (item.sessionStatus === 'ERROR') return true;
  if (item.action?.type === 'error') return true;

  if (item.source === 'approval') {
    return isActionableApproval(item);
  }

  if (!item.action) return false;
  if (item.action.type === 'text_input') return false;
  if (item.action.type === 'needs_attention') return false;

  return item.action.confidence >= ACTIONABLE_CONFIDENCE_THRESHOLD;
}

/**
 * Calculate priority score for an orchestrator item
 * Higher scores = more urgent items that should appear first
 */
function calculatePriorityScore(item: OrchestratorItem, now: number): number {
  let score = 0;

  // Action type scoring
  if (item.action) {
    switch (item.action.type) {
      case 'error':
        score += 50;
        break;
      case 'plan_review':
        score += 40;
        break;
      case 'yes_no':
        score += 30;
        break;
      case 'multi_choice':
        score += 25;
        break;
      case 'text_input':
        score += 20;
        break;
      case 'needs_attention':
        score += 10;
        break;
    }
  }

  // Session status scoring
  switch (item.sessionStatus) {
    case 'ERROR':
      score += 20;
      break;
    case 'WAITING_FOR_APPROVAL':
      score += 15;
      break;
    case 'WAITING_FOR_INPUT':
      score += 10;
      break;
  }

  // Source scoring
  if (item.source === 'approval') {
    score += 15;
  } else if (item.source === 'snapshot') {
    score += 5;
  }

  // Wait time scoring: +1 per minute, max 30 points
  const waitMinutes = Math.max(0, Math.floor((now - item.createdAt) / 60000));
  score += Math.min(waitMinutes, 30);

  return score;
}

export const useOrchestratorStore = create<OrchestratorState>()(
  (set, get) => ({
      isOpen: false,
      items: [],
      sessionsById: {},
      lastHashBySession: {},
      lastDetectedAt: {},
      throttleMs: DEFAULT_THROTTLE_MS,
      idledSessionsById: {},

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),

      ingestSessions: (sessions, options) => {
        const analyzeSnapshots = options?.analyzeSnapshots ?? true;
        const fullSync = options?.fullSync ?? false;
        set((state) => {
          const sessionsById = { ...state.sessionsById };
          const lastHashBySession = { ...state.lastHashBySession };
          const lastDetectedAt = { ...state.lastDetectedAt };
          const idledSessionsById = { ...state.idledSessionsById };
          let items = [...state.items];
          const now = Date.now();

          for (const session of sessions) {
            const previousStatus = state.sessionsById[session.id]?.status;
            const wasAttention = previousStatus ? ATTENTION_STATUSES.has(previousStatus) : false;
            const isAttention = ATTENTION_STATUSES.has(session.status);

            sessionsById[session.id] = session;
            const parsedIdledAt = session.idled_at
              ? new Date(session.idled_at).getTime()
              : undefined;
            const isIdledSession =
              typeof parsedIdledAt === 'number' && !Number.isNaN(parsedIdledAt);
            if (isIdledSession) {
              idledSessionsById[session.id] = parsedIdledAt as number;
            } else {
              delete idledSessionsById[session.id];
            }

            const snapshotContext = analyzeSnapshots && session.latest_snapshot?.capture_text
              ? buildSnapshotContext(session.latest_snapshot.capture_text)
              : '';

            if (wasAttention && !isAttention) {
              items = items.filter(
                (item) =>
                  item.sessionId !== session.id ||
                  item.source === 'approval'
              );
              delete lastHashBySession[session.id];
              delete lastDetectedAt[session.id];
            }

            const needsAttention = ATTENTION_STATUSES.has(session.status);

            if (needsAttention) {
              const hasActiveStatus = items.some(
                (item) =>
                  item.sessionId === session.id &&
                  item.source === 'status' &&
                  !item.dismissedAt
              );
              const hasActiveApproval = items.some(
                (item) =>
                  item.sessionId === session.id &&
                  item.source === 'approval' &&
                  !item.dismissedAt
              );

              if (!hasActiveStatus && !hasActiveApproval) {
                items = items.filter(
                  (item) => !(item.sessionId === session.id && item.source === 'status')
                );

                items.push({
                  id: `status-${session.id}-${now}`,
                  sessionId: session.id,
                  sessionTitle: session.title ?? null,
                  sessionCwd: session.cwd ?? null,
                  sessionProvider: session.provider ?? null,
                  sessionStatus: session.status,
                  source: 'status',
                  action: {
                    type: 'needs_attention',
                    question: `Session is ${session.status.toLowerCase().replace(/_/g, ' ')}`,
                    context: '',
                    confidence: 0.5,
                  },
                  createdAt: now,
                  idledAt: isIdledSession ? (parsedIdledAt as number) : undefined,
                });
              } else {
                // Keep status item details fresh
                items = items.map((item) =>
                  item.sessionId === session.id && item.source === 'status'
                    ? {
                        ...item,
                        sessionTitle: session.title ?? item.sessionTitle,
                        sessionCwd: session.cwd ?? item.sessionCwd,
                        sessionProvider: session.provider ?? item.sessionProvider,
                        sessionStatus: session.status,
                      }
                    : item
                );
              }
              if (hasActiveApproval) {
                items = items.filter(
                  (item) => !(item.sessionId === session.id && item.source === 'status')
                );
              }
            } else {
              // Status no longer requires attention; remove status items
              items = items.filter(
                (item) => !(item.sessionId === session.id && item.source === 'status')
              );
            }

            // If session has a snapshot, analyze it
            if (analyzeSnapshots && session.latest_snapshot?.capture_text) {
              const snapshot = session.latest_snapshot;
              const hash = snapshot.capture_hash || generateCaptureHash(snapshot.capture_text);

              // Check if this is a new snapshot (different hash)
              if (hash !== lastHashBySession[session.id]) {
                // Check throttle
                const lastDetected = lastDetectedAt[session.id] || 0;
                if (now - lastDetected >= state.throttleMs) {
                  const result = analyzeSnapshot(snapshot.capture_text, hash);

                  lastHashBySession[session.id] = result.captureHash;
                  lastDetectedAt[session.id] = result.analyzedAt;

                  // Remove existing snapshot items for this session
                  items = items.filter(
                    (item) =>
                      !(
                        item.sessionId === session.id &&
                        (item.source === 'snapshot' || item.source === 'status')
                      )
                  );

                  if (result.action) {
                    const parsedSnapshotCreatedAt = snapshot.created_at
                      ? new Date(snapshot.created_at).getTime()
                      : Number.NaN;
                    const snapshotCreatedAt = Number.isNaN(parsedSnapshotCreatedAt)
                      ? now
                      : parsedSnapshotCreatedAt;
                    items.push({
                      id: `snapshot-${session.id}-${now}`,
                      sessionId: session.id,
                      sessionTitle: session.title ?? null,
                      sessionCwd: session.cwd ?? null,
                      sessionProvider: session.provider ?? null,
                      sessionStatus: session.status,
                      source: 'snapshot',
                      action: result.action,
                      createdAt: snapshotCreatedAt,
                      captureHash: result.captureHash,
                      idledAt: isIdledSession ? (parsedIdledAt as number) : undefined,
                    });
                  }
                }
              }
            }

            // Sync idle state on existing items for this session
            items = items.map((item) =>
              item.sessionId === session.id
                ? { ...item, idledAt: isIdledSession ? (parsedIdledAt as number) : undefined }
                : item
            );

            // If a snapshot action is already present, avoid duplicate status items
            const hasActiveSnapshot = items.some(
              (item) =>
                item.sessionId === session.id &&
                item.source === 'snapshot' &&
                !item.dismissedAt
            );
            if (hasActiveSnapshot) {
              items = items.filter(
                (item) => !(item.sessionId === session.id && item.source === 'status')
              );
            }

            if (snapshotContext) {
              items = applySnapshotContext(items, session.id, snapshotContext);
            }
          }

          if (fullSync) {
            const sessionIds = new Set(sessions.map((session) => session.id));
            items = items.filter(
              (item) => item.source === 'approval' || sessionIds.has(item.sessionId)
            );
          }

          return {
            sessionsById,
            items,
            lastHashBySession,
            lastDetectedAt,
            idledSessionsById,
          };
        });
      },

      ingestSnapshot: (sessionId, captureText, captureHash) => {
        set((state) => {
          const hash = captureHash || generateCaptureHash(captureText);

          // Check if this is a new snapshot
          if (hash === state.lastHashBySession[sessionId]) {
            return state;
          }

          // Check throttle
          const lastDetected = state.lastDetectedAt[sessionId] || 0;
          if (Date.now() - lastDetected < state.throttleMs) {
            return state;
          }

          const result = analyzeSnapshot(captureText, hash);
          const storedIdledAt = state.idledSessionsById[sessionId];
          const isIdledSession =
            typeof storedIdledAt === 'number' && !Number.isNaN(storedIdledAt);

          const newState: Partial<OrchestratorState> = {
            lastHashBySession: {
              ...state.lastHashBySession,
              [sessionId]: result.captureHash,
            },
            lastDetectedAt: {
              ...state.lastDetectedAt,
              [sessionId]: result.analyzedAt,
            },
          };

          if (result.action) {
            const session = state.sessionsById[sessionId];

            // Remove existing snapshot items for this session
            const filteredItems = state.items.filter(
              (item) =>
                !(
                  item.sessionId === sessionId &&
                  (item.source === 'snapshot' || item.source === 'status')
                )
            );

            newState.items = [
              ...filteredItems,
              {
                id: `snapshot-${sessionId}-${Date.now()}`,
                sessionId,
                sessionTitle: session?.title || null,
                sessionCwd: session?.cwd || null,
                sessionProvider: session?.provider || null,
                sessionStatus: session?.status || 'unknown',
                source: 'snapshot',
                action: result.action,
                createdAt: Date.now(),
                captureHash: result.captureHash,
                idledAt: isIdledSession ? storedIdledAt : undefined,
              },
            ];
          } else {
            // No action detected - remove existing snapshot items for this session only
            newState.items = state.items.filter(
              (item) => !(item.sessionId === sessionId && item.source === 'snapshot')
            );
          }

          const snapshotContext = buildSnapshotContext(captureText);
          if (snapshotContext) {
            newState.items = applySnapshotContext(newState.items ?? state.items, sessionId, snapshotContext);
          }

          return newState as OrchestratorState;
        });
      },

      ingestApproval: (approval, session) => {
        set((state) => {
          // Check if we already have this approval
          const existingItem = state.items.find(
            (i) => i.approval?.id === approval.id
          );

          if (existingItem) {
            return state;
          }

          const sessionData = session || state.sessionsById[approval.session_id];
          const storedIdledAt = state.idledSessionsById[approval.session_id];
          const isIdledSession =
            typeof storedIdledAt === 'number' && !Number.isNaN(storedIdledAt);

          const requestedPayload = (approval.requested_payload || {}) as Record<string, unknown>;
          const details = (requestedPayload.details || {}) as Record<string, unknown>;
          const reason = (requestedPayload.reason || details.reason || 'Approval required') as string;

          const approvalTypeRaw = (requestedPayload.approval_type ||
            details.approval_type) as ApprovalType | undefined;
          const inputSchema = (requestedPayload.input_schema ||
            details.input_schema) as ApprovalInput | undefined;
          const tool = extractApprovalTool(requestedPayload);
          const isNonBlockingTool =
            typeof tool === 'string' && NON_BLOCKING_APPROVAL_TOOLS.has(tool.toLowerCase());
          let approvalType = inputSchema?.type || approvalTypeRaw || 'binary';
          if (isNonBlockingTool && approvalType === 'binary' && !inputSchema) {
            approvalType = 'text_input';
          }
          const derivedOptions = extractApprovalOptions(requestedPayload);

          // Get terminal context from session snapshot if available
          // Try passed session first, then fall back to stored session
          const storedSession = state.sessionsById[approval.session_id];
          const rawSnapshot =
            (session as SessionWithSnapshot)?.latest_snapshot?.capture_text ||
            storedSession?.latest_snapshot?.capture_text ||
            '';
          const terminalContext = rawSnapshot
            ? buildSnapshotContext(rawSnapshot)
            : buildApprovalFallbackContext(requestedPayload);

          let action: DetectedAction = {
            type: 'yes_no',
            question: reason,
            options: [
              { value: 'allow', label: 'Allow' },
              { value: 'deny', label: 'Deny' },
            ],
            context: terminalContext,
            confidence: 1.0,
          };

          if (approvalType === 'text_input') {
            if (derivedOptions.length > 0) {
              action = {
                type: 'multi_choice',
                question: reason,
                options: derivedOptions,
                allowCustom: true,
                context: terminalContext,
                confidence: 0.6,
              };
            } else {
            action = {
              type: 'text_input',
              question: inputSchema?.type === 'text_input' && inputSchema.prompt
                ? inputSchema.prompt
                : reason,
              placeholder: inputSchema?.type === 'text_input' ? inputSchema.placeholder : undefined,
              multiline: inputSchema?.type === 'text_input' ? inputSchema.multiline : undefined,
              context: terminalContext,
              confidence: 1.0,
            };
            }
          } else if (approvalType === 'multi_choice') {
            const options =
              inputSchema?.type === 'multi_choice'
                ? inputSchema.options.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))
                : derivedOptions;

            action = {
              type: 'multi_choice',
              question: reason,
              options,
              allowCustom:
                inputSchema?.type === 'multi_choice' ? inputSchema.allow_custom : undefined,
              context: terminalContext,
              confidence: 1.0,
            };
          } else if (approvalType === 'plan_review') {
            action = {
              type: 'plan_review',
              question: reason,
              context: terminalContext,
              confidence: 1.0,
            };
          } else if (approvalType === 'binary') {
            action = {
              type: 'yes_no',
              question: reason,
              options: [
                {
                  value: 'allow',
                  label:
                    inputSchema?.type === 'binary' && inputSchema.allow_label
                      ? inputSchema.allow_label
                      : 'Allow',
                },
                {
                  value: 'deny',
                  label:
                    inputSchema?.type === 'binary' && inputSchema.deny_label
                      ? inputSchema.deny_label
                      : 'Deny',
                },
              ],
              context: terminalContext,
              confidence: 1.0,
            };
          }

          const parsedRequestedAt = approval.ts_requested
            ? new Date(approval.ts_requested).getTime()
            : Number.NaN;
          const requestedAt = Number.isNaN(parsedRequestedAt)
            ? Date.now()
            : parsedRequestedAt;

          const newItem: OrchestratorItem = {
            id: `approval-${approval.id}`,
            sessionId: approval.session_id,
            sessionTitle: sessionData?.title || approval.provider || 'Approval pending...',
            sessionCwd: sessionData?.cwd || null,
            sessionProvider: sessionData?.provider || approval.provider || 'unknown',
            sessionStatus: sessionData?.status || 'WAITING_FOR_APPROVAL',
            source: 'approval',
            action,
            approval,
            approvalInput: inputSchema,
            approvalType,
            createdAt: requestedAt,
            idledAt: isIdledSession ? storedIdledAt : undefined,
          };

          return {
            items: [
              ...state.items.filter(
                (item) => !(item.sessionId === approval.session_id && item.source === 'status')
              ),
              newItem,
            ],
          };
        });
      },

      removeApprovalItem: (approvalId) => {
        set((state) => ({
          items: state.items.filter((i) => i.approval?.id !== approvalId),
        }));
      },

      pruneApprovals: (approvalIds) => {
        const approvalIdSet = new Set(approvalIds);
        const now = Date.now();
        set((state) => ({
          items: state.items.filter((item) => {
            if (item.source !== 'approval') return true;
            const approvalId = item.approval?.id;
            if (!approvalId) return now - item.createdAt < APPROVAL_PRUNE_GRACE_MS;
            if (approvalIdSet.has(approvalId)) return true;
            return now - item.createdAt < APPROVAL_PRUNE_GRACE_MS;
          }),
        }));
      },

      dismissItem: (itemId) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === itemId ? { ...item, dismissedAt: Date.now() } : item
          ),
        }));
      },

      clearDismissed: () => {
        set((state) => ({
          items: state.items.filter((item) => !item.dismissedAt),
        }));
      },

      applySessionIdle: (sessionId, idledAt) => {
        set((state) => {
          const idledSessionsById = { ...state.idledSessionsById };
          if (typeof idledAt === 'number' && !Number.isNaN(idledAt)) {
            idledSessionsById[sessionId] = idledAt;
          } else {
            delete idledSessionsById[sessionId];
          }
          const existingSession = state.sessionsById[sessionId];
          const sessionsById = existingSession
            ? {
                ...state.sessionsById,
                [sessionId]: {
                  ...existingSession,
                  idled_at:
                    typeof idledAt === 'number' && !Number.isNaN(idledAt)
                      ? new Date(idledAt).toISOString()
                      : null,
                },
              }
            : state.sessionsById;
          return {
            items: state.items.map((item) =>
              item.sessionId === sessionId ? { ...item, idledAt } : item
            ),
            idledSessionsById,
            sessionsById,
          };
        });
      },

      setSummary: (itemId, summary) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === itemId
              ? { ...item, summary, summaryLoading: false, summaryFailed: false }
              : item
          ),
        }));
      },

      setSummaryLoading: (itemId, loading) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === itemId
              ? { ...item, summaryLoading: loading, summaryFailed: loading ? false : item.summaryFailed }
              : item
          ),
        }));
      },

      setSummaryFailed: (itemId, failed) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === itemId ? { ...item, summaryFailed: failed, summaryLoading: false } : item
          ),
        }));
      },

      getActiveItems: () => {
        const state = get();
        const now = Date.now();
        return state.items
          .filter((item) => !item.dismissedAt && !item.idledAt && isActionableItem(item))
          .sort((a, b) => {
            // Sort by priority score (descending), then by createdAt as tiebreaker
            const scoreA = calculatePriorityScore(a, now);
            const scoreB = calculatePriorityScore(b, now);
            if (scoreB !== scoreA) {
              return scoreB - scoreA;
            }
            return b.createdAt - a.createdAt;
          });
      },

      getWaitingItems: () => {
        const state = get();
        return state.items
          .filter((item) => !item.dismissedAt && !item.idledAt && !isActionableItem(item))
          .sort((a, b) => b.createdAt - a.createdAt);
      },

      getIdledItems: () => {
        const state = get();
        return state.items
          .filter((item) => !item.dismissedAt && item.idledAt)
          .sort((a, b) => b.createdAt - a.createdAt);
      },

      getItemCount: () => {
        const state = get();
        return state.items.filter((item) => !item.dismissedAt && !item.idledAt && isActionableItem(item)).length;
      },

      getIdledCount: () => {
        const state = get();
        return state.items.filter((item) => !item.dismissedAt && item.idledAt).length;
      },
    })
);
