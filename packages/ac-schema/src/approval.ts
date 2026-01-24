import { z } from 'zod';
import { SessionProviderSchema, ApprovalDecisionSchema, ApprovalModeSchema } from './enums.js';

// Approval schema for database/API
export const ApprovalSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  provider: SessionProviderSchema,
  ts_requested: z.string().datetime({ offset: true }),
  ts_decided: z.string().datetime({ offset: true }).nullable().optional(),
  timed_out_at: z.string().datetime({ offset: true }).nullable().optional(),
  decision: ApprovalDecisionSchema.nullable().optional(),
  requested_payload: z.record(z.unknown()),
  decided_payload: z.record(z.unknown()).nullable().optional(),
  decided_by_user_id: z.string().uuid().nullable().optional(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

// Approval request (from agent)
export const ApprovalRequestPayloadSchema = z.object({
  approval_id: z.string().uuid().optional(),
  session_id: z.string().uuid(),
  provider: SessionProviderSchema,
  reason: z.string(),
  details: z.record(z.unknown()),
});
export type ApprovalRequestPayload = z.infer<typeof ApprovalRequestPayloadSchema>;

// Approval decide request (from dashboard)
export const ApprovalDecideRequestSchema = z.object({
  decision: ApprovalDecisionSchema,
  mode: ApprovalModeSchema.default('both'),
  payload: z
    .object({
      updatedInput: z.record(z.unknown()).optional(),
    })
    .optional(),
});
export type ApprovalDecideRequest = z.infer<typeof ApprovalDecideRequestSchema>;

// Approval decision payload (to agent)
export const ApprovalDecisionPayloadSchema = z.object({
  approval_id: z.string().uuid(),
  session_id: z.string().uuid(),
  decision: ApprovalDecisionSchema,
  mode: ApprovalModeSchema,
  updated_input: z.record(z.unknown()).optional(),
});
export type ApprovalDecisionPayload = z.infer<typeof ApprovalDecisionPayloadSchema>;

// Claude PermissionRequest hook output
export const ClaudePermissionDecisionSchema = z.object({
  hookSpecificOutput: z.object({
    hookEventName: z.literal('PermissionRequest'),
    decision: z.object({
      behavior: ApprovalDecisionSchema,
      updatedInput: z.record(z.unknown()).optional(),
    }),
  }),
});
export type ClaudePermissionDecision = z.infer<typeof ClaudePermissionDecisionSchema>;

// =============================================================================
// Enhanced Approval Types (Phase 6)
// =============================================================================

// Approval type enum - explicit type preferred (fallback heuristics may be used)
export const ApprovalTypeSchema = z.enum([
  'binary',       // Yes/No (current default)
  'text_input',   // Requires text response
  'multi_choice', // Multiple options
  'plan_review',  // Plan tabs walkthrough
]);
export type ApprovalType = z.infer<typeof ApprovalTypeSchema>;

// Binary approval input schema (Yes/No)
export const BinaryApprovalInputSchema = z.object({
  type: z.literal('binary'),
  allow_label: z.string().optional(),  // "Yes" / "Approve" / "Allow"
  deny_label: z.string().optional(),   // "No" / "Deny" / "Reject"
});
export type BinaryApprovalInput = z.infer<typeof BinaryApprovalInputSchema>;

// Text input approval schema
export const TextInputApprovalInputSchema = z.object({
  type: z.literal('text_input'),
  prompt: z.string(),
  placeholder: z.string().optional(),
  multiline: z.boolean().optional(),
});
export type TextInputApprovalInput = z.infer<typeof TextInputApprovalInputSchema>;

// Multi-choice approval schema
export const MultiChoiceApprovalInputSchema = z.object({
  type: z.literal('multi_choice'),
  options: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })),
  allow_custom: z.boolean().optional(), // Allow "Other" option with custom text
});
export type MultiChoiceApprovalInput = z.infer<typeof MultiChoiceApprovalInputSchema>;

// Plan review approval schema
export const PlanReviewApprovalInputSchema = z.object({
  type: z.literal('plan_review'),
  tabs: z.array(z.object({
    title: z.string(),
    content: z.string(), // markdown
  })),
});
export type PlanReviewApprovalInput = z.infer<typeof PlanReviewApprovalInputSchema>;

// Discriminated union of all approval input schemas
export const ApprovalInputSchema = z.discriminatedUnion('type', [
  BinaryApprovalInputSchema,
  TextInputApprovalInputSchema,
  MultiChoiceApprovalInputSchema,
  PlanReviewApprovalInputSchema,
]);
export type ApprovalInput = z.infer<typeof ApprovalInputSchema>;

// Updated input for decision payload (text/multi-choice response)
export const ApprovalUpdatedInputSchema = z.object({
  text: z.string().optional(),      // For text_input type
  selected: z.string().optional(),  // For multi_choice type (the value, not label)
});
export type ApprovalUpdatedInput = z.infer<typeof ApprovalUpdatedInputSchema>;

// Extended approval requested payload (includes approval_type + input_schema)
export const ApprovalRequestedPayloadSchema = z.object({
  approval_id: z.string().uuid(),
  provider: SessionProviderSchema,
  reason: z.string(),
  details: z.record(z.unknown()),
  approval_type: ApprovalTypeSchema.default('binary'),
  input_schema: ApprovalInputSchema.optional(),
});
export type ApprovalRequestedPayload = z.infer<typeof ApprovalRequestedPayloadSchema>;
