import { z } from 'zod';
import { SessionProviderSchema } from './enums.js';

export const AutomationAgentRoleSchema = z.enum(['orchestrator', 'worker']);
export type AutomationAgentRole = z.infer<typeof AutomationAgentRoleSchema>;

export const AutomationAgentStatusSchema = z.enum(['active', 'paused']);
export type AutomationAgentStatus = z.infer<typeof AutomationAgentStatusSchema>;

export const AutomationWakeSourceSchema = z.enum(['schedule', 'manual', 'followup', 'approval_resume', 'external']);
export type AutomationWakeSource = z.infer<typeof AutomationWakeSourceSchema>;

export const AutomationWakeStatusSchema = z.enum(['queued', 'running', 'completed', 'skipped', 'blocked', 'coalesced', 'failed']);
export type AutomationWakeStatus = z.infer<typeof AutomationWakeStatusSchema>;

export const AutomationRunStatusSchema = z.enum(['starting', 'running', 'succeeded', 'failed', 'blocked', 'cancelled']);
export type AutomationRunStatus = z.infer<typeof AutomationRunStatusSchema>;

export const AutomationConcurrencyPolicySchema = z.enum(['coalesce_if_active', 'always_enqueue', 'skip_if_active']);
export type AutomationConcurrencyPolicy = z.infer<typeof AutomationConcurrencyPolicySchema>;

export const AutomationSchedulerModeSchema = z.enum(['native', 'external', 'hybrid']);
export type AutomationSchedulerMode = z.infer<typeof AutomationSchedulerModeSchema>;

export const AutomationCatchUpPolicySchema = z.enum(['skip_missed', 'enqueue_missed_with_cap']);
export type AutomationCatchUpPolicy = z.infer<typeof AutomationCatchUpPolicySchema>;

export const AutomationRuntimeStatusSchema = z.enum(['idle', 'attached', 'stale', 'error']);
export type AutomationRuntimeStatus = z.infer<typeof AutomationRuntimeStatusSchema>;

export const AutomationRunEventLevelSchema = z.enum(['info', 'warn', 'error']);
export type AutomationRunEventLevel = z.infer<typeof AutomationRunEventLevelSchema>;

export const GovernanceApprovalTypeSchema = z.enum(['budget_override', 'plan_review', 'host_selection', 'scope_escalation']);
export type GovernanceApprovalType = z.infer<typeof GovernanceApprovalTypeSchema>;

export const GovernanceApprovalStatusSchema = z.enum(['pending', 'approved', 'denied', 'cancelled']);
export type GovernanceApprovalStatus = z.infer<typeof GovernanceApprovalStatusSchema>;

export const WorkItemStatusSchema = z.enum(['queued', 'in_progress', 'blocked', 'done', 'cancelled']);
export type WorkItemStatus = z.infer<typeof WorkItemStatusSchema>;

export const AutomationPreflightIssueSchema = z.object({
  code: z.string(),
  level: z.enum(['warn', 'error']),
  message: z.string(),
  host_id: z.string().uuid().nullable().optional(),
});
export type AutomationPreflightIssue = z.infer<typeof AutomationPreflightIssueSchema>;

export const AutomationPreflightSchema = z.object({
  status: z.enum(['ok', 'warn', 'blocked']),
  issues: z.array(AutomationPreflightIssueSchema).default([]),
});
export type AutomationPreflight = z.infer<typeof AutomationPreflightSchema>;

export const AutomationRuntimeStateSchema = z.object({
  id: z.string().uuid(),
  automation_agent_id: z.string().uuid(),
  repo_id: z.string().uuid().nullable().optional(),
  active_session_id: z.string().uuid().nullable().optional(),
  active_host_id: z.string().uuid().nullable().optional(),
  last_session_id: z.string().uuid().nullable().optional(),
  last_run_id: z.string().uuid().nullable().optional(),
  runtime_status: AutomationRuntimeStatusSchema,
  state_json: z.record(z.unknown()).default({}),
  usage_rollup_json: z.record(z.unknown()).default({}),
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});
export type AutomationRuntimeState = z.infer<typeof AutomationRuntimeStateSchema>;

export const AutomationWorkerReportSchema = z.object({
  outcome: z.string(),
  summary: z.string(),
  evidence_refs: z.array(z.record(z.unknown())).default([]),
  suggested_followups: z.array(z.record(z.unknown())).default([]),
  candidate_memory_promotions: z.array(z.record(z.unknown())).default([]),
});
export type AutomationWorkerReport = z.infer<typeof AutomationWorkerReportSchema>;

export const AutomationLogRefSchema = z.object({
  session_id: z.string().uuid().nullable().optional(),
  session_path: z.string().optional(),
  session_url: z.string().optional(),
  run_events_path: z.string().optional(),
  run_events_url: z.string().optional(),
  snapshot_path: z.string().optional(),
  snapshot_url: z.string().optional(),
  artifact_refs: z.array(z.record(z.unknown())).default([]),
});
export type AutomationLogRef = z.infer<typeof AutomationLogRefSchema>;

export const AutomationRunEventSchema = z.object({
  id: z.number().int(),
  automation_run_id: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  event_type: z.string(),
  level: AutomationRunEventLevelSchema,
  message: z.string(),
  payload: z.record(z.unknown()).default({}),
  created_at: z.string().datetime({ offset: true }).optional(),
});
export type AutomationRunEvent = z.infer<typeof AutomationRunEventSchema>;

export const AutomationAgentSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: AutomationAgentRoleSchema,
  name: z.string(),
  slug: z.string().min(1),
  status: AutomationAgentStatusSchema,
  reports_to_automation_agent_id: z.string().uuid().nullable().optional(),
  provider: SessionProviderSchema,
  default_cwd: z.string().nullable().optional(),
  fixed_host_id: z.string().uuid().nullable().optional(),
  wake_policy_json: z.record(z.unknown()).default({}),
  memory_policy_json: z.record(z.unknown()).default({}),
  budget_policy_json: z.record(z.unknown()).default({}),
  worker_pool_json: z.record(z.unknown()).default({}),
  max_parallel_runs: z.number().int().default(1),
  runtime_state: AutomationRuntimeStateSchema.optional(),
  preflight: AutomationPreflightSchema.optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});
export type AutomationAgent = z.infer<typeof AutomationAgentSchema>;

export const AutomationWakeupSchema = z.object({
  id: z.string().uuid(),
  automation_agent_id: z.string().uuid(),
  repo_id: z.string().uuid().nullable().optional(),
  source: AutomationWakeSourceSchema,
  status: AutomationWakeStatusSchema,
  idempotency_key: z.string().nullable().optional(),
  coalesced_into_run_id: z.string().uuid().nullable().optional(),
  context_json: z.record(z.unknown()).default({}),
  requested_at: z.string().datetime({ offset: true }).optional(),
  claimed_at: z.string().datetime({ offset: true }).nullable().optional(),
  finished_at: z.string().datetime({ offset: true }).nullable().optional(),
});
export type AutomationWakeup = z.infer<typeof AutomationWakeupSchema>;

export const AutomationRunSchema = z.object({
  id: z.string().uuid(),
  automation_agent_id: z.string().uuid(),
  wakeup_id: z.string().uuid(),
  repo_id: z.string().uuid().nullable().optional(),
  session_id: z.string().uuid().nullable().optional(),
  status: AutomationRunStatusSchema,
  objective: z.string(),
  memory_snapshot_json: z.record(z.unknown()).default({}),
  pending_followups_json: z.array(z.record(z.unknown())).default([]),
  result_summary: z.string().nullable().optional(),
  usage_json: z.record(z.unknown()).default({}),
  worker_report_json: z.record(z.unknown()).default({}),
  log_ref_json: z.record(z.unknown()).default({}),
  started_at: z.string().datetime({ offset: true }).optional(),
  ended_at: z.string().datetime({ offset: true }).nullable().optional(),
});
export type AutomationRun = z.infer<typeof AutomationRunSchema>;

export const GovernanceApprovalSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  automation_agent_id: z.string().uuid(),
  automation_run_id: z.string().uuid().nullable().optional(),
  type: GovernanceApprovalTypeSchema,
  status: GovernanceApprovalStatusSchema,
  request_payload: z.record(z.unknown()).default({}),
  decision_payload: z.record(z.unknown()).nullable().optional(),
  requested_at: z.string().datetime({ offset: true }).optional(),
  decided_at: z.string().datetime({ offset: true }).nullable().optional(),
  decided_by_user_id: z.string().uuid().nullable().optional(),
});
export type GovernanceApproval = z.infer<typeof GovernanceApprovalSchema>;

export const WorkItemSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  repo_id: z.string().uuid().nullable().optional(),
  title: z.string(),
  objective: z.string(),
  status: WorkItemStatusSchema,
  priority: z.number().int(),
  assigned_automation_agent_id: z.string().uuid().nullable().optional(),
  checkout_run_id: z.string().uuid().nullable().optional(),
  dedupe_key: z.string().nullable().optional(),
  payload_json: z.record(z.unknown()).default({}),
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

export const UpsertAutomationAgentSchema = z.object({
  role: AutomationAgentRoleSchema,
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  status: AutomationAgentStatusSchema.optional(),
  reports_to_automation_agent_id: z.string().uuid().optional(),
  provider: SessionProviderSchema,
  default_cwd: z.string().optional(),
  fixed_host_id: z.string().uuid().optional(),
  wake_policy_json: z.record(z.unknown()).optional(),
  memory_policy_json: z.record(z.unknown()).optional(),
  budget_policy_json: z.record(z.unknown()).optional(),
  worker_pool_json: z.record(z.unknown()).optional(),
  max_parallel_runs: z.number().int().min(1).max(20).optional(),
});
export type UpsertAutomationAgent = z.infer<typeof UpsertAutomationAgentSchema>;

export const WakeAutomationAgentRequestSchema = z.object({
  repo_id: z.string().uuid().optional(),
  source: AutomationWakeSourceSchema.default('manual'),
  idempotency_key: z.string().optional(),
  context_json: z.record(z.unknown()).optional(),
});
export type WakeAutomationAgentRequest = z.infer<typeof WakeAutomationAgentRequestSchema>;

export const GovernanceApprovalDecisionRequestSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  decision_payload: z.record(z.unknown()).optional(),
});
export type GovernanceApprovalDecisionRequest = z.infer<typeof GovernanceApprovalDecisionRequestSchema>;

export const CreateWorkItemSchema = z.object({
  repo_id: z.string().uuid().optional(),
  title: z.string().min(1),
  objective: z.string().min(1),
  priority: z.number().int().optional(),
  assigned_automation_agent_id: z.string().uuid().optional(),
  dedupe_key: z.string().optional(),
  payload_json: z.record(z.unknown()).optional(),
});
export type CreateWorkItem = z.infer<typeof CreateWorkItemSchema>;

export const WorkItemsQuerySchema = z.object({
  repo_id: z.string().uuid().optional(),
  status: WorkItemStatusSchema.optional(),
  assigned_automation_agent_id: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});
export type WorkItemsQuery = z.infer<typeof WorkItemsQuerySchema>;
