import { createHash } from 'node:crypto';

export class InvalidIdempotencyKeyError extends Error {}
export class IdempotencyConflictError extends Error {}

export function getIdempotencyKey(
  value: string | string[] | undefined
): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    throw new InvalidIdempotencyKeyError('Idempotency-Key must be a single header');
  }

  const key = value.trim();
  if (!key || key.length > 255) {
    throw new InvalidIdempotencyKeyError(
      'Idempotency-Key must contain between 1 and 255 characters'
    );
  }
  return key;
}

export function scopeIdempotencyKey(
  key: string | undefined,
  scope: string,
  actorId: string
): string | undefined {
  if (!key) return undefined;
  const digest = createHash('sha256').update(key).digest('hex');
  return `${scope}:${actorId}:${digest}`;
}

export function fingerprintIdempotentRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function assertIdempotencyFingerprint(
  actual: string | null,
  expected: string | undefined
): void {
  if (expected && actual !== expected) {
    throw new IdempotencyConflictError(
      'Idempotency-Key was used with a different request'
    );
  }
}
