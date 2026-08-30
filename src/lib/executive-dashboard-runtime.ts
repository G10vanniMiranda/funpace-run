// ADMIN-002 Stage 6B — Executive Dashboard runtime controller.
//
// Framework-agnostic (no React, no `../lib/api` — so it imports cleanly under
// node:test). The React wrapper lives in `src/hooks/useExecutiveDashboardRuntime.ts`.
//
// Guarantees (proved by tests/executive-dashboard-runtime.test.ts):
//   - completion-aware polling: the next poll is scheduled only after the
//     current request settles; no self-overlap; bounded jitter around 60s.
//   - latest-wins: every request carries a generation; a stale response can
//     NEVER mutate data / error / phase / selected event / URL. AbortController
//     reduces wasted work; the generation guard is the correctness boundary.
//   - visibility: no scheduled poll while hidden; one immediate refresh when
//     it becomes visible again (or when the browser reconnects).
//   - event scope: EVENT_SCOPE_AMBIGUOUS / EVENT_NOT_FOUND / NO_PUBLISHED_EVENT
//     put the runtime in `event-selection-required` and STOP polling — no 400
//     loop, no arbitrary auto-selection. The events list is loaded for recovery.
//   - 401 → canonical session-expired callback + stop. 403 is not a logout.
//   - a superseded/aborted request is expected control flow: no error, no
//     stale warning, no logout.

import type { AdminEventListItem, AdminExecutiveDashboard } from '../types/registration';

export type ExecutiveDashboardPhase =
  | 'initial-loading'
  | 'ready'
  | 'refreshing'
  | 'stale'
  | 'initial-error'
  | 'event-selection-required';

export type ExecutiveDashboardRuntimeState = {
  phase: ExecutiveDashboardPhase;
  data: AdminExecutiveDashboard | null;
  /** The event slug in the URL / chosen by the operator. '' = none chosen. */
  selectedSlug: string;
  events: AdminEventListItem[];
  eventsError: string;
  /** Human message for the banner / blocking screen. '' when none. */
  error: string;
  /** Backend business code (EVENT_SCOPE_*) or http_* or ''. */
  errorCode: string;
  /** `generatedAt` of the last dashboard that loaded successfully. */
  lastGeneratedAt: string | null;
};

export const EVENT_SELECTION_CODES = ['EVENT_SCOPE_AMBIGUOUS', 'EVENT_NOT_FOUND', 'NO_PUBLISHED_EVENT'];

const DEFAULT_POLL_BASE_MS = 60_000;
const DEFAULT_POLL_JITTER_MS = 5_000;
const RECOVER_DEBOUNCE_MS = 2_000;
const GENERIC_ERROR = 'Não foi possível carregar o dashboard executivo.';

export type ClassifiedDashboardError = {
  status: number | undefined;
  /** business code when the backend sent one, else the transport code, else ''. */
  code: string;
  message: string;
  isAbort: boolean;
};

export function classifyDashboardError(error: unknown): ClassifiedDashboardError {
  const candidate = (error ?? {}) as {
    status?: unknown; code?: unknown; businessCode?: unknown; message?: unknown; name?: unknown;
  };
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const transportCode = typeof candidate.code === 'string' ? candidate.code : '';
  const businessCode = typeof candidate.businessCode === 'string' ? candidate.businessCode : '';
  return {
    status: typeof candidate.status === 'number' ? candidate.status : undefined,
    code: businessCode || transportCode,
    message: typeof candidate.message === 'string' && candidate.message ? candidate.message : GENERIC_ERROR,
    isAbort: name === 'AbortError' || transportCode === 'aborted',
  };
}

export type ExecutiveDashboardRuntimeDeps = {
  fetchDashboard: (slug: string, signal: AbortSignal) => Promise<AdminExecutiveDashboard>;
  fetchEvents: (signal: AbortSignal) => Promise<AdminEventListItem[]>;
  readEventSlug: () => string;
  writeEventSlug: (slug: string) => void;
  isVisible: () => boolean;
  onState: (state: ExecutiveDashboardRuntimeState) => void;
  onSessionExpired: () => void;
  now?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /** deterministic in tests; returns a ms offset, typically in [-jitter, +jitter]. */
  jitter?: () => number;
  pollBaseMs?: number;
  pollJitterMs?: number;
};

export class ExecutiveDashboardRuntime {
  private readonly deps: ExecutiveDashboardRuntimeDeps;
  private readonly now: () => number;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;
  private readonly jitter: () => number;
  private readonly pollBaseMs: number;

  private state: ExecutiveDashboardRuntimeState = {
    phase: 'initial-loading',
    data: null,
    selectedSlug: '',
    events: [],
    eventsError: '',
    error: '',
    errorCode: '',
    lastGeneratedAt: null,
  };

  private generation = 0;
  private dashAbort: AbortController | null = null;
  private eventsAbort: AbortController | null = null;
  private pollHandle: unknown = null;
  private stopped = false;
  private lastRequestStartedAt = 0;

  constructor(deps: ExecutiveDashboardRuntimeDeps) {
    this.deps = deps;
    this.now = deps.now || (() => Date.now());
    this.setTimeoutFn = deps.setTimeoutFn || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = deps.clearTimeoutFn || ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const jitterAmplitude = deps.pollJitterMs ?? DEFAULT_POLL_JITTER_MS;
    this.jitter = deps.jitter || (() => (Math.random() * 2 - 1) * jitterAmplitude);
    this.pollBaseMs = deps.pollBaseMs ?? DEFAULT_POLL_BASE_MS;
  }

  getState(): ExecutiveDashboardRuntimeState {
    return this.state;
  }

  start(): void {
    this.stopped = false;
    this.state = { ...this.state, selectedSlug: this.deps.readEventSlug() };
    this.loadEvents();
    this.runRequest();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.generation += 1; // invalidate any in-flight / late settle
    this.clearPoll();
    this.dashAbort?.abort();
    this.dashAbort = null;
    this.eventsAbort?.abort();
    this.eventsAbort = null;
  }

  selectEvent(slug: string): void {
    if (this.stopped) return;
    if (slug === this.state.selectedSlug && this.state.phase !== 'event-selection-required') {
      this.refreshNow();
      return;
    }
    this.deps.writeEventSlug(slug);
    this.setState({
      selectedSlug: slug,
      error: '',
      errorCode: '',
      phase: this.state.data ? 'refreshing' : 'initial-loading',
    });
    this.runRequest();
  }

  refreshNow(): void {
    if (this.stopped || this.state.phase === 'event-selection-required') return;
    this.runRequest();
  }

  retryEvents(): void {
    if (this.stopped) return;
    this.loadEvents();
  }

  handleHidden(): void {
    this.clearPoll();
  }

  handleVisible(): void {
    if (this.stopped) return;
    if (this.state.phase === 'event-selection-required') {
      if (!this.state.events.length) this.retryEvents();
      return;
    }
    this.recover();
  }

  handleOnline(): void {
    if (this.stopped || !this.deps.isVisible()) return;
    if (this.state.phase === 'event-selection-required') {
      if (!this.state.events.length) this.retryEvents();
      return;
    }
    this.recover();
  }

  // --- internals -----------------------------------------------------------

  private setState(patch: Partial<ExecutiveDashboardRuntimeState>): void {
    this.state = { ...this.state, ...patch };
    this.deps.onState(this.state);
  }

  private recover(): void {
    // §37 — at most one immediate refresh even if `visibilitychange` and
    // `online` both fire.
    if (this.now() - this.lastRequestStartedAt < RECOVER_DEBOUNCE_MS) return;
    this.runRequest();
  }

  private clearPoll(): void {
    if (this.pollHandle != null) {
      this.clearTimeoutFn(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private scheduleNextPoll(): void {
    this.clearPoll();
    if (this.stopped || this.state.phase === 'event-selection-required') return;
    if (!this.deps.isVisible()) return; // resumed by handleVisible()
    const delay = Math.max(1_000, this.pollBaseMs + this.jitter());
    this.pollHandle = this.setTimeoutFn(() => {
      this.pollHandle = null;
      this.runRequest();
    }, delay);
  }

  private loadEvents(): void {
    this.eventsAbort?.abort();
    const controller = new AbortController();
    this.eventsAbort = controller;
    void this.deps.fetchEvents(controller.signal).then(
      (events) => {
        if (controller.signal.aborted || this.stopped) return;
        this.setState({ events, eventsError: '' });
      },
      (error) => {
        if (controller.signal.aborted || this.stopped) return;
        const classified = classifyDashboardError(error);
        if (classified.isAbort) return;
        if (classified.status === 401) {
          this.stop();
          this.deps.onSessionExpired();
          return;
        }
        this.setState({ eventsError: classified.message || 'Não foi possível carregar a lista de eventos.' });
      },
    );
  }

  private runRequest(): void {
    this.clearPoll();
    if (this.stopped || this.state.phase === 'event-selection-required') return;

    this.dashAbort?.abort();
    const controller = new AbortController();
    this.dashAbort = controller;
    const myGeneration = (this.generation += 1);
    const slug = this.state.selectedSlug;
    this.lastRequestStartedAt = this.now();
    this.setState({ phase: this.state.data ? 'refreshing' : 'initial-loading' });

    void this.deps.fetchDashboard(slug, controller.signal).then(
      (dashboard) => this.onDashboardSuccess(myGeneration, dashboard),
      (error) => this.onDashboardError(myGeneration, error),
    );
  }

  private onDashboardSuccess(myGeneration: number, dashboard: AdminExecutiveDashboard): void {
    if (this.stopped || myGeneration !== this.generation) return; // superseded

    const patch: Partial<ExecutiveDashboardRuntimeState> = {
      phase: 'ready',
      data: dashboard,
      error: '',
      errorCode: '',
      lastGeneratedAt: dashboard.generatedAt,
    };

    // §14/§18 — canonicalise the URL to the resolved slug (single published
    // event opened without ?event=). This is state + URL only; it does NOT
    // trigger a second request.
    const canonical = dashboard.event?.slug || '';
    if (canonical && canonical !== this.deps.readEventSlug()) {
      this.deps.writeEventSlug(canonical);
      patch.selectedSlug = canonical;
    }

    this.setState(patch);
    this.scheduleNextPoll();
  }

  private onDashboardError(myGeneration: number, error: unknown): void {
    if (this.stopped || myGeneration !== this.generation) return; // superseded / aborted — control flow

    const classified = classifyDashboardError(error);
    if (classified.isAbort) return;

    if (classified.status === 401) {
      this.stop();
      this.deps.onSessionExpired();
      return;
    }

    if (EVENT_SELECTION_CODES.indexOf(classified.code) !== -1) {
      this.setState({
        phase: 'event-selection-required',
        error: classified.message,
        errorCode: classified.code,
      });
      if (!this.state.events.length && !this.state.eventsError) this.loadEvents();
      return; // NO next poll — wait for an explicit human selection
    }

    // 403 / 500 / network / timeout / anything else — keep the last snapshot.
    this.setState({
      phase: this.state.data ? 'stale' : 'initial-error',
      error: classified.message,
      errorCode: classified.code || (classified.status ? `http_${classified.status}` : 'error'),
    });
    this.scheduleNextPoll(); // one controlled poll; no retry storm
  }
}
