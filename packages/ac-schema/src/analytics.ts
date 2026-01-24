import { z } from 'zod';

// Session metrics schema
export const SessionMetricsSchema = z.object({
  id: z.number().optional(),
  session_id: z.string().uuid(),

  // Token usage
  tokens_in: z.number().default(0),
  tokens_out: z.number().default(0),
  tokens_cache_read: z.number().default(0),
  tokens_cache_write: z.number().default(0),

  // Activity counts
  tool_calls: z.number().default(0),
  approvals_requested: z.number().default(0),
  approvals_granted: z.number().default(0),
  approvals_denied: z.number().default(0),

  // Timing
  first_event_at: z.string().datetime({ offset: true }).nullable().optional(),
  last_event_at: z.string().datetime({ offset: true }).nullable().optional(),

  // Cost estimate (in USD cents)
  estimated_cost_cents: z.number().default(0),

  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});
export type SessionMetrics = z.infer<typeof SessionMetricsSchema>;

// Token event schema
export const TokenEventSchema = z.object({
  id: z.number().optional(),
  session_id: z.string().uuid(),
  event_id: z.number().nullable().optional(),

  tokens_in: z.number().default(0),
  tokens_out: z.number().default(0),
  tokens_cache_read: z.number().default(0),
  tokens_cache_write: z.number().default(0),

  tool_name: z.string().nullable().optional(),
  recorded_at: z.string().datetime({ offset: true }).optional(),
});
export type TokenEvent = z.infer<typeof TokenEventSchema>;

// Record token usage request (from agentd/hooks)
export const RecordTokenUsageRequestSchema = z.object({
  session_id: z.string().uuid(),
  event_id: z.number().optional(),
  tokens_in: z.number().optional(),
  tokens_out: z.number().optional(),
  tokens_cache_read: z.number().optional(),
  tokens_cache_write: z.number().optional(),
  tool_name: z.string().optional(),
});
export type RecordTokenUsageRequest = z.infer<typeof RecordTokenUsageRequestSchema>;

// Update approval metrics request
export const UpdateApprovalMetricsRequestSchema = z.object({
  session_id: z.string().uuid(),
  action: z.enum(['requested', 'granted', 'denied']),
});
export type UpdateApprovalMetricsRequest = z.infer<typeof UpdateApprovalMetricsRequestSchema>;

// Analytics summary for dashboard
export const AnalyticsSummarySchema = z.object({
  total_sessions: z.number(),
  total_tokens_in: z.number(),
  total_tokens_out: z.number(),
  total_tool_calls: z.number(),
  total_estimated_cost_cents: z.number(),
  sessions_by_provider: z.record(z.number()),
  sessions_by_status: z.record(z.number()),
});
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;

// Time series data point for charts
export const TimeSeriesPointSchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
  tokens_in: z.number(),
  tokens_out: z.number(),
  tool_calls: z.number(),
});
export type TimeSeriesPoint = z.infer<typeof TimeSeriesPointSchema>;

// Provider usage snapshot (quota/remaining)
export const ProviderUsageSchema = z.object({
  id: z.number().optional(),
  provider: z.string(),
  host_id: z.string().uuid().nullable().optional(),
  session_id: z.string().uuid().nullable().optional(),
  scope: z.enum(['account', 'session']).default('account'),
  reported_at: z.string().datetime({ offset: true }).optional(),
  raw_text: z.string().nullable().optional(),
  raw_json: z.record(z.unknown()).nullable().optional(),
  remaining_tokens: z.number().nullable().optional(),
  remaining_requests: z.number().nullable().optional(),
  weekly_limit_tokens: z.number().nullable().optional(),
  weekly_remaining_tokens: z.number().nullable().optional(),
  weekly_remaining_cost_cents: z.number().nullable().optional(),
  reset_at: z.string().datetime({ offset: true }).nullable().optional(),
  // Utilization percentages (0-100)
  five_hour_utilization: z.number().nullable().optional(),
  five_hour_reset_at: z.string().datetime({ offset: true }).nullable().optional(),
  weekly_utilization: z.number().nullable().optional(),
  weekly_reset_at: z.string().datetime({ offset: true }).nullable().optional(),
  weekly_opus_utilization: z.number().nullable().optional(),
  weekly_opus_reset_at: z.string().datetime({ offset: true }).nullable().optional(),
  weekly_sonnet_utilization: z.number().nullable().optional(),
  weekly_sonnet_reset_at: z.string().datetime({ offset: true }).nullable().optional(),
  // Daily utilization (Gemini)
  daily_utilization: z.number().nullable().optional(),
  daily_reset_at: z.string().datetime({ offset: true }).nullable().optional(),
});
export type ProviderUsage = z.infer<typeof ProviderUsageSchema>;

// Provider usage report payload (agent -> control plane)
export const ProviderUsageReportSchema = z.object({
  provider: z.string(),
  host_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  scope: z.enum(['account', 'session']).default('account'),
  reported_at: z.string().datetime({ offset: true }).optional(),
  raw_text: z.string().optional(),
  raw_json: z.record(z.unknown()).optional(),
  remaining_tokens: z.number().optional(),
  remaining_requests: z.number().optional(),
  weekly_limit_tokens: z.number().optional(),
  weekly_remaining_tokens: z.number().optional(),
  weekly_remaining_cost_cents: z.number().optional(),
  reset_at: z.string().datetime({ offset: true }).optional(),
  // Utilization percentages (0-100)
  five_hour_utilization: z.number().optional(),
  five_hour_reset_at: z.string().datetime({ offset: true }).optional(),
  weekly_utilization: z.number().optional(),
  weekly_reset_at: z.string().datetime({ offset: true }).optional(),
  weekly_opus_utilization: z.number().optional(),
  weekly_opus_reset_at: z.string().datetime({ offset: true }).optional(),
  weekly_sonnet_utilization: z.number().optional(),
  weekly_sonnet_reset_at: z.string().datetime({ offset: true }).optional(),
  // Daily utilization (Gemini)
  daily_utilization: z.number().optional(),
  daily_reset_at: z.string().datetime({ offset: true }).optional(),
});
export type ProviderUsageReport = z.infer<typeof ProviderUsageReportSchema>;

// Session usage summary (parsed from console output)
export const SessionUsageSummarySchema = z.object({
  session_id: z.string().uuid(),
  provider: z.string(),
  input_tokens: z.number().int().optional(),
  output_tokens: z.number().int().optional(),
  total_tokens: z.number().int().optional(),
  cache_read_tokens: z.number().int().optional(),
  cache_write_tokens: z.number().int().optional(),
  estimated_cost_cents: z.number().int().optional(),
  // Percent-based usage (from CLI output)
  session_utilization_percent: z.number().optional(),
  session_left_percent: z.number().optional(),
  session_reset_text: z.string().optional(),
  weekly_utilization_percent: z.number().optional(),
  weekly_left_percent: z.number().optional(),
  weekly_reset_text: z.string().optional(),
  weekly_sonnet_utilization_percent: z.number().optional(),
  weekly_sonnet_reset_text: z.string().optional(),
  weekly_opus_utilization_percent: z.number().optional(),
  weekly_opus_reset_text: z.string().optional(),
  // Codex context info
  context_used_tokens: z.number().int().optional(),
  context_total_tokens: z.number().int().optional(),
  context_left_percent: z.number().optional(),
  five_hour_left_percent: z.number().optional(),
  five_hour_reset_text: z.string().optional(),
  // Gemini daily usage
  daily_utilization_percent: z.number().optional(),
  daily_left_percent: z.number().optional(),
  daily_reset_hours: z.number().int().optional(),
  reported_at: z.string().datetime({ offset: true }),
  raw_usage_line: z.string().optional(),
});
export type SessionUsageSummary = z.infer<typeof SessionUsageSummarySchema>;
