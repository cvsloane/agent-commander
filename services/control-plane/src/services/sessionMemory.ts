import type { Session } from '@agent-command/schema';
import * as db from '../db/index.js';
import * as automationDb from '../db/automationMemory.js';
import { sendInputToSession, waitForSessionReady } from './sessionSpawn.js';

type BootstrapSource = 'automatic' | 'automation';

function buildMemoryPrompt(input: {
  source: BootstrapSource;
  repoEntries: Array<{ summary: string; content: string }>;
  globalEntries: Array<{ summary: string; content: string }>;
  objective?: string | null;
  workItemText?: string | null;
  agentName?: string | null;
}): string | null {
  const repoBlock = input.repoEntries.length > 0
    ? input.repoEntries.map((entry, index) => `${index + 1}. ${entry.summary}\n${entry.content}`).join('\n\n')
    : '';
  const globalBlock = input.globalEntries.length > 0
    ? input.globalEntries.map((entry, index) => `${index + 1}. ${entry.summary}\n${entry.content}`).join('\n\n')
    : '';

  if (
    !repoBlock
    && !globalBlock
    && !input.objective?.trim()
    && !input.workItemText?.trim()
  ) {
    return null;
  }

  const parts = [
    input.source === 'automation'
      ? `Agent Commander automation context${input.agentName ? ` for ${input.agentName}` : ''}.`
      : 'Agent Commander memory context for this session.',
    input.objective ? `Objective:\n${input.objective}` : null,
    input.workItemText ? `Checked out work item:\n${input.workItemText}` : null,
    repoBlock ? `Repo memory:\n${repoBlock}` : null,
    globalBlock ? `Global memory:\n${globalBlock}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join('\n\n') : null;
}

export async function bootstrapSessionMemory(input: {
  host_id: string;
  session_id: string;
  source: BootstrapSource;
  objective?: string | null;
  workItemText?: string | null;
  agentName?: string | null;
}): Promise<{
  session: Session | null;
  repoEntryIds: string[];
  globalEntryIds: string[];
  skipped: boolean;
}> {
  const existing = await db.getSessionById(input.session_id);
  if (!existing?.user_id) {
    return { session: existing, repoEntryIds: [], globalEntryIds: [], skipped: true };
  }

  const currentSession = existing.status === 'STARTING'
    ? await waitForSessionReady(existing.id, 30_000, 500)
    : existing;
  if (!currentSession) {
    return { session: null, repoEntryIds: [], globalEntryIds: [], skipped: true };
  }
  if (!currentSession.user_id) {
    return { session: currentSession, repoEntryIds: [], globalEntryIds: [], skipped: true };
  }

  const metadata = (currentSession.metadata ?? {}) as Record<string, unknown>;
  if (metadata.memory_bootstrap && input.source === 'automatic') {
    return { session: currentSession, repoEntryIds: [], globalEntryIds: [], skipped: true };
  }

  const memory = await automationDb.getMemoryContextBrief(currentSession.user_id, {
    repo_id: currentSession.repo_id || null,
    limitPerScope: 3,
  });
  const prompt = buildMemoryPrompt({
    source: input.source,
    repoEntries: memory.repo,
    globalEntries: memory.global,
    objective: input.objective || null,
    workItemText: input.workItemText || null,
    agentName: input.agentName || null,
  });

  if (!prompt) {
    return {
      session: currentSession,
      repoEntryIds: memory.repo.map((entry) => entry.id),
      globalEntryIds: memory.global.map((entry) => entry.id),
      skipped: true,
    };
  }

  await sendInputToSession({
    host_id: input.host_id,
    session_id: currentSession.id,
    text: prompt,
    enter: true,
  });
  await automationDb.recordMemoryAccess([
    ...memory.repo.map((entry) => entry.id),
    ...memory.global.map((entry) => entry.id),
  ]);
  const updated = await db.patchSessionMetadata(currentSession.id, {
    memory_bootstrap: {
      sent_at: new Date().toISOString(),
      source: input.source,
      repo_entry_ids: memory.repo.map((entry) => entry.id),
      global_entry_ids: memory.global.map((entry) => entry.id),
      total_entries: memory.repo.length + memory.global.length,
    },
  });

  return {
    session: updated ?? currentSession,
    repoEntryIds: memory.repo.map((entry) => entry.id),
    globalEntryIds: memory.global.map((entry) => entry.id),
    skipped: false,
  };
}
