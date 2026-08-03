import type {
  AdminAuditLogsResponse,
  AdminPartnershipActionResponse,
  AdminPartnershipsResponse,
  AdminRegistrationsResponse,
  AdminOperationResponse,
  AdminEventConfig,
  AdminSystemCheckResponse,
  AdminRegistrationActionResponse,
  AdminRegistrationEditable,
  AdminRegistrationDetailsResponse,
  AdminPaymentDetailsResponse,
  AdminPaymentsResponse,
  AdminSummaryResponse,
  AdminReconciliationDashboard,
  AdminExecutiveDashboard,
  AdminAlertsResponse,
  AdminMonitoringResponse,
  AvailabilityResponse,
  CreateRegistrationResponse,
  PartnershipLeadRequest,
  PartnershipLeadResponse,
  RegistrationFormData,
  RegistrationStatus,
  RegistrationStatusResponse,
} from '../types/registration';
import type { AdminPartnerDashboardResponse, AdminPartnerDetailResponse, AdminPartnerResponse, AdminPartnersResponse, PartnerAuditResponse, PartnerDashboardFilters, PartnerInput, PartnerMonitoringResponse, PartnerSlugAvailabilityResponse, PartnerStatus, PublicPartnerSessionResponse } from '../types/partner';

const configuredApiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const configuredLocalApiUrl = (import.meta.env.VITE_API_URL_LOCAL || '').replace(/\/$/, '');
const API_BASE_URL = import.meta.env.DEV
  ? configuredLocalApiUrl || 'http://localhost:3001'
  : configuredApiUrl;
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15_000);
const REGISTRATION_REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_REGISTRATION_TIMEOUT_MS || 120_000);
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
    400: 'Os dados enviados são inválidos.',
    401: 'Sua sessão expirou. Faça login novamente.',
    403: 'Você não possui permissão para esta ação.',
    404: 'Serviço não encontrado.',
    409: 'Já existe uma inscrição ativa para este CPF ou as vagas estão indisponíveis.',
    415: 'Formato da requisição inválido.',
    422: 'Existem campos inválidos. Confira os dados destacados.',
    429: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    500: 'Erro interno. Nossa equipe já foi notificada.',
    502: 'Não foi possível criar o checkout no gateway. Tente novamente em instantes.',
    503: 'Serviço temporariamente indisponível. Tente novamente em instantes.',
    504: 'A conexão demorou mais do que o esperado. Verifique sua internet.',
  };

  return payload?.message || fallback[status] || 'Não foi possível concluir a solicitação.';
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
        credentials: 'include',
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
        code: response.status === 404 && !errorPayload?.message
          ? 'endpoint_not_found'
          : `http_${response.status}`,
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
          ? 'A conexão demorou mais do que o esperado. Verifique sua internet.'
          : 'Não foi possível conectar ao servidor. Tente novamente em alguns instantes.',
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

  throw lastError || new ApiError('Não foi possível concluir a solicitação.');
}

export function createRegistration(data: RegistrationFormData) {
  return apiFetch<CreateRegistrationResponse>('/api/registrations', {
    method: 'POST',
    body: JSON.stringify(data),
    timeoutMs: REGISTRATION_REQUEST_TIMEOUT_MS,
    retry: false,
  });
}

export function updateMarketingConsent(marketing: boolean) {
  return apiFetch<{ ok: true; updated: number; blockedEvents: number }>('/api/privacy/marketing-consent', {
    method: 'PUT',
    body: JSON.stringify({ marketing }),
    retry: false,
    sensitive: true,
  });
}

export function getAvailability() {
  return apiFetch<AvailabilityResponse>('/api/availability', {
    cache: 'no-store',
    retry: true,
  });
}

export function activatePartnerLink(slug: string) {
  return apiFetch<PublicPartnerSessionResponse>(`/api/partners/resolve/${encodeURIComponent(slug)}`, {
    method: 'POST', retry: false,
  });
}

export function getPartnerSession() {
  return apiFetch<PublicPartnerSessionResponse>('/api/partner-session', { cache: 'no-store', retry: false });
}

export function clearPartnerSession() {
  return apiFetch<PublicPartnerSessionResponse>('/api/partner-session', {
    method: 'DELETE', cache: 'no-store', retry: false,
  });
}

export function getRegistrationStatus(registrationId: string) {
  return apiFetch<RegistrationStatusResponse>(`/api/registrations/${encodeURIComponent(registrationId)}`, {
    retry: true,
  });
}

export function confirmInfinitePayReturn(orderNsu: string, transactionNsu: string, slug: string) {
  return apiFetch<{ status: RegistrationStatus }>('/api/payments/confirm', {
    method: 'POST',
    body: JSON.stringify({ orderNsu, transactionNsu, slug }),
    retry: false,
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

async function adminFetch<ResponsePayload>(path: string, adminKey: string, init: ApiRequestOptions = {}) {
  const headers = new Headers(init.headers);

  return apiFetch<ResponsePayload>(path, {
    ...init,
    headers,
    retry: init.retry ?? true,
    sensitive: true,
  });
}

export type AdminSession = { actor: string; role: 'administrator' | 'finance' | 'operation'; expiresAt: string };

export function loginAdmin(email: string, password: string) {
  return apiFetch<AdminSession>('/api/admin/session', { method: 'POST', body: JSON.stringify({ email, password }), sensitive: true, retry: false });
}

export function getAdminSession() {
  return apiFetch<AdminSession>('/api/admin/session', { retry: false });
}

export function logoutAdmin() {
  return apiFetch<{ ok: boolean }>('/api/admin/session', { method: 'DELETE', retry: false });
}

export function getAdminSummary(adminKey: string) {
  return adminFetch<AdminSummaryResponse>('/api/admin/summary', adminKey);
}

export function getAdminReconciliation(adminKey: string) {
  return adminFetch<AdminReconciliationDashboard>('/api/admin/reconciliation', adminKey);
}

export function runAdminReconciliation(adminKey: string, mode: 'dry_run' | 'apply' = 'dry_run') {
  return adminFetch<{ success: boolean; mode: string; checkedCount: number; correctedCount: number; manualReviewRequired: number }>(
    '/api/admin/reconciliation/run', adminKey, { method: 'POST', body: JSON.stringify({ mode }) },
  );
}

export function getAdminExecutiveDashboard(adminKey: string) { return adminFetch<AdminExecutiveDashboard>('/api/admin/executive-dashboard', adminKey); }
export function getAdminAlerts(adminKey: string, filters: Record<string, string> = {}) { return adminFetch<AdminAlertsResponse>(`/api/admin/alerts${toQueryString(filters)}`, adminKey); }
export function updateAdminAlert(adminKey: string, alertId: string, status: 'acknowledged' | 'resolved', resolution: string) {
  return adminFetch<{ alert: import('../types/registration').AdminOperationalAlert }>(`/api/admin/alerts/${encodeURIComponent(alertId)}`, adminKey, { method: 'PATCH', body: JSON.stringify({ status, resolution }) });
}
export function getAdminMonitoring(adminKey: string) { return adminFetch<AdminMonitoringResponse>('/api/admin/monitoring', adminKey); }

export function getAdminRegistrations(adminKey: string, filters: Record<string, string>) {
  return adminFetch<AdminRegistrationsResponse>(`/api/admin/registrations${toQueryString(filters)}`, adminKey);
}

export function getAdminGoogleSheetsStatus(adminKey: string) { return adminFetch<import('../types/registration').AdminGoogleSheetsStatus>('/api/admin/google-sheets/status', adminKey); }
export function retryAdminGoogleSheets(adminKey: string) { return adminFetch<{ queued: number; remaining: number }>('/api/admin/google-sheets/retry', adminKey, { method: 'POST' }); }
export function checkAdminGoogleSheets(adminKey: string) { return adminFetch<{ ok: boolean; createdSheets: string[]; message: string }>('/api/admin/google-sheets/check', adminKey, { method: 'POST' }); }
export function syncAdminRegistrationToGoogleSheets(adminKey: string, registrationId: string) { return adminFetch<{ queued: number }>(`/api/admin/registrations/${encodeURIComponent(registrationId)}/sync-google-sheets`, adminKey, { method: 'POST' }); }

export function getAdminAuditLogs(adminKey: string, filters: Record<string, string> = {}) {
  return adminFetch<AdminAuditLogsResponse>(`/api/admin/audit-logs${toQueryString(filters)}`, adminKey);
}

export function getAdminAuditLogsCsvUrl(filters: Record<string, string>) { return getApiUrl(`/api/admin/audit-logs.csv${toQueryString(filters)}`); }

export function getAdminCsvUrl(filters: Record<string, string>) {
  return getApiUrl(`/api/admin/registrations.csv${toQueryString(filters)}`);
}
export function getAdminReportExportUrl(filters: Record<string, string>, format: 'csv' | 'excel' | 'pdf') { return getApiUrl(`/api/admin/reports/export${toQueryString({ ...filters, format })}`); }

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

export function getAdminPartners(adminKey: string, filters: Record<string, string> = {}) {
  return adminFetch<AdminPartnersResponse>(`/api/admin/partners${toQueryString(filters)}`, adminKey);
}

export function getAdminPartner(adminKey: string, partnerId: string) {
  return adminFetch<AdminPartnerResponse>(`/api/admin/partners/${encodeURIComponent(partnerId)}`, adminKey);
}

export function checkAdminPartnerSlug(adminKey: string, slug: string, excludeId = '') {
  return adminFetch<PartnerSlugAvailabilityResponse>(
    `/api/admin/partners/slug-availability${toQueryString({ slug, excludeId })}`,
    adminKey,
  );
}

export function createAdminPartner(adminKey: string, input: PartnerInput) {
  return adminFetch<AdminPartnerResponse>('/api/admin/partners', adminKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    retry: false,
  });
}

export function updateAdminPartner(adminKey: string, partnerId: string, input: PartnerInput) {
  return adminFetch<AdminPartnerResponse>(`/api/admin/partners/${encodeURIComponent(partnerId)}`, adminKey, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    retry: false,
  });
}

export function updateAdminPartnerStatus(adminKey: string, partnerId: string, status: PartnerStatus) {
  return adminFetch<AdminPartnerResponse>(`/api/admin/partners/${encodeURIComponent(partnerId)}/status`, adminKey, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
    retry: false,
  });
}

export function deleteAdminPartner(adminKey: string, partnerId: string) {
  return adminFetch<{ ok: boolean }>(`/api/admin/partners/${encodeURIComponent(partnerId)}`, adminKey, {
    method: 'DELETE',
    retry: false,
  });
}

export function getAdminPartnerDashboard(adminKey: string, filters: PartnerDashboardFilters & { page?: string; pageSize?: string } = {}) {
  return adminFetch<AdminPartnerDashboardResponse>(`/api/admin/partner-dashboard${toQueryString(filters as Record<string, string>)}`, adminKey);
}

export function getAdminPartnerDashboardDetail(adminKey: string, partnerId: string, filters: PartnerDashboardFilters & { page?: string; pageSize?: string } = {}) {
  return adminFetch<AdminPartnerDetailResponse>(`/api/admin/partner-dashboard/${encodeURIComponent(partnerId)}${toQueryString(filters as Record<string, string>)}`, adminKey);
}

export function getAdminPartnerDashboardExportUrl(filters: PartnerDashboardFilters, format: 'csv' | 'excel') {
  return getApiUrl(`/api/admin/partner-dashboard/export${toQueryString({ ...(filters as Record<string, string>), format })}`);
}

export function getAdminPartnerAudit(adminKey: string, filters: Record<string, string> = {}) {
  return adminFetch<PartnerAuditResponse>(`/api/admin/partner-audit${toQueryString(filters)}`, adminKey);
}

export function getAdminPartnerMonitoring(adminKey: string, page = 1, pageSize = 25, partnerType = '') {
  return adminFetch<PartnerMonitoringResponse>(`/api/admin/partner-monitoring${toQueryString({ page: String(page), pageSize: String(pageSize), partnerType })}`, adminKey);
}

export function runAdminPartnerConsistency(adminKey: string) {
  return adminFetch<{ runId: string; checkedAt: string; issues: number }>('/api/admin/partner-consistency/run', adminKey, { method: 'POST', retry: false });
}

function postAdminRegistrationAction(adminKey: string, registrationId: string, action: 'check-in' | 'kit', notes = '') {
  return adminFetch<AdminRegistrationActionResponse>(
    `/api/admin/registrations/${encodeURIComponent(registrationId)}/${action}`,
    adminKey,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notes }),
    },
  );
}

export function checkInAdminRegistration(adminKey: string, registrationId: string, notes = '') {
  return postAdminRegistrationAction(adminKey, registrationId, 'check-in', notes);
}

export function deliverAdminKit(adminKey: string, registrationId: string, notes = '') {
  return postAdminRegistrationAction(adminKey, registrationId, 'kit', notes);
}

export function getAdminOperation(adminKey: string, filters: Record<string, string>) {
  return adminFetch<AdminOperationResponse>(`/api/admin/operation${toQueryString(filters)}`, adminKey);
}

export function getAdminEventConfig(adminKey: string) { return adminFetch<AdminEventConfig>('/api/admin/event-config', adminKey); }
export function updateAdminEventConfig(adminKey: string, changes: Record<string, unknown>, reason: string) { return adminFetch<{ event: AdminEventConfig['event'] }>('/api/admin/event-config', adminKey, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes, reason }) }); }
export function updateAdminDistance(adminKey: string, distanceId: string, changes: { capacity: number; status: string; reason: string }) { return adminFetch<{ distance: AdminEventConfig['distances'][number] }>(`/api/admin/distances/${encodeURIComponent(distanceId)}`, adminKey, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) }); }
export function updateAdminLot(adminKey: string, lotId: string, changes: { name: string; capacity: number; priceCents: number; status: string; startsAt: string; endsAt: string; reason: string }) { return adminFetch<{ lot: AdminEventConfig['lots'][number] }>(`/api/admin/lots/${encodeURIComponent(lotId)}`, adminKey, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) }); }
export function runAdminSystemCheck(adminKey: string, target: 'email' | 'gateway') { return adminFetch<AdminSystemCheckResponse>(`/api/admin/system-checks/${target}`, adminKey, { method: 'POST' }); }

export function maintainAdminRegistration(adminKey: string, registrationId: string, action: 'cancel' | 'send-email' | 'undo-check-in' | 'undo-kit', reason = '') {
  return adminFetch<AdminRegistrationActionResponse>(`/api/admin/registrations/${encodeURIComponent(registrationId)}/${action}`, adminKey, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }), retry: false,
  });
}

export function updateAdminRegistration(adminKey: string, registrationId: string, changes: AdminRegistrationEditable, reason: string) {
  return adminFetch<AdminRegistrationActionResponse>(`/api/admin/registrations/${encodeURIComponent(registrationId)}`, adminKey, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes, reason }),
  });
}

export function getAdminRegistrationDetails(adminKey: string, registrationId: string) {
  return adminFetch<AdminRegistrationDetailsResponse>(`/api/admin/registrations/${encodeURIComponent(registrationId)}`, adminKey);
}

export function assignAdminBibNumber(adminKey: string, registrationId: string, bibNumber: string, reason: string) {
  return adminFetch<AdminRegistrationActionResponse>(`/api/admin/registrations/${encodeURIComponent(registrationId)}/bib-number`, adminKey, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bibNumber, reason }),
  });
}

export function getAdminPaymentDetails(adminKey: string, registrationId: string) {
  return adminFetch<AdminPaymentDetailsResponse>(`/api/admin/payments/${encodeURIComponent(registrationId)}`, adminKey);
}

export function getAdminPayments(adminKey: string, filters: Record<string, string>) {
  return adminFetch<AdminPaymentsResponse>(`/api/admin/payments${toQueryString(filters)}`, adminKey);
}

export function getAdminPaymentsCsvUrl(filters: Record<string, string>) {
  return getApiUrl(`/api/admin/payments.csv${toQueryString(filters)}`);
}

export function linkAdminOrphanPayment(adminKey: string, eventId: string, registrationId: string, reason: string) {
  return adminFetch<{ ok: boolean }>(`/api/admin/payment-events/${encodeURIComponent(eventId)}/link`, adminKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationId, reason }) });
}

export function reconcileAdminPayment(adminKey: string, registrationId: string, reason: string) {
  return adminFetch<AdminRegistrationActionResponse>(`/api/admin/payments/${encodeURIComponent(registrationId)}/reconcile`, adminKey, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
  });
}
