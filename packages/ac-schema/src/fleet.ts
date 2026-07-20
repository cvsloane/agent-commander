import { z } from 'zod';
import {
  AutomationAgentSchema,
  AutomationRunSchema,
  AutomationRunStatusSchema,
  WorkItemStatusSchema,
} from './automation.js';
import {
  AgentTaskSchema,
  SessionEdgeSchema,
  SessionGraphRollupSchema,
} from './orchestration.js';
import { SessionWithSnapshotSchema } from './session.js';

export const OrchestratorWorkItemCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  by_status: z.object({
    queued: z.number().int().nonnegative(),
    in_progress: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
  }),
});
export type OrchestratorWorkItemCounts = z.infer<typeof OrchestratorWorkItemCountsSchema>;

export const OrchestratorLatestReportSchema = z.object({
  run_id: z.string().uuid(),
  status: AutomationRunStatusSchema,
  summary: z.string(),
  reported_at: z.string().datetime({ offset: true }).nullable(),
});
export type OrchestratorLatestReport = z.infer<typeof OrchestratorLatestReportSchema>;

export const OrchestratorFleetCardSchema = z.object({
  session: SessionWithSnapshotSchema,
  children: z.array(SessionWithSnapshotSchema),
  edges: z.array(SessionEdgeSchema),
  agent_tasks: z.array(AgentTaskSchema),
  rollup: SessionGraphRollupSchema,
  work_item_counts: OrchestratorWorkItemCountsSchema,
  automation_agent: AutomationAgentSchema.nullable(),
  latest_run: AutomationRunSchema.nullable(),
  latest_report: OrchestratorLatestReportSchema.nullable(),
  budget_policy: z.record(z.string(), z.unknown()),
  budget_usage: z.object({
    daily_cents: z.number().int().nonnegative(),
    monthly_cents: z.number().int().nonnegative(),
  }).nullable(),
  usage_rollup: z.record(z.string(), z.unknown()),
});
export type OrchestratorFleetCard = z.infer<typeof OrchestratorFleetCardSchema>;

export const OrchestratorFleetResponseSchema = z.object({
  orchestrators: z.array(OrchestratorFleetCardSchema),
});
export type OrchestratorFleetResponse = z.infer<typeof OrchestratorFleetResponseSchema>;

export const FleetWorkItemCountSchema = z.object({
  session_id: z.string().uuid().nullable(),
  assigned_automation_agent_id: z.string().uuid().nullable(),
  status: WorkItemStatusSchema,
  count: z.number().int().nonnegative(),
});
export type FleetWorkItemCount = z.infer<typeof FleetWorkItemCountSchema>;
