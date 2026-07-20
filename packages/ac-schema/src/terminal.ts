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

export const BrowserTerminalClientMessageSchema = z.discriminatedUnion('type', [
  BrowserTerminalHelloMessageSchema,
  BrowserTerminalInputMessageSchema,
  BrowserTerminalResizeMessageSchema,
  BrowserTerminalControlMessageSchema,
  BrowserTerminalDetachMessageSchema,
]);
export type BrowserTerminalClientMessage = z.infer<typeof BrowserTerminalClientMessageSchema>;

export const BrowserTerminalOutputMessageSchema = z.object({
  type: z.literal('output'),
  data: z.string(),
  encoding: z.enum(['base64', 'utf8']).optional(),
});

export const BrowserTerminalAttachedMessageSchema = z.object({
  type: z.literal('attached'),
  message: z.string().optional(),
  readonly: z.boolean().optional(),
  resumed: z.boolean().optional(),
  resume_token: z.string().min(1).optional(),
});

const BrowserTerminalSimpleStatusMessageSchema = z.object({
  type: z.enum(['detached', 'error', 'readonly', 'control']),
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

export const BrowserTerminalServerMessageSchema = z.union([
  BrowserTerminalOutputMessageSchema,
  BrowserTerminalAttachedMessageSchema,
  BrowserTerminalSimpleStatusMessageSchema,
  BrowserTerminalIdleTimeoutMessageSchema,
  BrowserTerminalLagMessageSchema,
]);
export type BrowserTerminalServerMessage = z.infer<typeof BrowserTerminalServerMessageSchema>;
