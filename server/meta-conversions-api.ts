import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

export type MetaEventName = 'InitiateCheckout' | 'CompleteRegistration' | 'Purchase';

export interface MetaUserData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  ge?: string[];
  ct?: string[];
  st?: string[];
  country?: string[];
  external_id?: string[];
  client_ip_address?: string;
  client_user_agent?: string;
  fbc?: string;
  fbp?: string;
}

export interface MetaCustomData {
  currency: 'BRL';
  value: number;
  content_name: string;
  content_ids: string[];
  content_type: 'product';
  num_items?: number;
  order_id?: string;
  status?: boolean;
}

export interface MetaServerEvent {
  event_name: MetaEventName;
  event_time: number;
  event_source_url: string;
  action_source: 'website';
  event_id: string;
  user_data: MetaUserData;
  custom_data: MetaCustomData;
}

export interface MetaConversionsApiPayload {
  data: MetaServerEvent[];
  test_event_code?: string;
}

export interface MetaConversionsApiResponse {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
  error?: {
    code?: number;
    type?: string;
    message?: string;
    error_subcode?: number;
  };
}

export interface MetaIdentityInput {
  email?: string;
  phone?: string;
  fullName?: string;
  gender?: string;
  city?: string;
  state?: string;
  country?: string;
  externalId?: string;
}

export interface MetaClientContext {
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbc?: string;
  fbp?: string;
}

export type MetaSendResult =
  | { ok: true; eventsReceived: number; httpStatus: number; durationMs: number }
  | {
    ok: false;
    retryable: boolean;
    errorCode: string;
    httpStatus: number | null;
    durationMs: number;
  };

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const EVENT_ID_PATTERN = /^(?:initiate_checkout|complete_registration|purchase)_[A-Za-z0-9_-]{1,160}$/;
const META_COOKIE_PATTERN = /^fb\.1\.\d{10,13}\.[A-Za-z0-9._-]{1,180}$/;
const DEFAULT_TIMEOUT_MS = 3500;

function clampInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

export function getMetaCapiConfig() {
  const pixelId = (process.env.META_PIXEL_ID || '').trim();
  const accessToken = (process.env.META_CONVERSIONS_API_TOKEN || '').trim();
  const graphApiVersion = (process.env.META_GRAPH_API_VERSION || '').trim();
  const testEventCode = (process.env.META_TEST_EVENT_CODE || '').trim();

  return {
    enabled: process.env.META_CAPI_ENABLED === 'true',
    pixelId: /^\d+$/.test(pixelId) ? pixelId : '',
    accessToken,
    graphApiVersion: /^v\d+\.\d+$/.test(graphApiVersion) ? graphApiVersion : '',
    testEventCode: /^[A-Za-z0-9_-]{1,100}$/.test(testEventCode) ? testEventCode : '',
    timeoutMs: clampInteger(process.env.META_CAPI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 10_000),
    maxAttempts: clampInteger(process.env.META_CAPI_MAX_ATTEMPTS, 5, 1, 10),
  };
}

export function isMetaCapiReady() {
  const config = getMetaCapiConfig();
  return config.enabled && Boolean(config.pixelId && config.accessToken && config.graphApiVersion);
}

export function normalizeEmail(value: string | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.length <= 254
    ? normalized
    : undefined;
}

export function normalizeBrazilianPhone(value: string | undefined) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!digits.startsWith('55') || (digits.length !== 12 && digits.length !== 13)) return undefined;
  return digits;
}

export function normalizeMetaText(value: string | undefined) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
  return normalized || undefined;
}

export function normalizeMetaState(value: string | undefined) {
  const normalized = normalizeMetaText(value);
  return normalized?.length === 2 ? normalized : undefined;
}

export function normalizeMetaGender(value: string | undefined) {
  if (value === 'female' || value === 'f') return 'f';
  if (value === 'male' || value === 'm') return 'm';
  return undefined;
}

export function sha256Normalized(value: string | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) return undefined;
  if (SHA256_PATTERN.test(normalized)) return normalized.toLowerCase();
  return createHash('sha256').update(normalized).digest('hex');
}

function hashedArray(value: string | undefined) {
  const hash = sha256Normalized(value);
  return hash ? [hash] : undefined;
}

function splitName(fullName: string | undefined) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.at(-1) : undefined,
  };
}

export function sanitizeMetaCookie(value: string | undefined) {
  const normalized = String(value || '').trim();
  return normalized.length <= 255 && META_COOKIE_PATTERN.test(normalized) ? normalized : undefined;
}

export function buildMetaUserData(identity: MetaIdentityInput, context: MetaClientContext = {}): MetaUserData {
  const { firstName, lastName } = splitName(identity.fullName);
  const email = normalizeEmail(identity.email);
  const phone = normalizeBrazilianPhone(identity.phone);
  const city = normalizeMetaText(identity.city);
  const state = normalizeMetaState(identity.state);
  const country = normalizeMetaText(identity.country || 'br');
  const gender = normalizeMetaGender(identity.gender);
  const externalId = String(identity.externalId || '').trim();
  const clientIpAddress = validatePublicIp(context.clientIpAddress);
  const clientUserAgent = sanitizeUserAgent(context.clientUserAgent);
  const fbc = sanitizeMetaCookie(context.fbc);
  const fbp = sanitizeMetaCookie(context.fbp);

  return {
    ...(hashedArray(email) ? { em: hashedArray(email) } : {}),
    ...(hashedArray(phone) ? { ph: hashedArray(phone) } : {}),
    ...(hashedArray(normalizeMetaText(firstName)) ? { fn: hashedArray(normalizeMetaText(firstName)) } : {}),
    ...(hashedArray(normalizeMetaText(lastName)) ? { ln: hashedArray(normalizeMetaText(lastName)) } : {}),
    ...(hashedArray(gender) ? { ge: hashedArray(gender) } : {}),
    ...(hashedArray(city) ? { ct: hashedArray(city) } : {}),
    ...(hashedArray(state) ? { st: hashedArray(state) } : {}),
    ...(hashedArray(country) ? { country: hashedArray(country) } : {}),
    ...(hashedArray(externalId) ? { external_id: hashedArray(externalId) } : {}),
    ...(clientIpAddress ? { client_ip_address: clientIpAddress } : {}),
    ...(clientUserAgent ? { client_user_agent: clientUserAgent } : {}),
    ...(fbc ? { fbc } : {}),
    ...(fbp ? { fbp } : {}),
  };
}

export function validateMetaEventId(eventName: MetaEventName, eventId: string) {
  const prefixes: Record<MetaEventName, string> = {
    InitiateCheckout: 'initiate_checkout_',
    CompleteRegistration: 'complete_registration_',
    Purchase: 'purchase_',
  };
  return EVENT_ID_PATTERN.test(eventId) && eventId.startsWith(prefixes[eventName]);
}

export function normalizeEventTime(value: number | string | Date) {
  const seconds = value instanceof Date
    ? Math.floor(value.getTime() / 1000)
    : typeof value === 'string'
      ? Math.floor(new Date(value).getTime() / 1000)
      : Math.floor(value);
  const now = Math.floor(Date.now() / 1000);
  return Number.isFinite(seconds) && seconds <= now + 300 && seconds >= now - (7 * 24 * 60 * 60)
    ? seconds
    : undefined;
}

export function normalizeMetaSourceUrl(rawUrl: string | undefined, fallbackPath: string) {
  const appUrl = new URL(process.env.APP_URL || 'http://localhost:3000');
  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS || `${appUrl.origin},https://funpace.club,https://www.funpace.club`)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  try {
    const candidate = new URL(String(rawUrl || ''), appUrl);
    if (!allowedOrigins.has(candidate.origin)) throw new Error('origin_not_allowed');
    return `${candidate.origin}${candidate.pathname}`;
  } catch {
    return new URL(fallbackPath, appUrl).toString();
  }
}

export function buildMetaServerEvent(input: {
  eventName: MetaEventName;
  eventId: string;
  eventTime: number | string | Date;
  eventSourceUrl: string;
  userData: MetaUserData;
  customData: MetaCustomData;
}): MetaServerEvent {
  if (!validateMetaEventId(input.eventName, input.eventId)) throw new Error('meta_invalid_event_id');
  const eventTime = normalizeEventTime(input.eventTime);
  if (!eventTime) throw new Error('meta_invalid_event_time');
  if (!Number.isFinite(input.customData.value) || input.customData.value < 0) throw new Error('meta_invalid_value');
  if (input.customData.currency !== 'BRL') throw new Error('meta_invalid_currency');
  if (!input.customData.content_ids.length || input.customData.content_ids.some((id) => !id || id.length > 160)) {
    throw new Error('meta_invalid_content_ids');
  }

  return {
    event_name: input.eventName,
    event_time: eventTime,
    event_source_url: input.eventSourceUrl,
    action_source: 'website',
    event_id: input.eventId,
    user_data: input.userData,
    custom_data: input.customData,
  };
}

export function buildMetaConversionsPayload(event: MetaServerEvent): MetaConversionsApiPayload {
  const testEventCode = getMetaCapiConfig().testEventCode;
  return {
    data: [event],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
}

export async function sendMetaServerEvent(
  event: MetaServerEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaSendResult> {
  const config = getMetaCapiConfig();
  const startedAt = Date.now();

  if (!config.enabled) {
    return { ok: false, retryable: false, errorCode: 'META_DISABLED', httpStatus: null, durationMs: 0 };
  }
  if (!config.pixelId || !config.accessToken || !config.graphApiVersion) {
    return { ok: false, retryable: false, errorCode: 'META_NOT_CONFIGURED', httpStatus: null, durationMs: 0 };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(
      `https://graph.facebook.com/${config.graphApiVersion}/${config.pixelId}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildMetaConversionsPayload(event)),
        signal: controller.signal,
      },
    );
  } catch (error) {
    const errorCode = error instanceof Error && error.name === 'AbortError'
      ? 'META_TIMEOUT'
      : 'META_NETWORK_ERROR';
    return {
      ok: false,
      retryable: true,
      errorCode,
      httpStatus: null,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }

  let payload: MetaConversionsApiResponse;
  try {
    payload = await response.json() as MetaConversionsApiResponse;
  } catch {
    return {
      ok: false,
      retryable: response.status === 429 || response.status >= 500,
      errorCode: 'META_INVALID_RESPONSE',
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
    };
  }

  if (response.ok && Number(payload.events_received) > 0) {
    return {
      ok: true,
      eventsReceived: Number(payload.events_received),
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    ok: false,
    retryable: response.status === 429 || response.status >= 500,
    errorCode: payload.error?.code ? `META_${payload.error.code}` : 'META_EVENT_REJECTED',
    httpStatus: response.status,
    durationMs: Date.now() - startedAt,
  };
}

export function sanitizeUserAgent(value: string | undefined | null) {
  const normalized = String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return normalized ? normalized.slice(0, 500) : undefined;
}

function isPrivateIpv4(ip: string) {
  const parts = ip.split('.').map(Number);
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || a === 0;
}

export function validatePublicIp(value: string | undefined | null) {
  const rawCandidate = String(value || '').trim().replace(/^\[|\]$/g, '');
  const candidate = rawCandidate.toLowerCase().startsWith('::ffff:')
    ? rawCandidate.slice(7)
    : rawCandidate;
  const version = isIP(candidate);
  if (!version) return undefined;
  if (version === 4 && isPrivateIpv4(candidate)) return undefined;
  const lower = candidate.toLowerCase();
  if (version === 6 && (
    lower === '::1'
    || lower.startsWith('fc')
    || lower.startsWith('fd')
    || lower.startsWith('fe8')
    || lower.startsWith('fe9')
    || lower.startsWith('fea')
    || lower.startsWith('feb')
  )) return undefined;
  return candidate;
}

export function extractPublicClientIp(req: IncomingMessage) {
  const forwarded = req.headers['x-forwarded-for'];
  const chain = (Array.isArray(forwarded) ? forwarded : [forwarded])
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  const vercelIp = req.headers['x-vercel-forwarded-for'];
  if (typeof vercelIp === 'string') chain.push(...vercelIp.split(',').map((value) => value.trim()));
  if (req.socket.remoteAddress) chain.push(req.socket.remoteAddress);
  return chain.map(validatePublicIp).find(Boolean);
}

export function getMetaClientContext(req: IncomingMessage, input?: {
  fbp?: string;
  fbc?: string;
}): MetaClientContext {
  const clientIpAddress = extractPublicClientIp(req);
  const clientUserAgent = sanitizeUserAgent(req.headers['user-agent'] as string | undefined);
  const fbc = sanitizeMetaCookie(input?.fbc);
  const fbp = sanitizeMetaCookie(input?.fbp);
  return {
    ...(clientIpAddress ? { clientIpAddress } : {}),
    ...(clientUserAgent ? { clientUserAgent } : {}),
    ...(fbc ? { fbc } : {}),
    ...(fbp ? { fbp } : {}),
  };
}
