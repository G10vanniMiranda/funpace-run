import assert from 'node:assert/strict';
import test from 'node:test';
import type { AdminEventListItem, AdminExecutiveDashboard } from '../src/types/registration';
import {
  ExecutiveDashboardRuntime,
  classifyDashboardError,
  type ExecutiveDashboardRuntimeState,
} from '../src/lib/executive-dashboard-runtime';

// ADMIN-002 Stage 6B — deterministic runtime tests. node:test only: a fake
// clock, deferred fetch promises, a fake URL and a fake visibility flag. No DOM,
// no React, no new dependency.

const flush = () => new Promise((resolve) => setImmediate(resolve)).then(() => new Promise((resolve) => setImmediate(resolve)));

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

class FakeClock {
  now = 0;
  private seq = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number): number => {
    const id = this.seq++;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  };
  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };
  advance(ms: number): void {
    const target = this.now + ms;
    // fire due timers in chronological order; a timer may schedule another
    for (;;) {
      let nextId = -1;
      let nextAt = Infinity;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && timer.at < nextAt) { nextAt = timer.at; nextId = id; }
      }
      if (nextId === -1) break;
      const timer = this.timers.get(nextId)!;
      this.timers.delete(nextId);
      this.now = timer.at;
      timer.fn();
    }
    this.now = target;
  }
}

type DashCall = { slug: string; signal: AbortSignal; deferred: Deferred<AdminExecutiveDashboard> };
type EventsCall = { signal: AbortSignal; deferred: Deferred<AdminEventListItem[]> };

function mkDash(slug: string, generatedAt = '2026-08-30T10:00:00.000Z', status: 'published' | 'closed' = 'published'): AdminExecutiveDashboard {
  return {
    generatedAt,
    event: { id: slug, slug, name: slug.toUpperCase(), status, date: '2026-09-20' },
  } as unknown as AdminExecutiveDashboard;
}

function mkErr(fields: { status?: number; businessCode?: string; code?: string; message?: string; name?: string }) {
  return { ...fields };
}

function makeHarness(options: { url?: string; visible?: boolean } = {}) {
  const clock = new FakeClock();
  const urlRef = { slug: options.url ?? '' };
  const visibleRef = { value: options.visible ?? true };
  const dash: { calls: DashCall[] } = { calls: [] };
  const events: { calls: EventsCall[] } = { calls: [] };
  const states: ExecutiveDashboardRuntimeState[] = [];
  let sessionExpired = 0;

  const runtime = new ExecutiveDashboardRuntime({
    fetchDashboard: (slug, signal) => {
      const d = deferred<AdminExecutiveDashboard>();
      dash.calls.push({ slug, signal, deferred: d });
      return d.promise;
    },
    fetchEvents: (signal) => {
      const d = deferred<AdminEventListItem[]>();
      events.calls.push({ signal, deferred: d });
      return d.promise;
    },
    readEventSlug: () => urlRef.slug,
    writeEventSlug: (slug) => { urlRef.slug = slug; },
    isVisible: () => visibleRef.value,
    onState: (state) => { states.push(state); },
    onSessionExpired: () => { sessionExpired += 1; },
    now: () => clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    jitter: () => 0,
    pollBaseMs: 60_000,
  });

  return {
    runtime, clock, urlRef, visibleRef, dash, events, states,
    get sessionExpired() { return sessionExpired; },
    setVisible: (value: boolean) => { visibleRef.value = value; },
    lastDash: () => dash.calls[dash.calls.length - 1],
  };
}

// -------------------------------------------------------------------------

test('§43/§56 initial load — one request, canonicalises the URL, no redundant second request', async () => {
  const h = makeHarness();
  h.runtime.start();
  assert.equal(h.dash.calls.length, 1);
  assert.equal(h.dash.calls[0].slug, '');
  assert.equal(h.runtime.getState().phase, 'initial-loading');

  h.dash.calls[0].deferred.resolve(mkDash('funpace-run-2026'));
  await flush();

  const state = h.runtime.getState();
  assert.equal(state.phase, 'ready');
  assert.equal(state.data?.event.slug, 'funpace-run-2026');
  assert.equal(h.urlRef.slug, 'funpace-run-2026');
  assert.equal(h.dash.calls.length, 1); // canonicalisation did NOT fire a second request
});

test('§44/§25 completion-aware polling — exactly one next request after ~60s, never overlapping', async () => {
  const h = makeHarness({ url: 'a' });
  h.runtime.start();
  h.dash.calls[0].deferred.resolve(mkDash('a', 't0'));
  await flush();

  h.clock.advance(59_999);
  assert.equal(h.dash.calls.length, 1);
  h.clock.advance(1);
  assert.equal(h.dash.calls.length, 2);
  assert.equal(h.dash.calls[1].slug, 'a');

  // request #2 still in flight — advancing time must NOT start a third
  h.clock.advance(600_000);
  assert.equal(h.dash.calls.length, 2);

  h.dash.calls[1].deferred.resolve(mkDash('a', 't1'));
  await flush();
  h.clock.advance(60_000);
  assert.equal(h.dash.calls.length, 3);
});

test('§45 background refresh keeps the current data and does not fall back to the skeleton', async () => {
  const h = makeHarness({ url: 'a' });
  h.runtime.start();
  h.dash.calls[0].deferred.resolve(mkDash('a', 't0'));
  await flush();

  h.clock.advance(60_000); // poll #2 starts
  const state = h.runtime.getState();
  assert.equal(state.phase, 'refreshing');
  assert.equal(state.data?.generatedAt, 't0');
});

test('§46 background failure → stale, data preserved, non-blocking, next poll still scheduled', async () => {
  const h = makeHarness({ url: 'a' });
  h.runtime.start();
  h.dash.calls[0].deferred.resolve(mkDash('a', 't0'));
  await flush();

  h.clock.advance(60_000);
  h.dash.calls[1].deferred.reject(mkErr({ status: 500, message: 'Erro interno.' }));
  await flush();

  const state = h.runtime.getState();
  assert.equal(state.phase, 'stale');
  assert.equal(state.data?.generatedAt, 't0');
  assert.equal(state.error, 'Erro interno.');

  h.clock.advance(60_000);
  assert.equal(h.dash.calls.length, 3); // one controlled poll, not a retry storm
});

test('§47 recovery — the next successful poll clears the stale/error state', async () => {
  const h = makeHarness({ url: 'a' });
  h.runtime.start();
  h.dash.calls[0].deferred.resolve(mkDash('a', 't0'));
  await flush();
  h.clock.advance(60_000);
  h.dash.calls[1].deferred.reject(mkErr({ status: 500, message: 'Erro interno.' }));
  await flush();
  h.clock.advance(60_000);
  h.dash.calls[2].deferred.resolve(mkDash('a', 't2'));
  await flush();

  const state = h.runtime.getState();
  assert.equal(state.phase, 'ready');
  assert.equal(state.error, '');
  assert.equal(state.data?.generatedAt, 't2');
});

test('§48/§21/§15 event A→B — a late A response cannot overwrite B, nor rewrite the URL', async () => {
  const h = makeHarness({ url: 'a' });
  h.runtime.start();
  assert.equal(h.dash.calls[0].slug, 'a');

  h.runtime.selectEvent('b');
  assert.equal(h.urlRef.slug, 'b');
  assert.equal(h.dash.calls.length, 2);
  assert.equal(h.dash.calls[1].slug, 'b');
  assert.equal(h.dash.calls[0].signal.aborted, true);

  h.dash.calls[1].deferred.resolve(mkDash('b'));
  await flush();
  assert.equal(h.runtime.getState().data?.event.slug, 'b');

  h.dash.calls[0].deferred.resolve(mkDash('a'));
  await flush();
  const state = h.runtime.getState();
  assert.equal(state.data?.event.slug, 'b');
  assert.equal(state.selectedSlug, 'b');
  assert.equal(h.urlRef.slug, 'b');
});

test('§49/§22 A→B→C resolved in arbitrary order — only C wins', async () => {
  const h = makeHarness({ url: 'a' });
  h.runtime.start();
  h.runtime.selectEvent('b');
  h.runtime.selectEvent('c');
  assert.deepEqual(h.dash.calls.map((call) => call.slug), ['a', 'b', 'c']);

  h.dash.calls[0].deferred.resolve(mkDash('a'));
  await flush();
  h.dash.calls[2].deferred.resolve(mkDash('c'));
  await flush();
  h.dash.calls[1].deferred.resolve(mkDash('b'));
  await flush();

  const state = h.runtime.getState();
  assert.equal(state.data?.event.slug, 'c');
  assert.equal(state.selectedSlug, 'c');
  assert.equal(h.urlRef.slug, 'c');
});

test('§23/§50 unmount — active request aborted + invalidated, no scheduled poll, no late state', async () => {
  const h = makeHarness({ url: 'a' });
  h.runtime.start();
  const first = h.dash.calls[0];

  h.runtime.stop();
  assert.equal(first.signal.aborted, true);

  const statesBefore = h.states.length;
  first.deferred.resolve(mkDash('a'));
  await flush();
  assert.equal(h.states.length, statesBefore); // no state emitted after stop
  assert.equal(h.runtime.getState().phase, 'initial-loading');

  h.clock.advance(600_000);
  assert.equal(h.dash.calls.length, 1); // no scheduled poll survived stop()
});

test('§51 hidden tab — advancing time schedules zero dashboard requests', async () => {
  const h = makeHarness({ url: 'a', visible: false });
  h.runtime.start();
  h.dash.calls[0].deferred.resolve(mkDash('a'));
  await flush();
  assert.equal(h.runtime.getState().phase, 'ready');

  h.clock.advance(600_000);
  assert.equal(h.dash.calls.length, 1);
});

test('§52/§26 visible again — exactly one immediate refresh, then the cadence resumes', async () => {
  const h = makeHarness({ url: 'a', visible: false });
  h.runtime.start();
  h.dash.calls[0].deferred.resolve(mkDash('a', 't0'));
  await flush();
  h.clock.advance(600_000);
  assert.equal(h.dash.calls.length, 1);

  h.clock.advance(5_000); // move the clock past the recover debounce window
  h.setVisible(true);
  h.runtime.handleVisible();
  assert.equal(h.dash.calls.length, 2);

  h.dash.calls[1].deferred.resolve(mkDash('a', 't1'));
  await flush();
  h.clock.advance(60_000);
  assert.equal(h.dash.calls.length, 3);
});

test('§37 online + visibilitychange within the debounce window → a single immediate refresh', async () => {
  const h = makeHarness({ url: 'a' });
  h.runtime.start();
  h.dash.calls[0].deferred.resolve(mkDash('a', 't0'));
  await flush();

  h.clock.advance(1_000); // still within RECOVER_DEBOUNCE_MS of the last request start (t=0)
  h.runtime.handleVisible();
  h.runtime.handleOnline();
  assert.equal(h.dash.calls.length, 1);

  h.clock.advance(2_000); // now outside the debounce window
  h.runtime.handleOnline();
  assert.equal(h.dash.calls.length, 2);
});

test('§53 EVENT_SCOPE_AMBIGUOUS → event-selection-required, no auto-select, no 400 loop', async () => {
  const h = makeHarness();
  h.runtime.start();
  h.events.calls[0].deferred.resolve([
    { id: 'b', slug: 'b', name: 'B', status: 'published', date: '2026-09-20' },
    { id: 'c', slug: 'c', name: 'C', status: 'published', date: '2026-10-20' },
  ]);
  h.dash.calls[0].deferred.reject(mkErr({ status: 400, businessCode: 'EVENT_SCOPE_AMBIGUOUS', message: 'Ha mais de um evento publicado.' }));
  await flush();

  const state = h.runtime.getState();
  assert.equal(state.phase, 'event-selection-required');
  assert.equal(state.selectedSlug, '');
  assert.equal(state.events.length, 2);

  h.clock.advance(600_000);
  assert.equal(h.dash.calls.length, 1); // no repeated ambiguous request
});

test('§54 selecting an event after ambiguity — URL + request + polling resume', async () => {
  const h = makeHarness();
  h.runtime.start();
  h.events.calls[0].deferred.resolve([
    { id: 'b', slug: 'b', name: 'B', status: 'published', date: '2026-09-20' },
    { id: 'c', slug: 'c', name: 'C', status: 'published', date: '2026-10-20' },
  ]);
  h.dash.calls[0].deferred.reject(mkErr({ status: 400, businessCode: 'EVENT_SCOPE_AMBIGUOUS', message: 'ambiguo' }));
  await flush();

  h.runtime.selectEvent('b');
  assert.equal(h.urlRef.slug, 'b');
  const call = h.dash.calls[h.dash.calls.length - 1];
  assert.equal(call.slug, 'b');
  call.deferred.resolve(mkDash('b'));
  await flush();
  assert.equal(h.runtime.getState().phase, 'ready');

  const countAfterSelect = h.dash.calls.length;
  h.clock.advance(60_000);
  assert.equal(h.dash.calls.length, countAfterSelect + 1);
});

test('§55 EVENT_NOT_FOUND (invalid slug in the URL) → recoverable selection, no loop', async () => {
  const h = makeHarness({ url: 'bogus' });
  h.runtime.start();
  h.events.calls[0].deferred.resolve([{ id: 'b', slug: 'b', name: 'B', status: 'published', date: '2026-09-20' }]);
  h.dash.calls[0].deferred.reject(mkErr({ status: 400, businessCode: 'EVENT_NOT_FOUND', message: 'Evento nao encontrado.' }));
  await flush();

  assert.equal(h.runtime.getState().phase, 'event-selection-required');
  h.clock.advance(600_000);
  assert.equal(h.dash.calls.length, 1);
});

test('§57 explicit closed event stays selected and keeps polling — no fallback to published', async () => {
  const h = makeHarness({ url: 'closed-x' });
  h.runtime.start();
  assert.equal(h.dash.calls[0].slug, 'closed-x');
  h.dash.calls[0].deferred.resolve(mkDash('closed-x', 't0', 'closed'));
  await flush();
  assert.equal(h.runtime.getState().phase, 'ready');
  assert.equal(h.runtime.getState().data?.event.status, 'closed');

  h.clock.advance(60_000);
  assert.equal(h.dash.calls[1].slug, 'closed-x');
});

test('§58 401 → session-expired callback once, polling stops', async () => {
  const h = makeHarness({ url: 'a' });
  h.runtime.start();
  h.dash.calls[0].deferred.reject(mkErr({ status: 401, message: 'Acesso administrativo nao autorizado.' }));
  await flush();

  assert.equal(h.sessionExpired, 1);
  h.clock.advance(600_000);
  assert.equal(h.dash.calls.length, 1);
});

test('§59 403 → NOT a logout; blocking initial error while there is no data', async () => {
  const h = makeHarness({ url: 'a' });
  h.runtime.start();
  h.dash.calls[0].deferred.reject(mkErr({ status: 403, message: 'Seu perfil nao possui permissao.' }));
  await flush();

  assert.equal(h.sessionExpired, 0);
  assert.equal(h.runtime.getState().phase, 'initial-error');
});

test('§62 a superseded/aborted request is expected control flow — no error, no stale, no logout', async () => {
  const h = makeHarness({ url: 'a' });
  h.runtime.start();
  h.dash.calls[0].deferred.resolve(mkDash('a', 't0'));
  await flush();

  h.clock.advance(60_000); // poll #2 in flight
  h.runtime.refreshNow(); // supersedes poll #2
  assert.equal(h.dash.calls[1].signal.aborted, true);

  h.dash.calls[1].deferred.reject(mkErr({ name: 'AbortError', message: 'aborted' }));
  await flush();

  const state = h.runtime.getState();
  assert.notEqual(state.phase, 'stale');
  assert.equal(state.error, '');
  assert.equal(h.sessionExpired, 0);
});

test('classifyDashboardError maps status / business code / abort', () => {
  assert.deepEqual(classifyDashboardError({ status: 400, businessCode: 'EVENT_NOT_FOUND', message: 'x' }), {
    status: 400, code: 'EVENT_NOT_FOUND', message: 'x', isAbort: false,
  });
  assert.equal(classifyDashboardError({ name: 'AbortError' }).isAbort, true);
  assert.equal(classifyDashboardError({ code: 'aborted' }).isAbort, true);
  assert.equal(classifyDashboardError({ status: 500 }).code, '');
  assert.equal(classifyDashboardError(null).message.length > 0, true);
});
