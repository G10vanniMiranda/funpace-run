import type {
  AdminRegistrationsResponse,
  AdminSummaryResponse,
  AvailabilityResponse,
  CreateRegistrationResponse,
  RegistrationFormData,
} from '../types/registration';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

type ApiErrorPayload = {
  message?: string;
  errors?: Record<string, string>;
};

export class ApiError extends Error {
  errors?: Record<string, string>;

  constructor(message: string, errors?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.errors = errors;
  }
}

export async function createRegistration(data: RegistrationFormData) {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}/api/registrations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  } catch {
    throw new ApiError('Nao foi possivel conectar a API de inscricao.');
  }

  const payload = await response.json().catch(() => null) as ApiErrorPayload | CreateRegistrationResponse | null;

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | null;

    throw new ApiError(
      errorPayload?.message || 'Nao foi possivel criar a inscricao.',
      errorPayload?.errors,
    );
  }

  return payload as CreateRegistrationResponse;
}

export async function getAvailability() {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}/api/availability`);
  } catch {
    throw new ApiError('Nao foi possivel carregar a disponibilidade.');
  }

  const payload = await response.json().catch(() => null) as ApiErrorPayload | AvailabilityResponse | null;

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | null;
    throw new ApiError(errorPayload?.message || 'Nao foi possivel carregar a disponibilidade.');
  }

  return payload as AvailabilityResponse;
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

async function adminFetch<ResponsePayload>(path: string, adminKey: string) {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        'X-Admin-Key': adminKey,
      },
    });
  } catch {
    throw new ApiError('Nao foi possivel conectar ao painel administrativo.');
  }

  const payload = await response.json().catch(() => null) as ApiErrorPayload | ResponsePayload | null;

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | null;
    throw new ApiError(errorPayload?.message || 'Acesso administrativo indisponivel.');
  }

  return payload as ResponsePayload;
}

export function getAdminSummary(adminKey: string) {
  return adminFetch<AdminSummaryResponse>('/api/admin/summary', adminKey);
}

export function getAdminRegistrations(adminKey: string, filters: Record<string, string>) {
  return adminFetch<AdminRegistrationsResponse>(`/api/admin/registrations${toQueryString(filters)}`, adminKey);
}

export function getAdminCsvUrl(filters: Record<string, string>) {
  return `${API_BASE_URL}/api/admin/registrations.csv${toQueryString(filters)}`;
}
