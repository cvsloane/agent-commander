export type Fetch = typeof globalThis.fetch;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class FeatureUnavailableError extends Error {
  readonly status = 404;

  constructor(readonly feature: string) {
    super(`${feature} is not available on this control-plane version`);
    this.name = 'FeatureUnavailableError';
  }
}

export function isMissingRoute(error: unknown): error is ApiError {
  if (!(error instanceof ApiError) || error.status !== 404) return false;
  if (!error.details || typeof error.details !== 'object') return false;
  const message = (error.details as Record<string, unknown>).message;
  return typeof message === 'string' && /^Route\s+.+\s+not found$/i.test(message);
}

export function requiresSessionOrServiceAuth(error: unknown): error is ApiError {
  if (!(error instanceof ApiError) || error.status !== 403) return false;
  if (!error.details || typeof error.details !== 'object') return false;
  const details = error.details as Record<string, unknown>;
  return details.error === 'Service or session authentication required'
    || details.message === 'Service or session authentication required';
}

export interface JsonRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers?: ConstructorParameters<typeof Headers>[0];
  body?: unknown;
}

function responseMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.error === 'string') return record.error;
    if (typeof record.message === 'string') return record.message;
  }
  return fallback;
}

export async function requestJson<T>(
  fetch: Fetch,
  url: string,
  options: JsonRequestOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('accept', 'application/json');
  if (options.body !== undefined) headers.set('content-type', 'application/json');

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json() as unknown
    : await response.text();

  if (!response.ok) {
    throw new ApiError(
      response.status,
      responseMessage(body, `${response.status} ${response.statusText}`),
      body,
    );
  }

  return body as T;
}
