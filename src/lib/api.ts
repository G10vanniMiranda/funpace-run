import type {
  AdminAuditLogsResponse,
  AdminPartnershipActionResponse,
  AdminPartnershipsResponse,
  AdminRegistrationsResponse,
  AdminRegistrationActionResponse,
  AdminSummaryResponse,
  AvailabilityResponse,
  CreateRegistrationResponse,
  PartnershipLeadRequest,
  PartnershipLeadResponse,
  RegistrationFormData,
  RegistrationStatusResponse,
} from '../types/registration';

const configuredApiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const API_BASE_URL = configuredApiUrl || (import.meta.env.DEV ? 'http://localhost:3001' : '');
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15_000);
const RETRY_DELAYS_MS = [500, 1000, 2000];
const isDevelopment = import.meta.env.DEV;

type ApiErrorPayload = {
  message?: string;
  errors?: Record<string, string>;
};

type ApiRequestOptions = RequestInit & {
  timeoutMs?: number;
  retry?: boolean;
  sensitive?: boolean;
};

type ApiMetrics = {
  totalRequests: number;
  totalErrors: number;
  consecutiveFailures: number;
  lastStatus: number | null;
  lastDurationMs: number | null;
};

export const apiMetrics: ApiMetrics = {
  totalRequests: 0,
  totalErrors: 0,
  consecutiveFailures: 0,
  lastStatus: null,
  lastDurationMs: null,
};

export class ApiError extends Error {
  status?: number;
  errors?: Record<string, string>;
  code: string;
  retryable: boolean;

  constructor(message: string, options: {
    status?: number;
    errors?: Record<string, string>;
    code?: string;
    retryable?: boolean;
  } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.errors = options.errors;
    this.code = options.code || 'api_error';
    this.retryable = Boolean(options.retryable);
  }
}

function getApiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizePayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const hiddenFields = new Set(['cpf', 'phone', 'email', 'birthDate', 'emergencyContactPhone']);

  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).map(([key, value]) => [
      key,
      hiddenFields.has(key) ? '[redacted]' : value,
    ]),
  );
}

function logApiEvent(label: string, data: Record<string, unknown>) {
  if (!isDevelopment) {
    return;
  }

  console.groupCollapsed(`[FunPace API] ${label}`);
  Object.entries(data).forEach(([key, value]) => console.log(key, value));
  console.groupEnd();
}

function updateMetrics(status: number | null, durationMs: number, failed: boolean) {
  apiMetrics.totalRequests += 1;
  apiMetrics.lastStatus = status;
  apiMetrics.lastDurationMs = durationMs;

  if (failed) {
    apiMetrics.totalErrors += 1;
    apiMetrics.consecutiveFailures += 1;
    return;
  }

  apiMetrics.consecutiveFailures = 0;
}

function getFriendlyHttpError(status: number, payload: ApiErrorPayload | null) {
  const fallback: Record<number, string> = {
    400: 'Os dados enviados sao invalidos.',
    401: 'Sua sessao expirou. Faca login novamente.',
    403: 'Voce nao possui permissao para esta acao.',
    404: 'Servico nao encontrado.',
    409: 'Ja existe uma inscricao ativa para este CPF ou as vagas estao indisponiveis.',
    415: 'Formato da requisicao invalido.',
    422: 'Existem campos invalidos. Confira os dados destacados.',
    429: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    500: 'Erro interno. Nossa equipe ja foi notificada.',
    502: 'Nao foi possivel criar o checkout no gateway. Tente novamente em instantes.',
    503: 'Servico temporariamente indisponivel. Tente novamente em instantes.',
    504: 'A conexao demorou mais do que o esperado. Verifique sua internet.',
  };

  return payload?.message || fallback[status] || 'Nao foi possivel concluir a solicitacao.';
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function parsePayload<ResponsePayload>(response: Response) {
  return response.json().catch(() => null) as Promise<ResponsePayload | ApiErrorPayload | null>;
}

async function apiFetch<ResponsePayload>(path: string, options: ApiRequestOptions = {}) {
  const requestId = createRequestId();
  const url = getApiUrl(path);
  const retryEnabled = options.retry !== false;
  const maxAttempts = retryEnabled ? RETRY_DELAYS_MS.length + 1 : 1;
  const headers = new Headers(options.headers);

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  headers.set('Accept', 'application/json');
  headers.set('X-Request-ID', requestId);

  let lastError: ApiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const startedAt = performance.now();
    const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);

    logApiEvent('request', {
      requestId,
      attempt,
      url,
      method: options.method || 'GET',
      headers: Object.fromEntries(headers.entries()),
      payload: options.sensitive ? '[hidden]' : sanitizePayload(options.body ? JSON.parse(String(options.body)) : null),
    });

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      const durationMs = Math.round(performance.now() - startedAt);
      const payload = await parsePayload<ResponsePayload>(response);

      updateMetrics(response.status, durationMs, !response.ok);
      logApiEvent('response', {
        requestId,
        attempt,
        durationMs,
        status: response.status,
        payload,
        metrics: { ...apiMetrics },
      });

      if (response.ok) {
        return payload as ResponsePayload;
      }

      const errorPayload = payload as ApiErrorPayload | null;
      lastError = new ApiError(getFriendlyHttpError(response.status, errorPayload), {
        status: response.status,
        errors: errorPayload?.errors,
        code: `http_${response.status}`,
        retryable: isRetryableStatus(response.status),
      });

      if (!lastError.retryable || attempt === maxAttempts) {
        throw lastError;
      }
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      const aborted = error instanceof DOMException && error.name === 'AbortError';

      if (error instanceof ApiError) {
        throw error;
      }

      updateMetrics(null, durationMs, true);
      lastError = new ApiError(
        aborted
          ? 'A conexao demorou mais do que o esperado. Verifique sua internet.'
          : 'Nao foi possivel conectar ao servidor. Tente novamente em alguns instantes.',
        {
          code: aborted ? 'timeout' : 'network_error',
          retryable: true,
        },
      );

      logApiEvent('failure', {
        requestId,
        attempt,
        durationMs,
        error: lastError.message,
        metrics: { ...apiMetrics },
      });

      if (attempt === maxAttempts) {
        throw lastError;
      }
    } finally {
      window.clearTimeout(timeout);
    }

    await delay(RETRY_DELAYS_MS[attempt - 1]);
  }

  throw lastError || new ApiError('Nao foi possivel concluir a solicitacao.');
}

export function createRegistration(data: RegistrationFormData) {
  return apiFetch<CreateRegistrationResponse>('/api/registrations', {
    method: 'POST',
    body: JSON.stringify(data),
    retry: true,
  });
}

export function getAvailability() {
  return apiFetch<AvailabilityResponse>('/api/availability', {
    retry: true,
  });
}

export function getRegistrationStatus(registrationId: string) {
  return apiFetch<RegistrationStatusResponse>(`/api/registrations/${encodeURIComponent(registrationId)}`, {
    retry: true,
  });
}

export function createPartnershipLead(data: PartnershipLeadRequest) {
  return apiFetch<PartnershipLeadResponse>('/api/partnerships', {
    method: 'POST',
    body: JSON.stringify(data),
    retry: true,
  });
}

function toQueryString(filters: Record<string, string>) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });

  const query = params.toString();
  return query ? `?${query}` : '';
}

async function adminFetch<ResponsePayload>(path: string, adminKey: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);

  headers.set('X-Admin-Key', adminKey);

  return apiFetch<ResponsePayload>(path, {
    ...init,
    headers,
    retry: true,
    sensitive: true,
  });
}

export function getAdminSummary(adminKey: string) {
  return adminFetch<AdminSummaryResponse>('/api/admin/summary', adminKey);
}

export function getAdminRegistrations(adminKey: string, filters: Record<string, string>) {
  return adminFetch<AdminRegistrationsResponse>(`/api/admin/registrations${toQueryString(filters)}`, adminKey);
}

export function getAdminAuditLogs(adminKey: string) {
  return adminFetch<AdminAuditLogsResponse>('/api/admin/audit-logs', adminKey);
}

export function getAdminCsvUrl(filters: Record<string, string>) {
  return getApiUrl(`/api/admin/registrations.csv${toQueryString(filters)}`);
}

export function getAdminPartnerships(adminKey: string) {
  return adminFetch<AdminPartnershipsResponse>('/api/admin/partnerships', adminKey);
}

export function getAdminPartnershipsCsvUrl() {
  return getApiUrl('/api/admin/partnerships.csv');
}

export function updateAdminPartnershipStatus(adminKey: string, partnershipId: string, status: string) {
  return adminFetch<AdminPartnershipActionResponse>(
    `/api/admin/partnerships/${encodeURIComponent(partnershipId)}/status`,
    adminKey,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    },
  );
}

function postAdminRegistrationAction(adminKey: string, registrationId: string, action: 'check-in' | 'kit') {
  return adminFetch<AdminRegistrationActionResponse>(
    `/api/admin/registrations/${encodeURIComponent(registrationId)}/${action}`,
    adminKey,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
}

export function checkInAdminRegistration(adminKey: string, registrationId: string) {
  return postAdminRegistrationAction(adminKey, registrationId, 'check-in');
}

export function deliverAdminKit(adminKey: string, registrationId: string) {
  return postAdminRegistrationAction(adminKey, registrationId, 'kit');
}
