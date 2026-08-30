import assert from 'node:assert/strict';
import test from 'node:test';

// ADMIN-002 Stage 6B — prove the api.ts plumbing:
//  - a caller-provided AbortSignal reaches fetch (composed with the internal
//    15s timeout signal, which stays active);
//  - a CALLER abort is reported as `code: 'aborted'` (expected control flow),
//    distinct from the timeout's `code: 'timeout'` (a user-visible failure);
//  - the backend business `code` is preserved on ApiError.businessCode.
//
// `src/lib/api.ts` uses `window.setTimeout` (a pre-existing pattern); alias
// `window` to `globalThis` and mock `fetch`. No jsdom.

(globalThis as unknown as { window?: unknown }).window ??= globalThis;

type FetchArgs = { url: string; init: RequestInit };
let lastFetch: FetchArgs | null = null;
let fetchImpl: (args: FetchArgs) => Promise<Response>;

(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const args: FetchArgs = { url: String(input), init: init ?? {} };
  lastFetch = args;
  return fetchImpl(args);
}) as typeof fetch;

const jsonResponse = (status: number, body: unknown): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
} as unknown as Response);

const { ApiError, getAdminExecutiveDashboard } = await import('../src/lib/api');

test('§60 a caller AbortSignal reaches fetch; happy path still resolves', async () => {
  fetchImpl = async () => jsonResponse(200, { generatedAt: 'x', event: { slug: 'a' } });
  const controller = new AbortController();

  const result = await getAdminExecutiveDashboard('session', 'a', { signal: controller.signal });

  assert.ok(result);
  assert.ok(lastFetch);
  const signal = lastFetch.init.signal as AbortSignal;
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
  // the composed signal is NOT the caller's raw signal — it also carries the timeout
  assert.notEqual(signal, controller.signal);
});

test('§62 a caller abort surfaces as ApiError code "aborted" (not a network failure)', async () => {
  fetchImpl = async ({ init }) => {
    if ((init.signal as AbortSignal | undefined)?.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    return jsonResponse(200, {});
  };
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => getAdminExecutiveDashboard('session', 'a', { signal: controller.signal }),
    (error: unknown) => error instanceof ApiError && error.code === 'aborted' && error.retryable === false,
  );
});

test('§61 the internal timeout stays distinguishable from a caller abort', async () => {
  // Simulate the browser aborting the fetch for the internal timeout while the
  // caller signal was never aborted.
  fetchImpl = async () => { throw new DOMException('The operation was aborted', 'AbortError'); };

  await assert.rejects(
    () => getAdminExecutiveDashboard('session', 'a'),
    (error: unknown) => error instanceof ApiError && error.code === 'timeout',
  );
});

test('§63 backend business code is preserved on ApiError.businessCode', async () => {
  fetchImpl = async () => jsonResponse(400, { code: 'EVENT_SCOPE_AMBIGUOUS', message: 'Ha mais de um evento publicado.' });

  await assert.rejects(
    () => getAdminExecutiveDashboard('session', undefined, {}),
    (error: unknown) => error instanceof ApiError
      && error.status === 400
      && error.businessCode === 'EVENT_SCOPE_AMBIGUOUS'
      && error.code === 'http_400'
      && error.message === 'Ha mais de um evento publicado.',
  );
});
