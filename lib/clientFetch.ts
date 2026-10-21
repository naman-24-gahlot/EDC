// Client-safe. JSON requests with plain-language failures for the sign-in and password flows:
// offline, dropped connection, a server that never answers, and a session that ended mid-way.

export class RequestError extends Error {
  constructor(message: string, readonly status: number | null, readonly data: Record<string, unknown> | null = null) {
    super(message);
  }
  /** The session is gone (expired, revoked, signed out elsewhere) — the caller should send them to sign in. */
  get sessionEnded() { return this.status === 401; }
  /** We never heard back: the request may or may not have taken effect. */
  get noAnswer() { return this.status === null; }
}

const TIMEOUT_MS = 20_000;

export async function sendJson<T = Record<string, unknown>>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new RequestError("You're offline — check your internet connection and try again.", null);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'AbortError';
    throw new RequestError(
      timedOut ? 'The server took too long to answer. Check your connection and try again.' : "Couldn't reach the server. Check your connection and try again.",
      null
    );
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const fallback = res.status === 401 ? 'Your session has ended — please sign in again.'
      : res.status >= 500 ? 'Something went wrong on our side. Please try again in a moment.'
      : 'That did not work. Please try again.';
    throw new RequestError(typeof data?.error === 'string' ? data.error : fallback, res.status, data);
  }
  return (data ?? {}) as T;
}
