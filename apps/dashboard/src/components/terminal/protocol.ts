import {
  BrowserTerminalServerMessageSchema,
  TerminalDimensionSchema,
  type BrowserTerminalClientMessage,
  type BrowserTerminalServerMessage,
} from '@agent-command/schema';

type TerminalStatusFrame = Exclude<BrowserTerminalServerMessage, { type: 'output' }>;

export type DecodedTerminalFrame =
  | { type: 'output'; data: string | Uint8Array }
  | TerminalStatusFrame;

export function buildTerminalHello(): BrowserTerminalClientMessage {
  return { type: 'hello', binary: true };
}

export function buildTerminalWebSocketUrl(
  baseUrl: string,
  dimensions?: { cols: number; rows: number },
  resumeToken?: string
): string {
  const url = new URL(baseUrl);
  const cols = TerminalDimensionSchema.safeParse(dimensions?.cols);
  const rows = TerminalDimensionSchema.safeParse(dimensions?.rows);
  if (cols.success && rows.success) {
    url.searchParams.set('cols', String(cols.data));
    url.searchParams.set('rows', String(rows.data));
  }
  if (resumeToken) {
    url.searchParams.set('resume_token', resumeToken);
  }
  return url.toString();
}

function decodeBase64(data: string): Uint8Array {
  const decoded = atob(data);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function decodeTerminalFrame(data: string | ArrayBuffer): DecodedTerminalFrame {
  if (data instanceof ArrayBuffer) {
    return { type: 'output', data: new Uint8Array(data) };
  }

  const message = BrowserTerminalServerMessageSchema.parse(JSON.parse(data));
  if (message.type !== 'output') return message;
  return {
    type: 'output',
    data: message.encoding === 'base64' ? decodeBase64(message.data) : message.data,
  };
}
