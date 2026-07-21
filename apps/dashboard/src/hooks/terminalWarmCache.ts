import type { XTerminal } from '@/components/terminal/types';

const MAX_WARM_TERMINALS = 8;
const MAX_WARM_BUFFER_CHARS = 256_000;

interface TerminalWarmEntry {
  buffer?: string;
  resumeToken?: string;
  updatedAt: number;
}

const entries = new Map<string, TerminalWarmEntry>();
const provisionalBuffers = new Set<string>();

function touch(key: string, entry: TerminalWarmEntry) {
  entries.delete(key);
  entries.set(key, entry);
  while (entries.size > MAX_WARM_TERMINALS) {
    const oldest = entries.keys().next().value as string | undefined;
    if (!oldest) break;
    entries.delete(oldest);
    provisionalBuffers.delete(oldest);
  }
}

function getFreshEntry(key: string, maxAgeMs: number, now = Date.now()) {
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (now - entry.updatedAt > maxAgeMs) {
    entries.delete(key);
    provisionalBuffers.delete(key);
    return undefined;
  }
  touch(key, entry);
  return entry;
}

export function serializeTerminalBuffer(terminal: XTerminal): string {
  const buffer = terminal.buffer?.active;
  if (!buffer) return '';
  const lines: string[] = [];
  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += text;
    } else {
      lines.push(text);
    }
  }
  return lines.join('\r\n').slice(-MAX_WARM_BUFFER_CHARS);
}

export function captureTerminalWarmBuffer(key: string, terminal: XTerminal, now = Date.now()) {
  const buffer = serializeTerminalBuffer(terminal);
  const previous = entries.get(key);
  touch(key, { ...previous, buffer, updatedAt: now });
}

export function hasTerminalWarmBuffer(key: string, maxAgeMs: number): boolean {
  return Boolean(getFreshEntry(key, maxAgeMs)?.buffer);
}

export function paintTerminalWarmBuffer(
  key: string,
  terminal: XTerminal,
  maxAgeMs: number
): boolean {
  const buffer = getFreshEntry(key, maxAgeMs)?.buffer;
  if (!buffer) return false;
  terminal.write(buffer);
  provisionalBuffers.add(key);
  return true;
}

export function clearProvisionalTerminalWarmBuffer(key: string, terminal: XTerminal): boolean {
  if (!provisionalBuffers.delete(key)) return false;
  terminal.reset();
  return true;
}

export function getTerminalWarmResumeToken(key: string, maxAgeMs: number): string | undefined {
  return getFreshEntry(key, maxAgeMs)?.resumeToken;
}

export function setTerminalWarmResumeToken(key: string, resumeToken: string, now = Date.now()) {
  const previous = entries.get(key);
  touch(key, { ...previous, resumeToken, updatedAt: now });
}

export function clearTerminalWarmResumeToken(key: string) {
  const previous = entries.get(key);
  if (!previous) return;
  if (previous.buffer) touch(key, { buffer: previous.buffer, updatedAt: previous.updatedAt });
  else entries.delete(key);
}

export function getTerminalResumeNotice({
  resumed,
  requestedResume,
  hadWarmBuffer,
  restartedAfterFailure,
}: {
  resumed: boolean;
  requestedResume: boolean;
  hadWarmBuffer: boolean;
  restartedAfterFailure: boolean;
}): 'resumed' | 'restarted' | undefined {
  if (resumed && requestedResume) return 'resumed';
  if (!resumed && (hadWarmBuffer || restartedAfterFailure)) return 'restarted';
  return undefined;
}

export function resetTerminalWarmCache() {
  entries.clear();
  provisionalBuffers.clear();
}
