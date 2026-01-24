import { z } from 'zod';

// Full tool event record (from database)
export const ToolEventSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  provider: z.string(),
  tool_name: z.string(),
  tool_input: z.record(z.unknown()).optional(),
  tool_output: z.record(z.unknown()).optional(),
  started_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).optional(),
  success: z.boolean().optional(),
  duration_ms: z.number().int().optional(),
  created_at: z.string().datetime({ offset: true }),
});

export type ToolEvent = z.infer<typeof ToolEventSchema>;

// Tool event start payload (agent -> control-plane)
export const ToolEventStartSchema = z.object({
  event_id: z.string().uuid(),
  session_id: z.string().uuid(),
  provider: z.string(),
  tool_name: z.string(),
  tool_input: z.record(z.unknown()).optional(),
  started_at: z.string().datetime({ offset: true }),
});

export type ToolEventStart = z.infer<typeof ToolEventStartSchema>;

// Tool event complete payload (agent -> control-plane)
export const ToolEventCompleteSchema = z.object({
  event_id: z.string().uuid(),
  tool_output: z.record(z.unknown()).optional(),
  completed_at: z.string().datetime({ offset: true }),
  success: z.boolean(),
  duration_ms: z.number().int(),
});

export type ToolEventComplete = z.infer<typeof ToolEventCompleteSchema>;

// Tool events list response
export const ToolEventsResponseSchema = z.object({
  events: z.array(ToolEventSchema),
  next_cursor: z.string().optional(),
});

export type ToolEventsResponse = z.infer<typeof ToolEventsResponseSchema>;

// Tool statistics (aggregated per session)
export const ToolStatSchema = z.object({
  tool_name: z.string(),
  total_calls: z.number().int(),
  avg_duration: z.number().int().optional(),
  success_count: z.number().int(),
});

export type ToolStat = z.infer<typeof ToolStatSchema>;

export const ToolStatsResponseSchema = z.object({
  stats: z.array(ToolStatSchema),
});

export type ToolStatsResponse = z.infer<typeof ToolStatsResponseSchema>;
