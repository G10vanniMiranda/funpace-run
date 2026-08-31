// EMAIL-OPS-002 Stage 2 — thin React wrapper around AdminMutationRuntime.
//
// All state-machine logic lives in the framework-agnostic controller
// (src/lib/admin-mutation-runtime.ts), unit-tested without a DOM. This hook only
// binds the controller to React state and a stable API.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AdminMutationRuntime,
  initialAdminMutationState,
  type AdminMutationState,
} from '../lib/admin-mutation-runtime';

export type UseAdminMutation<T> = {
  state: AdminMutationState<T>;
  /** open the confirmation step */
  open: () => void;
  /** dismiss without submitting */
  cancel: () => void;
  /** run the mutation; resolves true on success, false on failure/guarded */
  submit: (run: () => Promise<T>) => Promise<boolean>;
  /** success → idle, AFTER the caller refreshed authoritative state */
  acknowledge: () => void;
  /** hard reset (ignored while submitting) */
  reset: () => void;
};

export function useAdminMutation<T>(extractMessage?: (result: T) => string): UseAdminMutation<T> {
  const [state, setState] = useState<AdminMutationState<T>>(() => initialAdminMutationState<T>());
  const runtimeRef = useRef<AdminMutationRuntime<T> | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = new AdminMutationRuntime<T>((next) => setState(next), extractMessage);
  }
  const runtime = runtimeRef.current;

  const open = useCallback(() => runtime.open(), [runtime]);
  const cancel = useCallback(() => runtime.cancel(), [runtime]);
  const submit = useCallback((run: () => Promise<T>) => runtime.submit(run), [runtime]);
  const acknowledge = useCallback(() => runtime.acknowledge(), [runtime]);
  const reset = useCallback(() => runtime.reset(), [runtime]);

  return useMemo(
    () => ({ state, open, cancel, submit, acknowledge, reset }),
    [state, open, cancel, submit, acknowledge, reset],
  );
}
