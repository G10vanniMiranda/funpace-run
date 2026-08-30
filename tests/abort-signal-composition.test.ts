import assert from 'node:assert/strict';
import test from 'node:test';
import { composeAbortSignals } from '../src/lib/abort-signal';

test('composed signal aborts when the CALLER signal aborts', () => {
  const caller = new AbortController();
  const timeout = new AbortController();
  const { signal } = composeAbortSignals([caller.signal, timeout.signal]);
  assert.equal(signal.aborted, false);
  caller.abort();
  assert.equal(signal.aborted, true);
});

test('composed signal aborts when the TIMEOUT signal aborts', () => {
  const caller = new AbortController();
  const timeout = new AbortController();
  const { signal } = composeAbortSignals([caller.signal, timeout.signal]);
  assert.equal(signal.aborted, false);
  timeout.abort();
  assert.equal(signal.aborted, true);
});

test('abort reason is forwarded to the composed signal', () => {
  const caller = new AbortController();
  const reason = new DOMException('boom', 'AbortError');
  const { signal } = composeAbortSignals([caller.signal]);
  caller.abort(reason);
  assert.equal(signal.reason, reason);
});

test('an already-aborted input yields an already-aborted composed signal', () => {
  const caller = new AbortController();
  caller.abort();
  const { signal } = composeAbortSignals([caller.signal]);
  assert.equal(signal.aborted, true);
});

test('cleanup() detaches listeners — a later source abort no longer propagates', () => {
  const caller = new AbortController();
  const { signal, cleanup } = composeAbortSignals([caller.signal]);
  cleanup();
  caller.abort();
  assert.equal(signal.aborted, false);
});

test('cleanup() is idempotent and undefined / null inputs are ignored', () => {
  const caller = new AbortController();
  const composed = composeAbortSignals([undefined, caller.signal, null]);
  composed.cleanup();
  composed.cleanup();
  caller.abort();
  assert.equal(composed.signal.aborted, false);
});

test('with no inputs the composed signal is a plain, un-aborted signal', () => {
  const { signal, cleanup } = composeAbortSignals([]);
  assert.equal(signal.aborted, false);
  cleanup();
});
