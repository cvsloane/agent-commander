export class InvalidIdempotencyKeyError extends Error {}

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
