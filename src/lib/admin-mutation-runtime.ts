// EMAIL-OPS-002 Stage 2 — reusable Admin mutation state machine.
//
// Framework-agnostic (no React, no DOM) so it unit-tests under node:test. The
// React wrapper lives in src/hooks/useAdminMutation.ts. In this release it is
// applied ONLY to the confirmation send/resend action; the wider Admin-mutation
// rollout is ADMIN-UX-RELIABILITY, tracked separately.
//
// Contract (proved by tests/admin-mutation-runtime.test.ts):
//   idle → confirming → submitting → success | failure
//   - while `submitting`, a second submit() is a no-op (double-click / double
//     submit protection);
//   - `success` carries the backend response and is NOT auto-cleared — the
//     caller shows it in-context, then calls acknowledge() which triggers the
//     authoritative refresh + close;
//   - `failure` carries an explicit, classified, in-context message. 401 is a
//     described session-expiry, never a silent logout. 403 / 409 / 5xx / network
//     each get a distinct message. The modal / context is retained on failure.

export type AdminMutationPhase = 'idle' | 'confirming' | 'submitting' | 'success' | 'failure';

export type AdminMutationErrorKind =
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'server'
  | 'client'
  | 'unknown';

export type ClassifiedAdminMutationError = {
  kind: AdminMutationErrorKind;
  status: number | undefined;
  businessCode: string;
  message: string;
  /** true only for `unauthorized` — the caller may route to the session flow
   *  AFTER the operator has read the message. */
  sessionExpired: boolean;
};

type ApiErrorLike = {
  name?: string;
  message?: string;
  status?: number;
  code?: string;
  businessCode?: string;
};

const GENERIC = 'Não foi possível concluir a ação.';

function isApiErrorLike(error: unknown): error is ApiErrorLike {
  return Boolean(error) && typeof error === 'object';
}

export function classifyAdminMutationError(error: unknown): ClassifiedAdminMutationError {
  // A bare fetch rejection (no response) surfaces as TypeError.
  if (error instanceof TypeError) {
    return {
      kind: 'network',
      status: undefined,
      businessCode: '',
      message: 'Sem conexão com o servidor. A ação não foi enviada — verifique a rede e tente novamente.',
      sessionExpired: false,
    };
  }

  const api = isApiErrorLike(error) ? error : {};
  const status = typeof api.status === 'number' ? api.status : undefined;
  const businessCode = typeof api.businessCode === 'string' ? api.businessCode : '';
  const transport = typeof api.code === 'string' ? api.code : '';
  const backendMessage = typeof api.message === 'string' && api.message.trim() ? api.message.trim() : '';

  if (transport === 'timeout') {
    return {
      kind: 'network',
      status,
      businessCode,
      message: 'O servidor demorou a responder. A ação pode não ter sido concluída — recarregue e verifique antes de repetir.',
      sessionExpired: false,
    };
  }
  if (transport === 'network' || transport === 'offline') {
    return {
      kind: 'network',
      status,
      businessCode,
      message: 'Sem conexão com o servidor. A ação não foi enviada — verifique a rede e tente novamente.',
      sessionExpired: false,
    };
  }

  if (status === 401) {
    return {
      kind: 'unauthorized',
      status,
      businessCode,
      message: 'Sua sessão expirou. A ação NÃO foi executada. Entre novamente para continuar.',
      sessionExpired: true,
    };
  }
  if (status === 403) {
    return {
      kind: 'forbidden',
      status,
      businessCode,
      message: backendMessage || 'Seu perfil não tem permissão para executar esta ação.',
      sessionExpired: false,
    };
  }
  if (status === 409) {
    return {
      kind: 'conflict',
      status,
      businessCode,
      message: backendMessage || 'A inscrição mudou de estado. Recarregue e confira antes de repetir a ação.',
      sessionExpired: false,
    };
  }
  if (typeof status === 'number' && status >= 500) {
    return {
      kind: 'server',
      status,
      businessCode,
      message: backendMessage || 'O servidor não conseguiu concluir a ação. Tente novamente em instantes.',
      sessionExpired: false,
    };
  }
  if (typeof status === 'number' && status >= 400) {
    return { kind: 'client', status, businessCode, message: backendMessage || GENERIC, sessionExpired: false };
  }
  return { kind: 'unknown', status, businessCode, message: backendMessage || GENERIC, sessionExpired: false };
}

export type AdminMutationState<T> = {
  phase: AdminMutationPhase;
  /** backend response of the last successful run — shown in-context, not cleared. */
  result: T | null;
  /** backend message string for the success banner ('' when none). */
  successMessage: string;
  /** classified failure ('' phase-guarded via `phase === 'failure'`). */
  error: ClassifiedAdminMutationError | null;
};

export function initialAdminMutationState<T>(): AdminMutationState<T> {
  return { phase: 'idle', result: null, successMessage: '', error: null };
}

/**
 * The controller. `onChange` is invoked with a fresh immutable state on every
 * transition. `extractMessage` pulls the human string out of the success
 * payload (defaults to `payload.message`).
 */
export class AdminMutationRuntime<T> {
  private state: AdminMutationState<T>;

  constructor(
    private readonly onChange: (state: AdminMutationState<T>) => void,
    private readonly extractMessage: (result: T) => string = (result) => {
      const message = (result as { message?: unknown })?.message;
      return typeof message === 'string' ? message : '';
    },
  ) {
    this.state = initialAdminMutationState<T>();
  }

  getState(): AdminMutationState<T> {
    return this.state;
  }

  private set(next: Partial<AdminMutationState<T>>): void {
    this.state = { ...this.state, ...next };
    this.onChange(this.state);
  }

  /** idle/failure/success → confirming. Opens the confirmation step. */
  open(): void {
    if (this.state.phase === 'submitting') return;
    this.set({ phase: 'confirming', error: null });
  }

  /** confirming/failure → idle. Operator dismissed without submitting. */
  cancel(): void {
    if (this.state.phase === 'submitting') return;
    this.set(initialAdminMutationState<T>());
  }

  /**
   * confirming/failure → submitting → success|failure.
   * A call while already `submitting` is ignored (double-submit guard) and
   * returns the in-flight-safe `false`.
   */
  async submit(run: () => Promise<T>): Promise<boolean> {
    if (this.state.phase === 'submitting') return false;
    this.set({ phase: 'submitting', error: null });
    try {
      const result = await run();
      this.set({ phase: 'success', result, successMessage: this.extractMessage(result), error: null });
      return true;
    } catch (error) {
      this.set({ phase: 'failure', error: classifyAdminMutationError(error) });
      return false;
    }
  }

  /** success → idle. Call AFTER the caller has refreshed authoritative state. */
  acknowledge(): void {
    if (this.state.phase !== 'success') return;
    this.set(initialAdminMutationState<T>());
  }

  /** Hard reset from any phase except an in-flight submit. */
  reset(): void {
    if (this.state.phase === 'submitting') return;
    this.set(initialAdminMutationState<T>());
  }
}
