import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AgentMessageSchema,
  ServerToUIMessageSchema,
  ServerToAgentMessageSchema,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(here, '../../../tests/fixtures/protocol');

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtureDir, name), 'utf8'));
}

function readFixtureText(name: string): string {
  return readFileSync(resolve(fixtureDir, name), 'utf8').trim();
}

describe('protocol fixtures', () => {
  it.each([
    'agent-hello.json',
    'sessions-upsert-tmux.json',
    'terminal-output.json',
    'commands-result.json',
    'commands-result-capture-transcript.json',
  ])('validates agent message fixture %s', (name) => {
    expect(AgentMessageSchema.safeParse(readFixture(name)).success).toBe(true);
  });

  it('round-trips the frozen unsequenced tmux topology fixture byte-exactly', () => {
    const source = readFixtureText('tmux-topology.json');
    const parsed = AgentMessageSchema.parse(JSON.parse(source));

    expect(JSON.stringify(parsed)).toBe(source);
  });

  it('validates the UI command-result topic fixture', () => {
    expect(ServerToUIMessageSchema.safeParse(readFixture('ui-commands-result.json')).success).toBe(
      true
    );
  });

  it.each([
    'terminal-attach.json',
    'terminal-attach-letterbox.json',
    'terminal-input.json',
    'terminal-navigate.json',
    'terminal-navigate-scroll.json',
    'commands-dispatch-send-input.json',
    'commands-dispatch-capture-transcript.json',
  ])('validates server-to-agent message fixture %s', (name) => {
    expect(ServerToAgentMessageSchema.safeParse(readFixture(name)).success).toBe(true);
  });

  it.each([
    'commands-dispatch-new-window.json',
    'commands-dispatch-kill-window.json',
    'commands-dispatch-rename-window.json',
    'commands-dispatch-split-pane.json',
    'commands-dispatch-select-window.json',
    'commands-dispatch-select-pane.json',
    'commands-dispatch-resize-pane.json',
    'commands-dispatch-zoom-pane.json',
  ])('round-trips frozen tmux command fixture %s byte-exactly', (name) => {
    const source = readFixtureText(name);
    const parsed = ServerToAgentMessageSchema.parse(JSON.parse(source));

    expect(JSON.stringify(parsed)).toBe(source);
  });
});
