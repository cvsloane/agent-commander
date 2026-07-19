import { CommandsDispatchMessageSchema } from '@agent-command/schema';
import {
  commandOutbox,
  type CommandClass,
  type CommandOutboxRepository,
  type CommandRecord,
  type EnqueueCommand,
  type EnqueueResult,
} from '../db/commandOutbox.js';
import { pubsub } from './pubsub.js';

export const HOST_COMMAND_SESSION_ID = '00000000-0000-0000-0000-000000000000';

const DURABLE_COMMAND_TYPES = new Set([
  'spawn_session',
  'spawn_job',
  'kill_session',
  'adopt_pane',
  'fork',
]);
const VOLATILE_TTL_MS = 5 * 60 * 1000;
const DURABLE_TTL_MS = 24 * 60 * 60 * 1000;
const OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const COMPLETE_ON_SEND_TYPES = new Set(['approvals.decision']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOutboxCommandId(cmdId: string): boolean {
  return UUID_PATTERN.test(cmdId);
}

export type CommandResult = {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
};

export type RoutedCommand = {
  type: string;
  payload: unknown;
};

export type DispatchOptions = {
  class?: CommandClass;
  ttlMs?: number;
  expiresAt?: string | Date;
  idempotencyKey?: string;
  idempotencyFingerprint?: string;
};

export type RawDispatchOptions = DispatchOptions & {
  sessionId?: string | null;
};

export type DispatchReceipt = {
  accepted: boolean;
  delivered: boolean;
  created: boolean;
  record: CommandRecord;
};

type PendingCommand = {
  hostId: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export interface CommandOutbox {
  enqueue(command: EnqueueCommand): Promise<EnqueueResult>;
  getByIdForHost(hostId: string, cmdId: string): Promise<CommandRecord | null>;
  getByIdempotencyKey(hostId: string, idempotencyKey: string): Promise<CommandRecord | null>;
  markSent(hostId: string, cmdId: string): Promise<CommandRecord | null>;
  markQueued(hostId: string, cmdId: string): Promise<CommandRecord | null>;
  markCompleted(hostId: string, cmdId: string, result?: Record<string, unknown>): Promise<CommandRecord | null>;
  markFailed(hostId: string, cmdId: string, error: Record<string, unknown>): Promise<CommandRecord | null>;
  listDeliverable(hostId: string): Promise<CommandRecord[]>;
  expireStale(hostId?: string): Promise<CommandRecord[]>;
  pruneTerminal(retentionMs: number): Promise<number>;
}

export interface CommandTransport {
  send(hostId: string, message: unknown): boolean;
  isReady?: (hostId: string) => boolean;
}

const defaultTransport: CommandTransport = {
  send: (hostId, message) => pubsub.sendToAgent(hostId, message),
  isReady: (hostId) => pubsub.isAgentReady(hostId),
};

export class CommandRouter {
  private pendingResponses = new Map<string, PendingCommand>();

  constructor(
    private readonly outbox: CommandOutbox,
    private readonly transport: CommandTransport = defaultTransport,
    private readonly now: () => number = Date.now
  ) {}

  async dispatch(
    hostId: string,
    sessionId: string,
    cmdId: string,
    command: RoutedCommand,
    options: DispatchOptions = {}
  ): Promise<boolean> {
    const receipt = await this.dispatchDetailed(hostId, sessionId, cmdId, command, options);
    return receipt.accepted;
  }

  async dispatchDetailed(
    hostId: string,
    sessionId: string,
    cmdId: string,
    command: RoutedCommand,
    options: DispatchOptions = {}
  ): Promise<DispatchReceipt> {
    const message = CommandsDispatchMessageSchema.parse({
      v: 1,
      type: 'commands.dispatch',
      ts: new Date(this.now()).toISOString(),
      payload: {
        cmd_id: cmdId,
        session_id: sessionId,
        command,
      },
    });

    return this.dispatchMessageDetailed(hostId, cmdId, message, {
      ...options,
      class: options.class ?? this.classify(command.type),
      sessionId,
    });
  }

  async dispatchHost(
    hostId: string,
    cmdId: string,
    command: RoutedCommand,
    options: DispatchOptions = {}
  ): Promise<boolean> {
    return this.dispatch(hostId, HOST_COMMAND_SESSION_ID, cmdId, command, options);
  }

  async dispatchMessageDetailed(
    hostId: string,
    cmdId: string,
    message: Record<string, unknown>,
    options: RawDispatchOptions = {}
  ): Promise<DispatchReceipt> {
    const commandClass = options.class ?? 'volatile';
    const expiresAt = options.expiresAt ?? new Date(
      this.now() + (options.ttlMs ?? this.defaultTtl(commandClass))
    );
    const { record, created } = await this.outbox.enqueue({
      cmd_id: cmdId,
      host_id: hostId,
      session_id: this.persistedSessionId(options.sessionId),
      type: typeof message.type === 'string' ? message.type : 'unknown',
      payload: message,
      class: commandClass,
      expires_at: expiresAt,
      idempotency_key: options.idempotencyKey,
      idempotency_fingerprint: options.idempotencyFingerprint,
    });

    if (!created) {
      return { accepted: true, delivered: false, created, record };
    }

    const deliveredRecord = await this.deliverPersisted(record);
    if (deliveredRecord) {
      return { accepted: true, delivered: true, created, record: deliveredRecord };
    }

    if (commandClass === 'volatile') {
      const failed = await this.outbox.markFailed(hostId, record.cmd_id, {
        code: 'agent_not_connected',
        message: 'Agent not connected',
      });
      return { accepted: false, delivered: false, created, record: failed ?? record };
    }

    return { accepted: true, delivered: false, created, record };
  }

  async dispatchAndWait(
    hostId: string,
    sessionId: string,
    cmdId: string,
    command: RoutedCommand,
    timeoutMs = 30000
  ): Promise<CommandResult> {
    const response = this.registerPending<CommandResult>(hostId, cmdId, timeoutMs, 'Command timed out');
    try {
      const sent = await this.dispatch(hostId, sessionId, cmdId, command, {
        class: 'volatile',
        ttlMs: timeoutMs,
      });
      if (!sent) {
        this.rejectPending(hostId, cmdId, new Error('Agent not connected'));
      }
    } catch (error) {
      this.rejectPending(hostId, cmdId, error instanceof Error ? error : new Error(String(error)));
    }
    return response;
  }

  async dispatchHostAndWait(
    hostId: string,
    cmdId: string,
    command: RoutedCommand,
    timeoutMs = 15000
  ): Promise<CommandResult> {
    return this.dispatchAndWait(hostId, HOST_COMMAND_SESSION_ID, cmdId, command, timeoutMs);
  }

  async dispatchMessageAndWait<T>(
    hostId: string,
    cmdId: string,
    message: Record<string, unknown>,
    timeoutMs = 10000,
    options: RawDispatchOptions = {}
  ): Promise<T> {
    const response = this.registerPending<T>(hostId, cmdId, timeoutMs, 'Request timed out');
    try {
      const receipt = await this.dispatchMessageDetailed(hostId, cmdId, message, {
        ...options,
        class: 'volatile',
        ttlMs: timeoutMs,
      });
      if (!receipt.accepted) {
        this.rejectPending(hostId, cmdId, new Error('Agent not connected'));
      }
    } catch (error) {
      this.rejectPending(hostId, cmdId, error instanceof Error ? error : new Error(String(error)));
    }
    return response;
  }

  async deliverPending(hostId: string): Promise<{ delivered: number; expired: number }> {
    const expired = await this.outbox.expireStale(hostId);
    let delivered = 0;

    while (true) {
      const [command] = await this.outbox.listDeliverable(hostId);
      if (!command) break;
      if (!this.transport.send(hostId, command.payload)) {
        await this.outbox.markQueued(hostId, command.cmd_id);
        break;
      }
      if (this.completeOnSend(command)) {
        await this.outbox.markCompleted(hostId, command.cmd_id);
      }
      delivered += 1;
    }

    return { delivered, expired: expired.length };
  }

  async expireStale(): Promise<number> {
    return (await this.outbox.expireStale()).length;
  }

  async maintain(): Promise<{ expired: number; pruned: number }> {
    const expired = await this.expireStale();
    const pruned = await this.outbox.pruneTerminal(OUTBOX_RETENTION_MS);
    return { expired, pruned };
  }

  getByIdempotencyKey(hostId: string, idempotencyKey: string): Promise<CommandRecord | null> {
    return this.outbox.getByIdempotencyKey(hostId, idempotencyKey);
  }

  getByIdForHost(hostId: string, cmdId: string): Promise<CommandRecord | null> {
    return this.outbox.getByIdForHost(hostId, cmdId);
  }

  async deliverPersisted(record: CommandRecord): Promise<CommandRecord | null> {
    if (this.transport.isReady?.(record.host_id) === false) return null;
    const sent = await this.outbox.markSent(record.host_id, record.cmd_id);
    if (!sent) return null;
    if (!this.transport.send(record.host_id, record.payload)) {
      await this.outbox.markQueued(record.host_id, record.cmd_id);
      return null;
    }
    if (this.completeOnSend(record)) {
      return await this.outbox.markCompleted(record.host_id, record.cmd_id) ?? sent ?? record;
    }
    return sent ?? record;
  }

  async handleResult(hostId: string, cmdId: string, result: CommandResult): Promise<boolean> {
    if (isOutboxCommandId(cmdId)) {
      const command = await this.outbox.getByIdForHost(hostId, cmdId);
      if (!command) return false;
      if (result.ok) {
        await this.outbox.markCompleted(hostId, cmdId, result.result);
      } else {
        await this.outbox.markFailed(hostId, cmdId, result.error ?? {
          code: 'agent_error',
          message: 'Agent command failed',
        });
      }
    }
    return this.resolvePending(hostId, cmdId, result);
  }

  async handleResponse(hostId: string, cmdId: string, response: unknown): Promise<boolean> {
    if (isOutboxCommandId(cmdId)) {
      const command = await this.outbox.getByIdForHost(hostId, cmdId);
      if (!command) return false;
      const result = response && typeof response === 'object'
        ? response as Record<string, unknown>
        : { value: response };
      await this.outbox.markCompleted(hostId, cmdId, result);
    }
    return this.resolvePending(hostId, cmdId, response);
  }

  private classify(commandType: string): CommandClass {
    return DURABLE_COMMAND_TYPES.has(commandType) ? 'durable' : 'volatile';
  }

  private defaultTtl(commandClass: CommandClass): number {
    return commandClass === 'durable' ? DURABLE_TTL_MS : VOLATILE_TTL_MS;
  }

  private persistedSessionId(sessionId?: string | null): string | null {
    return !sessionId || sessionId === HOST_COMMAND_SESSION_ID ? null : sessionId;
  }

  private registerPending<T>(
    hostId: string,
    cmdId: string,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(cmdId);
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      timeout.unref?.();

      this.pendingResponses.set(cmdId, {
        hostId,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
    });
  }

  private resolvePending(hostId: string, cmdId: string, response: unknown): boolean {
    const pending = this.pendingResponses.get(cmdId);
    if (!pending || pending.hostId !== hostId) return false;
    clearTimeout(pending.timeout);
    this.pendingResponses.delete(cmdId);
    pending.resolve(response);
    return true;
  }

  private rejectPending(hostId: string, cmdId: string, error: Error): boolean {
    const pending = this.pendingResponses.get(cmdId);
    if (!pending || pending.hostId !== hostId) return false;
    clearTimeout(pending.timeout);
    this.pendingResponses.delete(cmdId);
    pending.reject(error);
    return true;
  }

  private completeOnSend(command: Pick<CommandRecord, 'type'>): boolean {
    return COMPLETE_ON_SEND_TYPES.has(command.type);
  }
}

export const commandRouter = new CommandRouter(
  commandOutbox as CommandOutboxRepository,
  defaultTransport
);

export async function handleCommandResultForPending(
  hostId: string,
  cmdId: string,
  result: CommandResult
): Promise<boolean> {
  return commandRouter.handleResult(hostId, cmdId, result);
}
