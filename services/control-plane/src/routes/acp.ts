import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ACPActionSchema,
  ACPStatusResultSchema,
  type ACPAction,
  type ACPStatusResult,
} from '@agent-command/schema';
import { config } from '../config.js';
import * as db from '../db/index.js';
import { hasRole } from '../auth/rbac.js';
import { isHostOnline } from '../services/hostPresence.js';
import { commandRouter } from '../services/commandRouter.js';

const ACPQuerySchema = {
  safeParse(value: unknown) {
    const parsed = new URLSearchParams();
    if (value && typeof value === 'object') {
      for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        if (typeof raw !== 'string') return { success: false as const, error: new Error('Invalid query') };
        parsed.set(key, raw);
      }
    }
    const taskId = parsed.get('task_id') || undefined;
    const programId = parsed.get('program_id') || undefined;
    if (taskId && programId) return { success: false as const, error: new Error('Select one ACP record') };
    if (taskId && (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(taskId) || taskId.includes('..'))) {
      return { success: false as const, error: new Error('Invalid task_id') };
    }
    if (programId && (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(programId) || programId.includes('..'))) {
      return { success: false as const, error: new Error('Invalid program_id') };
    }
    for (const key of parsed.keys()) {
      if (key !== 'task_id' && key !== 'program_id') {
        return { success: false as const, error: new Error('Unknown ACP query field') };
      }
    }
    return { success: true as const, data: { task_id: taskId, program_id: programId } };
  },
};

type ACPQuery = { task_id?: string; program_id?: string };
type ACPSource = { id: string; host: NonNullable<Awaited<ReturnType<typeof db.getHostById>>> };

function unavailable(reply: FastifyReply, reason: string) {
  return reply.status(503).send({ error: reason, available: false });
}

async function resolveACPSource(): Promise<{ source?: ACPSource; reason?: string }> {
  const hostId = config.ACP_SOURCE_HOST_ID;
  if (!hostId) return { reason: 'ACP_SOURCE_HOST_ID is not configured' };
  const host = await db.getHostById(hostId);
  if (!host) return { reason: 'Configured ACP source host was not found' };
  if (!isHostOnline(host.id)) return { reason: 'Configured ACP source host is offline' };
  const capabilities = host.capabilities as Record<string, unknown> | null;
  if (capabilities?.acp_status !== true) {
    return { reason: 'Configured ACP source host does not advertise acp_status capability' };
  }
  return { source: { id: host.id, host } };
}

async function readACPStatus(hostId: string, query: ACPQuery = {}): Promise<ACPStatusResult> {
  const result = await commandRouter.dispatchHostAndWait(hostId, randomUUID(), {
    type: 'acp_status',
    payload: query,
  }, 20_000);
  if (!result.ok) {
    throw new Error(result.error?.message || 'ACP status command failed');
  }
  const parsed = ACPStatusResultSchema.safeParse(result.result);
  if (!parsed.success) throw new Error('ACP status response was invalid');
  return parsed.data;
}

function unknownFleetFacts(machine: string): ACPStatusResult['fleet'] {
  return {
    available: false,
    release_alignment: 'unknown',
    activations: [{
      machine,
      open_agents_version: 'unknown',
      open_agents_path: 'unknown',
      measured_at: 'unknown',
    }],
    capabilities: [
      ['hermes-gateway', 'gateway'],
      ['dispatch-worker', 'claim-queue-item'],
      ['open-agents-release', 'immutable-artifact'],
    ].map(([harness, capability]) => ({ machine, harness, capability, available: false, measured_at: 'unknown' })),
  };
}

function mergeFleetFacts(facts: ACPStatusResult['fleet'][]): ACPStatusResult['fleet'] {
  const machines = ['heavisidelinux', 'homelinux'];
  const activations = machines.map((machine) => facts
    .flatMap((fleet) => fleet.activations)
    .find((row) => row.machine === machine && row.open_agents_version !== 'unknown')
    || facts.flatMap((fleet) => fleet.activations).find((row) => row.machine === machine)
    || unknownFleetFacts(machine).activations[0]);
  const capabilities = machines.flatMap((machine) => {
    const rows = facts.flatMap((fleet) => fleet.capabilities).filter((row) => row.machine === machine);
    const known = new Map(rows.map((row) => [`${row.harness}:${row.capability}`, row]));
    return [
      ['hermes-gateway', 'gateway'],
      ['dispatch-worker', 'claim-queue-item'],
      ['open-agents-release', 'immutable-artifact'],
    ].map(([harness, capability]) => known.get(`${harness}:${capability}`)
      || unknownFleetFacts(machine).capabilities.find((row) => row.harness === harness)!
    );
  });
  const knownActivations = activations.every((row) => row.open_agents_version !== 'unknown' && row.open_agents_path !== 'unknown');
  const releaseAlignment = !knownActivations
    ? 'unknown'
    : activations[0].open_agents_version === activations[1].open_agents_version
      && activations[0].open_agents_path === activations[1].open_agents_path
      ? 'aligned'
      : 'different';
  return {
    available: facts.some((fleet) => fleet.available),
    release_alignment: releaseAlignment,
    activations,
    capabilities,
  };
}

function fleetFactsForMachine(fleet: ACPStatusResult['fleet'], machine: string): ACPStatusResult['fleet'] {
  const fallback = unknownFleetFacts(machine);
  return {
    available: fleet.available,
    release_alignment: 'unknown',
    activations: fleet.activations.filter((row) => row.machine === machine).length
      ? fleet.activations.filter((row) => row.machine === machine)
      : fallback.activations,
    capabilities: fleet.capabilities.filter((row) => row.machine === machine).length
      ? fleet.capabilities.filter((row) => row.machine === machine)
      : fallback.capabilities,
  };
}

async function readFleetFacts(sourceHostId: string, sourceStatus: ACPStatusResult): Promise<ACPStatusResult['fleet']> {
  const hosts = await db.getHosts();
  const facts = await Promise.all(['heavisidelinux', 'homelinux'].map(async (machine) => {
    const host = hosts.find((candidate) => candidate.name === machine);
    if (!host || !isHostOnline(host.id)) return unknownFleetFacts(machine);
    if (host.id === sourceHostId) return fleetFactsForMachine(sourceStatus.fleet, machine);
    const capabilities = host.capabilities as Record<string, unknown> | null;
    if (capabilities?.acp_status !== true) return unknownFleetFacts(machine);
    try {
      return fleetFactsForMachine((await readACPStatus(host.id)).fleet, machine);
    } catch {
      return unknownFleetFacts(machine);
    }
  }));
  return mergeFleetFacts(facts);
}

function actorForRequest(request: FastifyRequest): string {
  const user = request.user;
  if (!user) return '';
  const candidates = [user.name, user.email?.split('@')[0], user.sub, user.id]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase());
  if (candidates.some((value) => value === 'chris' || value.startsWith('chris.') || value.startsWith('chris-'))) {
    return 'chris';
  }
  return candidates[0] || '';
}

async function rejectReservedAnswer(
  action: Extract<ACPAction, { type: 'answer_program' }>,
  source: ACPSource
): Promise<string | null> {
  const answer = action.answer.trim().toLowerCase();
  if (answer === 'cancel') return 'cancel is reserved; use Cancel program';
  if (answer !== 'retry') return null;
  const status = await readACPStatus(source.id, { program_id: action.program_id });
  const selected = status.work.selected;
  if (!selected) return 'The program is no longer available';
  const normalizedStatus = selected.raw_status.toLowerCase().replace(/[_ ]/g, '-');
  if (normalizedStatus.includes('review') || normalizedStatus.includes('judgment') || selected.program?.setup_gate) {
    return 'Retry remains available only through the authorized ACP CLI';
  }
  return null;
}

async function verifyApprovalDigest(
  action: Extract<ACPAction, { type: 'approve_program' }>,
  source: ACPSource
): Promise<ACPStatusResult> {
  const status = await readACPStatus(source.id, { program_id: action.program_id });
  const selected = status.work.selected;
  if (!selected) throw new Error('The program is no longer available');
  const digest = selected.approval_snapshot_digest;
  if (!digest || digest.toLowerCase() !== action.approval_digest.toLowerCase()) {
    throw new Error('Approval digest does not match the current frozen plan');
  }
  return status;
}

export function registerACPRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: unknown }>('/v1/acp', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'ACP access requires operator role' });
    }
    const query = ACPQuerySchema.safeParse(request.query);
    if (!query.success) return reply.status(400).send({ error: query.error.message });
    const resolved = await resolveACPSource();
    if (!resolved.source) return unavailable(reply, resolved.reason || 'ACP source is unavailable');
    try {
      const status = await readACPStatus(resolved.source.id, query.data);
      status.fleet = await readFleetFacts(resolved.source.id, status);
      return status;
    } catch (error) {
      return unavailable(reply, error instanceof Error ? error.message : 'ACP source is unavailable');
    }
  });

  app.post<{ Body: unknown }>('/v1/acp/actions', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'ACP actions require operator role' });
    }
    const parsed = ACPActionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid ACP action', details: parsed.error });
    }
    const resolved = await resolveACPSource();
    if (!resolved.source) return unavailable(reply, resolved.reason || 'ACP source is unavailable');
    const action = parsed.data;
    const actor = actorForRequest(request);
    if (!actor) return reply.status(403).send({ error: 'Authenticated ACP identity is unavailable' });

    try {
      if (action.type === 'answer_program') {
        const reserved = await rejectReservedAnswer(action, resolved.source);
        if (reserved) return reply.status(400).send({ error: reserved });
      }
      if (action.type === 'approve_program') {
        if (actor !== 'chris' || request.user.auth_type === 'service') {
          return reply.status(403).send({ error: 'Program approval is restricted to the Human Owner' });
        }
        await verifyApprovalDigest(action, resolved.source);
      }

      const invocation = {
        ...action,
        request_id: randomUUID(),
        requested_by: actor,
        ...(action.type === 'approve_program' ? { approved_by: 'chris' } : {}),
      };
      const result = await commandRouter.dispatchHostAndWait(resolved.source.id, randomUUID(), {
        type: 'acp_action',
        payload: invocation,
      }, 30_000);
      if (!result.ok) {
        return reply.status(502).send({
          error: result.error?.message || 'ACP action failed',
          accepted: false,
          queued: false,
        });
      }
      return result.result || { accepted: true, queued: true, status: 'accepted' };
    } catch (error) {
      return reply.status(409).send({
        error: error instanceof Error ? error.message : 'ACP action could not be verified',
        accepted: false,
        queued: false,
      });
    }
  });
}
