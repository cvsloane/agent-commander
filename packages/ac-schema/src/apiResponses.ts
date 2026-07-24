import { z } from 'zod';

import { AgentTaskSchema } from './orchestration.js';
import { ApprovalSchema } from './approval.js';
import {
  AutomationAgentSchema,
  AutomationRunEventSchema,
  AutomationRunSchema,
  AutomationWakeupSchema,
  GovernanceApprovalSchema,
  WorkItemSchema,
} from './automation.js';
import { EventSchema } from './event.js';
import { HostSchema } from './host.js';
import { MemoryEntrySchema } from './memory.js';
import { ProjectSchema } from './project.js';
import { RepoSchema } from './repo.js';
import { SessionUsageSummarySchema } from './analytics.js';
import { SessionSchema } from './session.js';
import { UserSettingsSchema } from './settings.js';

/**
 * Envelope shapes for the REST endpoints the dashboard reads.
 *
 * The entity schemas already describe every field; these wrap them in the
 * `{ hosts: [...] }` / `{ events: [...] }` envelopes the routes actually return
 * so `fetchAPI` can validate the payload instead of casting it. Validation is
 * advisory -- fetchAPI logs and falls back to the raw payload on mismatch -- so
 * adding one to a call can surface drift but cannot break a working screen.
 *
 * Every entity is wrapped with `.loose()` and the envelopes are `looseObject`
 * because Zod strips unknown keys on a *successful* parse. Routes legitimately
 * decorate entities beyond their base schema -- `GET /v1/hosts` merges
 * `online` and `last_heartbeat_at` from in-memory presence, which live in
 * HostPresenceSchema rather than HostSchema -- and a strict parse would delete
 * those fields silently, which is far worse than not validating at all.
 * Validation here may only ever report drift, never discard data.
 */

export const HostsResponseSchema = z.looseObject({
  hosts: z.array(HostSchema.loose()),
});
export type HostsResponse = z.infer<typeof HostsResponseSchema>;

export const HostResponseSchema = z.looseObject({
  host: HostSchema.loose(),
});
export type HostResponse = z.infer<typeof HostResponseSchema>;

export const SessionDetailResponseSchema = z.looseObject({
  session: SessionSchema.loose(),
  snapshot: z
    .looseObject({
      created_at: z.string(),
      capture_text: z.string(),
    })
    .nullable(),
  events: z.array(EventSchema.loose()),
  approvals: z.array(ApprovalSchema.loose()),
});
export type SessionDetailResponse = z.infer<typeof SessionDetailResponseSchema>;

export const SessionEventsResponseSchema = z.looseObject({
  events: z.array(EventSchema.loose()),
  next_cursor: z.number().optional(),
});
export type SessionEventsResponse = z.infer<typeof SessionEventsResponseSchema>;

export const SessionAgentTasksResponseSchema = z.looseObject({
  session_id: z.string(),
  agent_tasks: z.array(AgentTaskSchema.loose()),
});
export type SessionAgentTasksResponse = z.infer<typeof SessionAgentTasksResponseSchema>;

export const SessionUsageLatestResponseSchema = z.looseObject({
  usage: z.array(SessionUsageSummarySchema.loose()),
});
export type SessionUsageLatestResponse = z.infer<typeof SessionUsageLatestResponseSchema>;

export const ApprovalsResponseSchema = z.looseObject({
  approvals: z.array(ApprovalSchema.loose()),
});
export type ApprovalsResponse = z.infer<typeof ApprovalsResponseSchema>;

export const UserSettingsResponseSchema = z.looseObject({
  settings: UserSettingsSchema.loose().nullable(),
});
export type UserSettingsResponse = z.infer<typeof UserSettingsResponseSchema>;

export const ProjectsResponseSchema = z.looseObject({
  projects: z.array(ProjectSchema.loose()),
});
export type ProjectsResponse = z.infer<typeof ProjectsResponseSchema>;

export const ReposResponseSchema = z.looseObject({
  repos: z.array(RepoSchema.loose()),
});
export type ReposResponse = z.infer<typeof ReposResponseSchema>;

export const AutomationAgentsResponseSchema = z.looseObject({
  agents: z.array(AutomationAgentSchema.loose()),
});
export type AutomationAgentsResponse = z.infer<typeof AutomationAgentsResponseSchema>;

export const AutomationRunsResponseSchema = z.looseObject({
  runs: z.array(AutomationRunSchema.loose()),
});
export type AutomationRunsResponse = z.infer<typeof AutomationRunsResponseSchema>;

export const AutomationRunEventsResponseSchema = z.looseObject({
  events: z.array(AutomationRunEventSchema.loose()),
});
export type AutomationRunEventsResponse = z.infer<typeof AutomationRunEventsResponseSchema>;

export const AutomationWakeupsResponseSchema = z.looseObject({
  wakeups: z.array(AutomationWakeupSchema.loose()),
});
export type AutomationWakeupsResponse = z.infer<typeof AutomationWakeupsResponseSchema>;

export const GovernanceApprovalsResponseSchema = z.looseObject({
  approvals: z.array(GovernanceApprovalSchema.loose()),
});
export type GovernanceApprovalsResponse = z.infer<typeof GovernanceApprovalsResponseSchema>;

export const WorkItemsResponseSchema = z.looseObject({
  work_items: z.array(WorkItemSchema.loose()),
});
export type WorkItemsResponse = z.infer<typeof WorkItemsResponseSchema>;

export const MemorySearchResponseSchema = z.looseObject({
  results: z.array(MemoryEntrySchema.loose()),
});
export type MemorySearchResponse = z.infer<typeof MemorySearchResponseSchema>;
