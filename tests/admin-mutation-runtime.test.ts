import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdminMutationRuntime,
  classifyAdminMutationError,
  type AdminMutationState,
} from '../src/lib/admin-mutation-runtime';

// Mirrors src/lib/api.ts ApiError enough for classification.
class FakeApiError extends Error {
  status?: number;
  code: string;
  businessCode?: string;
  constructor(message: string, options: { status?: number; code?: string; businessCode?: string } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code || 'api_error';
    this.businessCode = options.businessCode;
  }
}

function track<T>() {
  const states: AdminMutationState<T>[] = [];
  const runtime = new AdminMutationRuntime<T>((state) => states.push(state));
  return { runtime, states, last: () => states[states.length - 1] };
}

test('happy path: idle -> confirming -> submitting -> success carries the backend message', async () => {
  const { runtime, last } = track<{ message: string; registration: { id: string } }>();
  assert.equal(runtime.getState().phase, 'idle');
  runtime.open();
  assert.equal(last().phase, 'confirming');
  const ok = await runtime.submit(async () => ({ message: 'Email de confirmação enviado com sucesso.', registration: { id: 'r1' } }));
  assert.equal(ok, true);
  assert.equal(last().phase, 'success');
  assert.equal(last().successMessage, 'Email de confirmação enviado com sucesso.');
  assert.equal(last().result?.registration.id, 'r1');
});

test('success is NOT auto-cleared; only acknowledge() returns it to idle', async () => {
  const { runtime, last } = track<{ message: string }>();
  runtime.open();
  await runtime.submit(async () => ({ message: 'ok' }));
  assert.equal(last().phase, 'success');
  runtime.acknowledge();
  assert.equal(last().phase, 'idle');
  assert.equal(last().successMessage, '');
});

test('double-submit is refused while a submit is in flight', async () => {
  const { runtime } = track<{ message: string }>();
  runtime.open();
  let resolve!: (v: { message: string }) => void;
  const gate = new Promise<{ message: string }>((r) => { resolve = r; });
  const first = runtime.submit(() => gate);
  const second = await runtime.submit(async () => ({ message: 'second' }));
  assert.equal(second, false, 'second submit is a guarded no-op');
  resolve({ message: 'first' });
  assert.equal(await first, true);
});

test('failure keeps context and classifies: network', async () => {
  const { runtime, last } = track<{ message: string }>();
  runtime.open();
  const ok = await runtime.submit(async () => { throw new TypeError('Failed to fetch'); });
  assert.equal(ok, false);
  assert.equal(last().phase, 'failure');
  assert.equal(last().error?.kind, 'network');
  assert.equal(last().error?.sessionExpired, false);
});

test('failure classification: 401 is a described session expiry, never silent', async () => {
  const { runtime, last } = track<{ message: string }>();
  runtime.open();
  await runtime.submit(async () => { throw new FakeApiError('nope', { status: 401 }); });
  assert.equal(last().error?.kind, 'unauthorized');
  assert.equal(last().error?.sessionExpired, true);
  assert.match(last().error?.message || '', /sess/i);
});

test('failure classification: 403 / 409 / 502 are distinct and keep the backend message', async () => {
  for (const [status, kind] of [[403, 'forbidden'], [409, 'conflict'], [502, 'server']] as const) {
    const { runtime, last } = track<{ message: string }>();
    runtime.open();
    await runtime.submit(async () => { throw new FakeApiError(`msg-${status}`, { status }); });
    assert.equal(last().error?.kind, kind, `status ${status}`);
    assert.equal(last().error?.sessionExpired, false);
    assert.equal(last().error?.message, `msg-${status}`);
  }
});

test('retry from failure: submit() runs again and can succeed', async () => {
  const { runtime, last } = track<{ message: string }>();
  runtime.open();
  await runtime.submit(async () => { throw new FakeApiError('temporary', { status: 502 }); });
  assert.equal(last().phase, 'failure');
  const ok = await runtime.submit(async () => ({ message: 'recovered' }));
  assert.equal(ok, true);
  assert.equal(last().phase, 'success');
  assert.equal(last().successMessage, 'recovered');
});

test('cancel() and reset() return to idle but never interrupt an in-flight submit', async () => {
  const { runtime, last } = track<{ message: string }>();
  runtime.open();
  runtime.cancel();
  assert.equal(last().phase, 'idle');

  let resolve!: (v: { message: string }) => void;
  const gate = new Promise<{ message: string }>((r) => { resolve = r; });
  const inFlight = runtime.submit(() => gate);
  runtime.cancel();
  runtime.reset();
  assert.equal(runtime.getState().phase, 'submitting', 'still submitting — guards held');
  resolve({ message: 'done' });
  await inFlight;
  assert.equal(last().phase, 'success');
});

test('classifyAdminMutationError: timeout transport code maps to network', () => {
  const classified = classifyAdminMutationError(new FakeApiError('slow', { code: 'timeout' }));
  assert.equal(classified.kind, 'network');
  assert.equal(classified.sessionExpired, false);
});
