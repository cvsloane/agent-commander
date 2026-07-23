import { z } from 'zod';

export const TerminalDimensionSchema = z.number().int().min(1).max(65_535);

export const BrowserTerminalHelloMessageSchema = z.object({
  type: z.literal('hello'),
  binary: z.literal(true),
});

export const BrowserTerminalInputMessageSchema = z.object({
  type: z.literal('input'),
  data: z.string(),
});

export const BrowserTerminalResizeMessageSchema = z.object({
  type: z.literal('resize'),
  cols: TerminalDimensionSchema,
  rows: TerminalDimensionSchema,
});

export const BrowserTerminalControlMessageSchema = z.object({
  type: z.literal('control'),
});

export const BrowserTerminalDetachMessageSchema = z.object({
  type: z.literal('detach'),
});

export const BrowserTerminalNavigateMessageSchema = z.discriminatedUnion('op', [
  z.object({
    type: z.literal('navigate'),
    op: z.literal('viewer_state'),
    request_id: z.string().uuid(),
  }),
  z.object({
    type: z.literal('navigate'),
    op: z.literal('focus_pane'),
    request_id: z.string().uuid(),
    pane_id: z.string().min(1),
    zoom: z.boolean(),
  }),
  z.object({
    type: z.literal('navigate'),
    op: z.literal('select_window'),
    window_index: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('navigate'),
    op: z.literal('select_pane'),
    pane_id: z.string().min(1),
  }),
  z.object({
    type: z.literal('navigate'),
    op: z.literal('zoom'),
    on: z.boolean(),
  }),
  z.object({
    type: z.literal('navigate'),
    op: z.literal('scroll'),
    lines: z.number().int().min(-120).max(120),
  }),
]);
export type BrowserTerminalNavigateMessage = z.infer<typeof BrowserTerminalNavigateMessageSchema>;

export const BrowserTerminalClientMessageSchema = z.union([
  BrowserTerminalHelloMessageSchema,
  BrowserTerminalInputMessageSchema,
  BrowserTerminalResizeMessageSchema,
  BrowserTerminalControlMessageSchema,
  BrowserTerminalDetachMessageSchema,
  BrowserTerminalNavigateMessageSchema,
]);
export type BrowserTerminalClientMessage = z.infer<typeof BrowserTerminalClientMessageSchema>;

export const BrowserTerminalOutputMessageSchema = z.object({
  type: z.literal('output'),
  data: z.string(),
  encoding: z.enum(['base64', 'utf8']).optional(),
});

export const BrowserTerminalAttachedMessageSchema = z.object({
  type: z.literal('attached'),
  pane_id: z.string().min(1).optional(),
  message: z.string().optional(),
  readonly: z.boolean().optional(),
  resumed: z.boolean().optional(),
  resume_token: z.string().min(1).optional(),
});

const BrowserTerminalSimpleStatusMessageSchema = z.object({
  type: z.enum(['detached', 'error', 'readonly', 'control']),
  pane_id: z.string().min(1).optional(),
  message: z.string().optional(),
});

export const BrowserTerminalIdleTimeoutMessageSchema = z.object({
  type: z.literal('idle_timeout'),
});

export const BrowserTerminalLagMessageSchema = z.object({
  type: z.literal('lag'),
  message: z.string().optional(),
  dropped: z.number().int().positive().optional(),
});

export const BrowserTerminalNavigationResultMessageSchema = z.discriminatedUnion('ok', [
  z.object({
    type: z.literal('navigation_result'),
    request_id: z.string().uuid(),
    ok: z.literal(true),
    pane_id: z.string().min(1),
    window_index: z.number().int().nonnegative(),
    zoomed: z.boolean(),
  }),
  z.object({
    type: z.literal('navigation_result'),
    request_id: z.string().uuid(),
    ok: z.literal(false),
    message: z.string().min(1),
    pane_id: z.string().min(1).optional(),
    window_index: z.number().int().nonnegative().optional(),
    zoomed: z.boolean().optional(),
  }),
]);
export type BrowserTerminalNavigationResultMessage = z.infer<
  typeof BrowserTerminalNavigationResultMessageSchema
>;

export const BrowserTerminalServerMessageSchema = z.union([
  BrowserTerminalOutputMessageSchema,
  BrowserTerminalAttachedMessageSchema,
  BrowserTerminalSimpleStatusMessageSchema,
  BrowserTerminalIdleTimeoutMessageSchema,
  BrowserTerminalLagMessageSchema,
  BrowserTerminalNavigationResultMessageSchema,
]);
export type BrowserTerminalServerMessage = z.infer<typeof BrowserTerminalServerMessageSchema>;
