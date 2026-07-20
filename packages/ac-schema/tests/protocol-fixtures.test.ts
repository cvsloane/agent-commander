import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AgentMessageSchema,
  ServerToAgentMessageSchema,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(here, '../../../tests/fixtures/protocol');

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtureDir, name), 'utf8'));
}

describe('protocol fixtures', () => {
  it.each([
    'agent-hello.json',
    'sessions-upsert-tmux.json',
    'terminal-output.json',
    'commands-result.json',
  ])('validates agent message fixture %s', (name) => {
    expect(AgentMessageSchema.safeParse(readFixture(name)).success).toBe(true);
  });

  it.each([
    'terminal-attach.json',
    'terminal-input.json',
    'commands-dispatch-send-input.json',
  ])('validates server-to-agent message fixture %s', (name) => {
    expect(ServerToAgentMessageSchema.safeParse(readFixture(name)).success).toBe(true);
  });
});
