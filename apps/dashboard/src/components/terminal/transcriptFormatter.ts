import type { TranscriptEntry } from '@agent-command/schema';

export interface TranscriptDisplayLine {
  text: string;
  dim: boolean;
}

const SKIPPED_ENTRY_TYPES = new Set([
  'system',
  'meta',
  'progress',
  'summary',
  'file-history-snapshot',
  'queue-operation',
]);
const SKIPPED_CONTENT_TYPES = new Set(['thinking', 'system', 'meta', 'progress', 'tool_result']);
const PRIMARY_INPUT_KEYS = ['command', 'query', 'prompt', 'path', 'pattern', 'description', 'url'];

export function formatTranscriptEntries(
  entries: TranscriptEntry[],
  maxColumns = Number.POSITIVE_INFINITY
): TranscriptDisplayLine[] {
  const lines: TranscriptDisplayLine[] = [];
  for (const entry of entries) {
    const entryType = stringValue(entry.type).toLowerCase();
    if (SKIPPED_ENTRY_TYPES.has(entryType) || entry.isMeta === true || entry.is_meta === true) {
      continue;
    }
    if (entryType === 'tool_use') {
      appendToolLine(lines, entry);
      continue;
    }

    const message = recordValue(entry.message);
    const role = stringValue(message?.role || entry.role || entry.type).toLowerCase();
    const content = message?.content ?? entry.content;
    if (role === 'user') {
      const text = contentText(content);
      if (text) appendUserText(lines, text);
      continue;
    }
    if (role === 'assistant') {
      appendAssistantContent(lines, content);
    }
  }
  return lines.flatMap((line) => wrapDisplayLine(line, maxColumns));
}

function appendUserText(lines: TranscriptDisplayLine[], text: string): void {
  const parts = splitTextLines(text);
  parts.forEach((part, index) => {
    lines.push({ text: `${index === 0 ? '❯ ' : '  '}${part}`, dim: false });
  });
}

function appendAssistantContent(lines: TranscriptDisplayLine[], content: unknown): void {
  if (typeof content === 'string') {
    appendPlainText(lines, content);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (typeof block === 'string') {
      appendPlainText(lines, block);
      continue;
    }
    const item = recordValue(block);
    if (!item) continue;
    const blockType = stringValue(item.type).toLowerCase();
    if (SKIPPED_CONTENT_TYPES.has(blockType)) continue;
    if (blockType === 'tool_use') {
      appendToolLine(lines, item);
      continue;
    }
    if (blockType === 'text' || (!blockType && typeof item.text === 'string')) {
      appendPlainText(lines, stringValue(item.text));
    }
  }
}

function appendPlainText(lines: TranscriptDisplayLine[], text: string): void {
  for (const part of splitTextLines(text)) {
    lines.push({ text: part, dim: false });
  }
}

function appendToolLine(lines: TranscriptDisplayLine[], tool: Record<string, unknown>): void {
  const name = stringValue(tool.name || tool.tool_name || tool.tool) || 'tool';
  const primaryInput = summarizePrimaryInput(tool.input ?? tool.tool_input);
  lines.push({
    text: `⏺ ${name}${primaryInput ? ` ${primaryInput}` : ''}`,
    dim: true,
  });
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const text: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      text.push(block);
      continue;
    }
    const item = recordValue(block);
    if (!item) continue;
    const blockType = stringValue(item.type).toLowerCase();
    if (blockType === 'text' && typeof item.text === 'string') text.push(item.text);
  }
  return text.join('\n');
}

function summarizePrimaryInput(input: unknown): string {
  if (typeof input === 'string') return normalizeInput(input).slice(0, 80);
  const record = recordValue(input);
  if (!record) return '';
  for (const key of PRIMARY_INPUT_KEYS) {
    if (typeof record[key] === 'string') return normalizeInput(record[key]).slice(0, 80);
  }
  const firstString = Object.keys(record)
    .sort()
    .map((key) => record[key])
    .find((value): value is string => typeof value === 'string');
  if (firstString) return normalizeInput(firstString).slice(0, 80);
  try {
    return JSON.stringify(record).slice(0, 80);
  } catch {
    return '';
  }
}

function normalizeInput(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function splitTextLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

function wrapDisplayLine(line: TranscriptDisplayLine, maxColumns: number): TranscriptDisplayLine[] {
  if (!Number.isFinite(maxColumns)) return [line];
  const width = Math.max(1, Math.floor(maxColumns));
  const characters = Array.from(line.text);
  if (characters.length <= width) return [line];
  const wrapped: TranscriptDisplayLine[] = [];
  for (let start = 0; start < characters.length;) {
    let end = Math.min(characters.length, start + width);
    if (end < characters.length) {
      for (let candidate = end - 1; candidate > start; candidate -= 1) {
        if (/\s/u.test(characters[candidate] || '')) {
          end = candidate + 1;
          break;
        }
      }
    }
    wrapped.push({ text: characters.slice(start, end).join(''), dim: line.dim });
    start = end;
  }
  return wrapped;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
