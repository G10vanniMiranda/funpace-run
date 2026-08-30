// ADMIN-002 Stage 6B — compose several AbortSignals into one.
//
// `apiFetch` needs BOTH its internal 15s timeout signal AND a caller-provided
// signal (used by the Executive Dashboard runtime to cancel a superseded /
// unmounted request) to abort the same fetch. `AbortSignal.any` is not relied
// upon (lib target is ES2022 + DOM, and browser support is only Baseline 2024):
// this is an explicit composition with deterministic listener cleanup so it can
// be unit-tested under node:test without a DOM.

export type ComposedAbort = {
  /** Aborts as soon as ANY input signal aborts (or is already aborted). */
  signal: AbortSignal;
  /** MUST be called once the fetch settles — removes the abort listeners. */
  cleanup: () => void;
};

export function composeAbortSignals(inputs: Array<AbortSignal | undefined | null>): ComposedAbort {
  const controller = new AbortController();
  const signals = inputs.filter((candidate): candidate is AbortSignal => Boolean(candidate));

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const signal of signals) signal.removeEventListener('abort', onAbort);
  };

  const onAbort = (event: Event) => {
    const source = event.target as AbortSignal | null;
    if (!controller.signal.aborted) {
      controller.abort(source?.reason);
    }
    cleanup();
  };

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      cleanup();
      return { signal: controller.signal, cleanup };
    }
  }
  for (const signal of signals) signal.addEventListener('abort', onAbort);

  return { signal: controller.signal, cleanup };
}
