import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { validateRegistration } from '../src/lib/validation.js';
import type { CreateRegistrationResponse, RegistrationFormData, RegistrationStatus } from '../src/types/registration';
import {
  attachCheckoutToPaymentInPostgres,
  createPendingRegistrationInPostgres,
  getDatabaseConfigurationIssue,
  getDatabaseRuntimeConfig,
  markPaymentCreationFailedInPostgres,
  pingDatabase,
  transaction,
  usesPostgresDatabase,
  type Database,
  type PartnershipLeadRecord,
  type PartnershipLeadStatus,
  type PaymentRecord,
  type RegistrationRecord,
} from './database.js';
import { getEmailProvider, isEmailConfigured, sendRegistrationConfirmationEmail, sendRegistrationEmail, type RegistrationEmailContext, type RegistrationEmailKind } from './email.js';
import { createInfinitePayCheckout, InfinitePayError } from './infinitepay.js';

const port = Number(process.env.API_PORT || 3001);
const defaultAllowedOrigins = [
  'https://funpace.club',
  'https://www.funpace.club',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];
const allowedOrigins = (process.env.ALLOWED_ORIGINS || defaultAllowedOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const apiPublicUrl = (process.env.API_PUBLIC_URL || appUrl).replace(/\/$/, '');
const paymentProvider = process.env.PAYMENT_PROVIDER || '';
const infinitePayHandle = process.env.INFINITEPAY_HANDLE || process.env.INFINITIPAY_HANDLE || '';
const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || '';
const partnershipWebhookUrl = process.env.PARTNERSHIP_WEBHOOK_URL || '';
const adminApiKey = process.env.ADMIN_API_KEY || 'change-me';
const isProduction = process.env.NODE_ENV === 'production';
const pendingPaymentTtlMinutesInput = Number(process.env.PENDING_PAYMENT_TTL_MINUTES || 30);
const pendingPaymentTtlMinutes = Number.isFinite(pendingPaymentTtlMinutesInput)
  ? Math.max(pendingPaymentTtlMinutesInput, 1)
  : 30;

const rateLimit = new Map<string, { count: number; resetAt: number }>();
const partnershipRateLimit = new Map<string, { count: number; resetAt: number }>();

function setCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'false');
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Webhook-Signature,X-Admin-Key,X-Admin-Actor,X-Request-ID');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Frame-Options', 'DENY');

  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function json(res: ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function createErrorId() {
  return `err_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

function logRequest(req: IncomingMessage, statusCode: number, message: string) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    method: req.method,
    path: req.url?.split('?')[0],
    statusCode,
    requestId: Array.isArray(req.headers['x-request-id']) ? req.headers['x-request-id'][0] : req.headers['x-request-id'],
    message,
  }));
}

function logServerError(req: IncomingMessage, error: unknown, errorId = createErrorId()) {
  console.error(JSON.stringify({
    at: new Date().toISOString(),
    errorId,
    method: req.method,
    path: req.url?.split('?')[0],
    requestId: Array.isArray(req.headers['x-request-id']) ? req.headers['x-request-id'][0] : req.headers['x-request-id'],
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined,
  }));

  return errorId;
}

function csv(res: ServerResponse, filename: string, content: string) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  res.end(content);
}

function isAdminAuthorized(req: IncomingMessage) {
  const key = Array.isArray(req.headers['x-admin-key']) ? req.headers['x-admin-key'][0] : req.headers['x-admin-key'];
  return Boolean(key) && key === adminApiKey;
}

function requireAdmin(req: IncomingMessage, res: ServerResponse) {
  if (isProduction && adminApiKey === 'change-me') {
    json(res, 503, { message: 'Painel administrativo indisponivel. Configure ADMIN_API_KEY.' });
    return false;
  }

  if (isAdminAuthorized(req)) {
    return true;
  }

  json(res, 401, { message: 'Acesso administrativo nao autorizado.' });
  return false;
}

function requireAdminDatabase(res: ServerResponse) {
  const configurationIssue = getDatabaseConfigurationIssue();

  if (configurationIssue) {
    json(res, 503, { message: configurationIssue });
    return false;
  }

  if (!usesPostgresDatabase()) {
    json(res, 503, {
      message: 'Painel administrativo exige banco real Supabase/Postgres. Configure DATABASE_PROVIDER=supabase e DATABASE_URL.',
    });
    return false;
  }

  return true;
}

function getAdminActor(req: IncomingMessage) {
  const actor = Array.isArray(req.headers['x-admin-actor']) ? req.headers['x-admin-actor'][0] : req.headers['x-admin-actor'];
  return actor?.trim() || 'admin';
}

function getClientKey(req: IncomingMessage) {
  const forwardedFor = req.headers['x-forwarded-for'];
  return Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.socket.remoteAddress || 'unknown';
}

function isRateLimited(req: IncomingMessage) {
  const key = getClientKey(req);
  const now = Date.now();
  const bucket = rateLimit.get(key);

  if (!bucket || bucket.resetAt < now) {
    rateLimit.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }

  bucket.count += 1;
  return bucket.count > 30;
}

function isPartnershipRateLimited(req: IncomingMessage) {
  const key = getClientKey(req);
  const now = Date.now();
  const bucket = partnershipRateLimit.get(key);

  if (!bucket || bucket.resetAt < now) {
    partnershipRateLimit.set(key, { count: 1, resetAt: now + 60 * 60_000 });
    return false;
  }

  bucket.count += 1;
  return bucket.count > 5;
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = '';

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');

      if (body.length > 20_000) {
        reject(new Error('Payload muito grande.'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function requireJson(req: IncomingMessage, res: ServerResponse) {
  const contentType = req.headers['content-type'] || '';

  if (Array.isArray(contentType) || !contentType.includes('application/json')) {
    json(res, 415, { message: 'Content-Type deve ser application/json.' });
    return false;
  }

  return true;
}

function parseJsonBody<T>(rawBody: string) {
  try {
    return JSON.parse(rawBody) as T;
  } catch {
    return null;
  }
}

function cpfHash(cpf: string) {
  return createHash('sha256').update(cpf.replace(/\D/g, '')).digest('hex');
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function maskCpf(cpf: string) {
  const digits = onlyDigits(cpf);

  if (digits.length !== 11) {
    return '***.***.***-**';
  }

  return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
}

function getAge(birthDate: string) {
  const date = new Date(`${birthDate}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
    age -= 1;
  }

  return age;
}

function sanitizeRegistration(input: RegistrationFormData): RegistrationFormData {
  return {
    fullName: String(input.fullName || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    cpf: String(input.cpf || '').trim(),
    phone: String(input.phone || '').trim(),
    city: compactText(input.city, 120),
    state: compactText(input.state, 2).toUpperCase(),
    team: compactText(input.team, 120),
    birthDate: String(input.birthDate || '').trim(),
    gender: input.gender || '',
    shirtSize: input.shirtSize || 'M',
    distance: input.distance || '10K',
    emergencyContactName: String(input.emergencyContactName || '').trim(),
    emergencyContactPhone: String(input.emergencyContactPhone || '').trim(),
    termsAccepted: Boolean(input.termsAccepted),
    regulationAccepted: Boolean(input.regulationAccepted),
    privacyAccepted: Boolean(input.privacyAccepted),
  };
}

type PartnershipLeadPayload = {
  companyName?: string;
  contactName?: string;
  contactRole?: string;
  corporateEmail?: string;
  involvementMessage?: string;
  website?: string;
};

function compactText(value: unknown, maxLength: number) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizePartnershipLead(input: PartnershipLeadPayload) {
  return {
    companyName: compactText(input.companyName, 140),
    contactName: compactText(input.contactName, 120),
    contactRole: compactText(input.contactRole, 120),
    corporateEmail: compactText(input.corporateEmail, 180).toLowerCase(),
    involvementMessage: compactText(input.involvementMessage, 2000),
    website: compactText(input.website, 180),
  };
}

function validatePartnershipLead(payload: ReturnType<typeof sanitizePartnershipLead>) {
  const errors: Record<string, string> = {};
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.corporateEmail);

  if (!payload.companyName) {
    errors.companyName = 'Informe o nome da empresa.';
  }

  if (!payload.contactName) {
    errors.contactName = 'Informe o nome do contato.';
  }

  if (!payload.contactRole) {
    errors.contactRole = 'Informe o cargo ou area do contato.';
  }

  if (!emailIsValid) {
    errors.corporateEmail = 'Informe um e-mail corporativo valido.';
  }

  if (payload.involvementMessage.length < 10) {
    errors.involvementMessage = 'Descreva como a empresa gostaria de participar.';
  }

  return errors;
}

function toAdminPartnershipLead(lead: PartnershipLeadRecord) {
  return {
    id: lead.id,
    companyName: lead.companyName,
    contactName: lead.contactName,
    contactRole: lead.contactRole,
    corporateEmail: lead.corporateEmail,
    involvementMessage: lead.involvementMessage,
    status: lead.status,
    source: lead.source,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

async function notifyPartnershipTeam(lead: PartnershipLeadRecord) {
  if (!partnershipWebhookUrl) {
    return;
  }

  try {
    await fetch(partnershipWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'partnership.lead_created',
        lead: toAdminPartnershipLead(lead),
      }),
    });
  } catch (error) {
    console.error(JSON.stringify({
      at: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown partnership notification error',
      message: 'partnership_notification_failed',
    }));
  }
}

function verifyWebhookSignature(rawBody: string, signature: string | undefined) {
  if (!webhookSecret || !signature) {
    return false;
  }

  const expected = createHash('sha256').update(`${rawBody}.${webhookSecret}`).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
}

function getWebhookUrl() {
  const url = new URL('/api/webhooks/payment', apiPublicUrl);

  if (webhookSecret) {
    url.searchParams.set('token', webhookSecret);
  }

  return url.toString();
}

function getRegistrationSuccessUrl(registrationId: string) {
  const url = new URL('/sucesso', appUrl);
  url.searchParams.set('registrationId', registrationId);
  return url.toString();
}

function getRegistrationDescription(distanceName: string, lotName: string) {
  return `Inscricao FunPace Run 2026 - ${distanceName} - ${lotName}`;
}

function getPendingPaymentExpiresAt(createdAt: string) {
  return new Date(new Date(createdAt).getTime() + pendingPaymentTtlMinutes * 60_000).toISOString();
}

function getRegistrationExpiresAt(registration: RegistrationRecord) {
  return registration.expiresAt || getPendingPaymentExpiresAt(registration.createdAt);
}

function releaseRegistrationCapacity(database: Database, registration: RegistrationRecord) {
  const lot = database.lots.find((item) => item.id === registration.lotId);

  if (lot && lot.soldCount > 0) {
    lot.soldCount -= 1;

    if (lot.status === 'sold_out' && lot.soldCount < lot.capacity) {
      lot.status = 'active';
    }
  }
}

function claimRegistrationCapacity(database: Database, registration: RegistrationRecord) {
  const lot = database.lots.find((item) => item.id === registration.lotId);

  if (!lot) {
    return;
  }

  lot.soldCount += 1;

  if (lot.soldCount >= lot.capacity) {
    lot.status = 'sold_out';
  }
}

function expirePendingPayments(database: Database, now = new Date()) {
  let expiredCount = 0;

  for (const registration of database.registrations) {
    if (registration.status !== 'pending_payment') {
      continue;
    }

    const expiresAt = getRegistrationExpiresAt(registration);

    registration.expiresAt = expiresAt;

    if (new Date(expiresAt).getTime() > now.getTime()) {
      continue;
    }

    registration.status = 'expired';
    registration.updatedAt = now.toISOString();
    expiredCount += 1;

    const payment = database.payments.find((item) => item.registrationId === registration.id);

    if (payment) {
      payment.status = 'expired';
      payment.updatedAt = now.toISOString();
      payment.expiresAt = payment.expiresAt || expiresAt;
    }

    releaseRegistrationCapacity(database, registration);
  }

  return expiredCount;
}

function findFirstValue(payload: unknown, keys: string[], depth = 0): unknown {
  if (!payload || typeof payload !== 'object' || depth > 4) {
    return undefined;
  }

  const record = payload as Record<string, unknown>;

  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
      return record[key];
    }
  }

  for (const value of Object.values(record)) {
    const found = findFirstValue(value, keys, depth + 1);

    if (found !== undefined && found !== null && found !== '') {
      return found;
    }
  }

  return undefined;
}

function toStringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value).trim()
    : '';
}

function toNumberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeGatewayAmount(value: unknown) {
  const parsed = toNumberValue(value);

  if (parsed === null) {
    return null;
  }

  return Number.isInteger(parsed) ? parsed : Math.round(parsed * 100);
}

function toPaymentProviderStatus(event: {
  status?: string;
  paid?: boolean;
  amount?: number | string;
  paid_amount?: number | string;
} | null): RegistrationStatus {
  if (!event) {
    return 'pending_payment';
  }

  const status = String(event.status || '').trim().toLowerCase();
  const paidStatuses = new Set(['paid', 'approved', 'confirmed', 'completed', 'captured', 'settled', 'success', 'succeeded']);
  const failedStatuses = new Set(['payment_failed', 'failed', 'declined', 'denied', 'refused', 'rejected']);
  const cancelledStatuses = new Set(['cancelled', 'canceled', 'voided']);

  if (paidStatuses.has(status) || event.paid === true) {
    return 'paid';
  }

  const amount = normalizeGatewayAmount(event.amount);
  const paidAmount = normalizeGatewayAmount(event.paid_amount);

  if (amount !== null && paidAmount !== null && paidAmount >= amount) {
    return 'paid';
  }

  if (cancelledStatuses.has(status)) {
    return 'cancelled';
  }

  if (status === 'refunded') {
    return 'refunded';
  }

  if (status === 'expired') {
    return 'expired';
  }

  if (failedStatuses.has(status)) {
    return 'payment_failed';
  }

  return 'pending_payment';
}

type NormalizedPaymentWebhook = {
  registrationId: string;
  providerEventId: string;
  providerTransactionId: string;
  providerPaymentId: string;
  eventType: string;
  gatewayStatus: string;
  paymentMethod: string;
  amountCents: number | null;
  paidAmountCents: number | null;
  receiptUrl: string;
  nextStatus: RegistrationStatus;
};

function normalizePaymentWebhook(rawEvent: unknown): NormalizedPaymentWebhook | null {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null;
  }

  const registrationId = toStringValue(findFirstValue(rawEvent, [
    'registrationId',
    'registration_id',
    'order_nsu',
    'orderNsu',
    'order_id',
    'orderId',
    'external_id',
    'externalId',
    'reference_id',
    'referenceId',
  ]));
  const providerTransactionId = toStringValue(findFirstValue(rawEvent, [
    'transaction_nsu',
    'transactionNsu',
    'transaction_id',
    'transactionId',
    'transaction_uuid',
    'payment_id',
    'paymentId',
  ]));
  const providerPaymentId = toStringValue(findFirstValue(rawEvent, [
    'invoice_slug',
    'invoiceSlug',
    'slug',
    'checkout_slug',
    'checkoutSlug',
  ]));
  const providerEventId = toStringValue(findFirstValue(rawEvent, [
    'providerEventId',
    'event_id',
    'eventId',
    'id',
  ])) || providerTransactionId || providerPaymentId;
  const eventType = toStringValue(findFirstValue(rawEvent, ['eventType', 'event_type', 'type'])) || 'infinitepay.payment_status_changed';
  const gatewayStatus = toStringValue(findFirstValue(rawEvent, ['status', 'payment_status', 'paymentStatus']));
  const amountCents = normalizeGatewayAmount(findFirstValue(rawEvent, ['amount', 'amount_cents', 'amountCents', 'total_amount']));
  const paidAmountCents = normalizeGatewayAmount(findFirstValue(rawEvent, ['paid_amount', 'paidAmount', 'paid_amount_cents']));
  const paidValue = findFirstValue(rawEvent, ['paid']);
  const paid = paidValue === true || String(paidValue).toLowerCase() === 'true';
  const nextStatus = toPaymentProviderStatus({
    status: gatewayStatus,
    paid,
    amount: amountCents ?? undefined,
    paid_amount: paidAmountCents ?? undefined,
  });

  return {
    registrationId,
    providerEventId,
    providerTransactionId,
    providerPaymentId,
    eventType,
    gatewayStatus,
    paymentMethod: toStringValue(findFirstValue(rawEvent, ['payment_method', 'paymentMethod', 'method', 'payment_type', 'paymentType', 'capture_method'])),
    amountCents,
    paidAmountCents,
    receiptUrl: toStringValue(findFirstValue(rawEvent, ['receipt_url', 'receiptUrl'])),
    nextStatus,
  };
}

type PendingCheckout = CreateRegistrationResponse & {
  statusCode: number;
  amountCents?: number;
  description?: string;
};

async function markPaymentCreationFailed(registrationId: string) {
  if (usesPostgresDatabase()) {
    await markPaymentCreationFailedInPostgres(registrationId);
    return;
  }

  await transaction((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);
    const payment = database.payments.find((item) => item.registrationId === registrationId);
    const now = new Date().toISOString();

    if (registration?.status === 'pending_payment') {
      registration.status = 'payment_failed';
      registration.updatedAt = now;
      releaseRegistrationCapacity(database, registration);
    }

    if (payment) {
      payment.status = 'payment_failed';
      payment.updatedAt = now;
    }
  }, { scope: 'checkout' });
}

async function processRegistrationEmail(kind: RegistrationEmailKind, registrationId: string, options: { force?: boolean } = {}) {
  const provider = getEmailProvider();
  const attemptField = kind === 'pending' ? 'pendingEmailLastAttemptAt' : 'confirmationEmailLastAttemptAt';
  const sentField = kind === 'pending' ? 'pendingEmailSentAt' : 'confirmationEmailSentAt';
  const now = new Date().toISOString();

  if (!isEmailConfigured()) {
    await transaction((database) => {
      const registration = database.registrations.find((item) => item.id === registrationId);

      if (!registration) {
        return;
      }

      database.auditLogs.push({
        id: randomUUID(),
        actor: 'system',
        action: `email.${kind}.skipped`,
        entityType: 'registration',
        entityId: registration.id,
        payload: {
          provider,
          email: registration.payload.email,
          reason: 'email provider not configured',
        },
        createdAt: now,
      });
    }, { scope: 'checkout' });

    console.log(JSON.stringify({
      at: now,
      message: 'registration_email_skipped',
      kind,
      provider,
      registrationId,
      reason: 'email provider not configured',
    }));
    return;
  }

  const context = await transaction<RegistrationEmailContext | null>((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);

    if (!registration) {
      return null;
    }

    if (registration[sentField] && !options.force) {
      return null;
    }

    const event = database.events.find((item) => item.id === registration.eventId);
    const distance = database.distances.find((item) => item.id === registration.distanceId);
    const lot = database.lots.find((item) => item.id === registration.lotId) || null;

    if (!event || !distance) {
      database.auditLogs.push({
        id: randomUUID(),
        actor: 'system',
        action: `email.${kind}.failed`,
        entityType: 'registration',
        entityId: registration.id,
        payload: {
          provider,
          email: registration.payload.email,
          reason: 'registration email context missing',
        },
        createdAt: now,
      });
      return null;
    }

    registration[attemptField] = now;

    database.auditLogs.push({
      id: randomUUID(),
      actor: 'system',
      action: `email.${kind}.attempted`,
      entityType: 'registration',
      entityId: registration.id,
      payload: {
        provider,
        email: registration.payload.email,
      },
      createdAt: now,
    });

    return {
      registration: { ...registration, payload: { ...registration.payload } },
      event: { ...event },
      distanceName: distance.name,
      lot: lot ? { ...lot } : null,
    };
  }, { scope: 'checkout' });

  if (!context) {
    return;
  }

  let result;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      result = kind === 'confirmation'
        ? await sendRegistrationConfirmationEmail(context)
        : await sendRegistrationEmail(kind, context);
    } catch (error) {
      result = {
        ok: false,
        provider,
        error: error instanceof Error ? error.message : 'Unknown email error',
      };
    }

    if (result.ok || attempt === maxAttempts) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }

  const completedAt = new Date().toISOString();

  await transaction((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);

    if (!registration) {
      return;
    }

    if (result.ok) {
      registration[sentField] = completedAt;
    }

    if (kind === 'confirmation') {
      registration.confirmationEmailProvider = result.provider;
      registration.confirmationEmailId = result.ok ? result.providerMessageId || null : registration.confirmationEmailId || null;
      registration.confirmationEmailError = result.ok ? null : result.error || 'Email send failed';
    }

    database.auditLogs.push({
      id: randomUUID(),
      actor: 'system',
      action: result.ok ? `email.${kind}.sent` : `email.${kind}.failed`,
      entityType: 'registration',
      entityId: registration.id,
      payload: {
        provider: result.provider,
        email: registration.payload.email,
        providerMessageId: result.providerMessageId || null,
        error: result.ok ? null : result.error || 'Email send failed',
      },
      createdAt: completedAt,
    });
  }, { scope: 'checkout' });

  console.log(JSON.stringify({
    at: completedAt,
    message: result.ok ? 'registration_email_sent' : 'registration_email_failed',
    kind,
    provider: result.provider,
    registrationId,
    email: context.registration.payload.email,
    providerMessageId: result.providerMessageId,
    error: result.ok ? undefined : result.error,
  }));
}

async function handleCreateRegistration(req: IncomingMessage, res: ServerResponse) {
  if (!requireJson(req, res)) {
    return;
  }

  const databaseConfigurationIssue = getDatabaseConfigurationIssue();

  if (databaseConfigurationIssue) {
    logRequest(req, 503, 'registration_database_not_configured');
    json(res, 503, {
      message: 'Inscricoes temporariamente indisponiveis. Nossa equipe ja foi acionada para concluir a configuracao do banco de dados.',
    });
    return;
  }

  if (isRateLimited(req)) {
    json(res, 429, { message: 'Muitas tentativas. Aguarde um minuto e tente novamente.' });
    return;
  }

  const rawBody = await readBody(req);
  const parsedBody = parseJsonBody<RegistrationFormData>(rawBody);

  if (!parsedBody) {
    json(res, 400, { message: 'JSON invalido.' });
    return;
  }

  const payload = sanitizeRegistration(parsedBody);
  const errors = validateRegistration(payload);

  if (Object.keys(errors).length > 0) {
    json(res, 422, { message: 'Dados de inscricao invalidos.', errors });
    return;
  }

  const hash = cpfHash(payload.cpf);

  const response = usesPostgresDatabase()
    ? await createPendingRegistrationInPostgres({
      payload,
      cpfHash: hash,
      paymentProvider: paymentProvider || 'not_configured',
      expiresAt: getPendingPaymentExpiresAt(new Date().toISOString()),
      description: getRegistrationDescription,
    })
    : await transaction<PendingCheckout>((database) => {
    expirePendingPayments(database);

    const event = database.events.find((item) => item.slug === 'funpace-run-2026' && item.status === 'published');

    if (!event) {
      return {
        statusCode: 409,
        success: false,
        registrationId: '',
        paymentId: null,
        registrationStatus: 'cancelled',
        checkoutStatus: 'not_configured',
        checkoutUrl: null,
        message: 'Evento indisponivel para inscricoes.',
      };
    }

    const distance = database.distances.find((item) => item.eventId === event.id && item.name === payload.distance && item.status === 'active');
    const activeLot = database.lots.find((item) => item.eventId === event.id && item.status === 'active');

    if (!distance || !activeLot) {
      return {
        statusCode: 409,
        success: false,
        registrationId: '',
        paymentId: null,
        registrationStatus: 'cancelled',
        checkoutStatus: 'not_configured',
        checkoutUrl: null,
        message: 'Distancia ou lote indisponivel.',
      };
    }

    const distanceSold = database.registrations.filter((item) => (
      item.distanceId === distance.id && ['pending_payment', 'paid'].includes(item.status)
    )).length;

    if (distanceSold >= distance.capacity || activeLot.soldCount >= activeLot.capacity) {
      activeLot.status = 'sold_out';

      return {
        statusCode: 409,
        success: false,
        registrationId: '',
        paymentId: null,
        registrationStatus: 'cancelled',
        checkoutStatus: 'not_configured',
        checkoutUrl: null,
        message: 'Vagas esgotadas para este lote ou distancia.',
      };
    }

    const existing = database.registrations.find((item) => (
      item.eventId === event.id && item.cpfHash === hash && ['pending_payment', 'paid'].includes(item.status)
    ));

    if (existing) {
      const payment = database.payments.find((item) => item.registrationId === existing.id);
      const response: CreateRegistrationResponse = {
        success: existing.status !== 'paid',
        registrationId: existing.id,
        paymentId: payment?.id || null,
        registrationStatus: existing.status,
        checkoutStatus: payment?.checkoutUrl ? 'created' : 'not_configured',
        checkoutUrl: payment?.checkoutUrl || null,
        expiresAt: existing.expiresAt || null,
        message: existing.status === 'paid'
          ? 'Ja existe uma inscricao paga para este CPF.'
          : 'Ja existe uma inscricao aguardando pagamento para este CPF.',
      };

      return {
        ...response,
        statusCode: existing.status === 'paid' ? 409 : 200,
      };
    }

    const now = new Date().toISOString();
    const expiresAt = getPendingPaymentExpiresAt(now);
    const registration: RegistrationRecord = {
      id: randomUUID(),
      eventId: event.id,
      distanceId: distance.id,
      lotId: activeLot.id,
      cpfHash: hash,
      status: 'pending_payment',
      amountCents: activeLot.priceCents,
      payload,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      paidAt: null,
      confirmedAt: null,
      pendingEmailSentAt: null,
      confirmationEmailSentAt: null,
      pendingEmailLastAttemptAt: null,
      confirmationEmailLastAttemptAt: null,
      confirmationEmailProvider: null,
      confirmationEmailId: null,
      confirmationEmailError: null,
    };
    const payment: PaymentRecord = {
      id: randomUUID(),
      registrationId: registration.id,
      provider: paymentProvider || 'not_configured',
      status: 'pending_payment',
      amountCents: registration.amountCents,
      providerPaymentId: null,
      checkoutUrl: null,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      paidAt: null,
      gatewayStatus: null,
      gatewayTransactionId: null,
      gatewayPayload: null,
    };

    activeLot.soldCount += 1;
    database.registrations.push(registration);
    database.payments.push(payment);

    return {
      statusCode: 201,
      success: true,
      registrationId: registration.id,
      paymentId: payment.id,
      registrationStatus: registration.status,
      checkoutStatus: 'not_configured',
      checkoutUrl: null,
      expiresAt,
      message: paymentProvider === 'infinitepay'
        ? 'Inscricao criada. Redirecionando para o checkout InfinitePay.'
        : 'Inscricao pre-criada. Configure um adaptador de pagamento real para gerar checkout.',
      amountCents: registration.amountCents,
      description: getRegistrationDescription(distance.name, activeLot.name),
    };
  }, { scope: 'checkout' });

  if (
    response.statusCode === 201
    && paymentProvider === 'infinitepay'
    && response.amountCents
    && response.description
  ) {
    if (!infinitePayHandle) {
      await markPaymentCreationFailed(response.registrationId);
      response.statusCode = 503;
      response.success = false;
      response.registrationStatus = 'payment_failed';
      response.checkoutStatus = 'not_configured';
      response.checkoutUrl = null;
      response.message = 'Gateway de pagamento indisponivel. Tente novamente em instantes.';
    } else {
      try {
        const checkout = await createInfinitePayCheckout({
          handle: infinitePayHandle,
          orderNsu: response.registrationId,
          amountCents: response.amountCents,
          description: response.description,
          redirectUrl: getRegistrationSuccessUrl(response.registrationId),
          webhookUrl: getWebhookUrl(),
          customer: payload,
        });

        if (usesPostgresDatabase()) {
          await attachCheckoutToPaymentInPostgres({
            registrationId: response.registrationId,
            providerPaymentId: checkout.providerPaymentId,
            checkoutUrl: checkout.checkoutUrl,
            raw: checkout.raw,
          });
        } else {
          await transaction((database) => {
            const payment = database.payments.find((item) => item.registrationId === response.registrationId);

            if (payment) {
              payment.provider = 'infinitepay';
              payment.providerPaymentId = checkout.providerPaymentId;
              payment.checkoutUrl = checkout.checkoutUrl;
              payment.updatedAt = new Date().toISOString();
            }

            database.paymentEvents.push({
              id: randomUUID(),
              paymentId: payment?.id || '',
              providerEventId: checkout.providerPaymentId || response.registrationId,
              eventType: 'infinitepay.checkout_created',
              payload: checkout.raw,
              receivedAt: new Date().toISOString(),
            });
          }, { scope: 'checkout' });
        }

        response.checkoutStatus = 'created';
        response.checkoutUrl = checkout.checkoutUrl;
      } catch (error) {
        const errorId = logServerError(req, error);
        await markPaymentCreationFailed(response.registrationId);
        response.statusCode = 502;
        response.success = false;
        response.registrationStatus = 'payment_failed';
        response.checkoutStatus = 'not_configured';
        response.checkoutUrl = null;
        response.message = error instanceof InfinitePayError
          ? `Nao foi possivel criar o checkout InfinitePay. Tente novamente em instantes. Codigo: ${errorId}.`
          : `Erro no gateway de pagamento. Tente novamente em instantes. Codigo: ${errorId}.`;
      }
    }
  }

  const { statusCode, amountCents: _amountCents, description: _description, ...payloadResponse } = response;

  if (statusCode === 201 && response.registrationStatus === 'pending_payment' && response.registrationId) {
    processRegistrationEmail('pending', response.registrationId).catch((error) => {
      logServerError(req, error);
    });
  }

  logRequest(req, statusCode, response.registrationId ? 'registration_processed' : 'registration_rejected');
  json(res, statusCode, payloadResponse);
}

async function handleCreatePartnership(req: IncomingMessage, res: ServerResponse) {
  if (!requireJson(req, res)) {
    return;
  }

  const databaseConfigurationIssue = getDatabaseConfigurationIssue();

  if (databaseConfigurationIssue) {
    logRequest(req, 503, 'partnership_database_not_configured');
    json(res, 503, {
      message: 'Envio temporariamente indisponivel. Nossa equipe ja foi acionada para concluir a configuracao do banco de dados.',
    });
    return;
  }

  if (isPartnershipRateLimited(req)) {
    json(res, 429, { message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    return;
  }

  const rawBody = await readBody(req);
  const parsedBody = parseJsonBody<PartnershipLeadPayload>(rawBody);

  if (!parsedBody) {
    json(res, 400, { message: 'JSON invalido.' });
    return;
  }

  const payload = sanitizePartnershipLead(parsedBody);

  if (payload.website) {
    json(res, 201, {
      id: '',
      message: 'Proposta enviada com sucesso. Nossa equipe entrara em contato em breve.',
    });
    return;
  }

  const errors = validatePartnershipLead(payload);

  if (Object.keys(errors).length > 0) {
    json(res, 422, { message: 'Dados da proposta invalidos.', errors });
    return;
  }

  const lead = await transaction<PartnershipLeadRecord>((database) => {
    const now = new Date().toISOString();
    const nextLead: PartnershipLeadRecord = {
      id: randomUUID(),
      companyName: payload.companyName,
      contactName: payload.contactName,
      contactRole: payload.contactRole,
      corporateEmail: payload.corporateEmail,
      involvementMessage: payload.involvementMessage,
      status: 'new',
      source: 'site',
      createdAt: now,
      updatedAt: now,
    };

    database.partnershipLeads.push(nextLead);
    return nextLead;
  });

  await notifyPartnershipTeam(lead);
  logRequest(req, 201, 'partnership_lead_created');
  json(res, 201, {
    id: lead.id,
    message: 'Proposta enviada com sucesso. Nossa equipe entrara em contato em breve.',
  });
}

async function handlePaymentWebhook(req: IncomingMessage, res: ServerResponse) {
  if (!requireJson(req, res)) {
    return;
  }

  const rawBody = await readBody(req);
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const signature = Array.isArray(req.headers['x-webhook-signature'])
    ? req.headers['x-webhook-signature'][0]
    : req.headers['x-webhook-signature'];

  if (webhookSecret && url.searchParams.get('token') !== webhookSecret && !verifyWebhookSignature(rawBody, signature)) {
    json(res, 401, { message: 'Webhook nao autorizado.' });
    return;
  }

  const event = parseJsonBody<unknown>(rawBody);
  const normalizedEvent = normalizePaymentWebhook(event);

  console.log(JSON.stringify({
    at: new Date().toISOString(),
    message: 'payment_webhook_received',
    provider: 'infinitepay',
    path: url.pathname,
    authorizedBy: url.searchParams.get('token') === webhookSecret ? 'token' : signature ? 'signature' : 'none',
    normalized: normalizedEvent,
  }));

  if (!normalizedEvent) {
    json(res, 422, { message: 'Webhook invalido.' });
    return;
  }

  const result = await transaction<{ statusCode: number; payload: unknown; registrationId?: string; nextStatus?: RegistrationStatus }>((database) => {
    expirePendingPayments(database);

    const paymentByGatewayId = database.payments.find((item) => (
      Boolean(normalizedEvent.providerPaymentId) && item.providerPaymentId === normalizedEvent.providerPaymentId
    ) || (
      Boolean(normalizedEvent.providerTransactionId)
      && (item.gatewayTransactionId === normalizedEvent.providerTransactionId || item.providerPaymentId === normalizedEvent.providerTransactionId)
    ));
    const registration = database.registrations.find((item) => (
      Boolean(normalizedEvent.registrationId) && item.id === normalizedEvent.registrationId
    ) || (
      paymentByGatewayId && item.id === paymentByGatewayId.registrationId
    ));

    if (!registration) {
      console.error(JSON.stringify({
        at: new Date().toISOString(),
        message: 'payment_webhook_registration_not_found',
        provider: 'infinitepay',
        registrationId: normalizedEvent.registrationId || null,
        providerPaymentId: normalizedEvent.providerPaymentId || null,
        providerTransactionId: normalizedEvent.providerTransactionId || null,
      }));

      return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    }

    const payment = database.payments.find((item) => item.registrationId === registration.id);
    const now = new Date().toISOString();
    const providerEventId = normalizedEvent.providerEventId || normalizedEvent.providerTransactionId || normalizedEvent.providerPaymentId || '';
    const nextStatus = normalizedEvent.nextStatus;

    if (normalizedEvent.amountCents !== null && normalizedEvent.amountCents !== registration.amountCents) {
      if (payment) {
        payment.gatewayStatus = normalizedEvent.gatewayStatus || 'amount_mismatch';
        payment.gatewayTransactionId = normalizedEvent.providerTransactionId || payment.gatewayTransactionId || null;
        payment.gatewayPayload = event;
        payment.updatedAt = now;
      }
      if (!providerEventId || !database.paymentEvents.some((item) => item.providerEventId === providerEventId)) {
        database.paymentEvents.push({
          id: randomUUID(), paymentId: payment?.id || '', providerEventId: providerEventId || randomUUID(),
          eventType: 'infinitepay.amount_mismatch', payload: event, receivedAt: now,
        });
      }
      database.auditLogs.push({
        id: randomUUID(), actor: 'system', action: 'payment.amount_mismatch', entityType: 'registration', entityId: registration.id,
        payload: { expectedAmountCents: registration.amountCents, receivedAmountCents: normalizedEvent.amountCents, providerEventId: providerEventId || null }, createdAt: now,
      });
      return { statusCode: 400, payload: { message: 'Valor do pagamento divergente.' } };
    }

    const isDuplicatedEvent = Boolean(providerEventId && database.paymentEvents.some((item) => item.providerEventId === providerEventId));

    if (isDuplicatedEvent && !(nextStatus === 'paid' && registration.status !== 'paid')) {
      console.log(JSON.stringify({
        at: now,
        message: 'payment_webhook_duplicate',
        provider: 'infinitepay',
        registrationId: registration.id,
        providerEventId,
        status: registration.status,
      }));

      return { statusCode: 200, payload: { ok: true, duplicated: true }, registrationId: registration.id, nextStatus };
    }

    const previousStatus = registration.status;
    const wasExpired = previousStatus === 'expired';
    const shouldReleaseCapacity = (
      ['pending_payment', 'paid'].includes(previousStatus)
      && ['payment_failed', 'expired', 'cancelled', 'refunded'].includes(nextStatus)
    );

    registration.status = nextStatus;
    registration.updatedAt = now;

    if (nextStatus === 'paid') {
      registration.expiresAt = null;
      registration.paidAt = registration.paidAt || now;
      registration.confirmedAt = registration.confirmedAt || now;

      if (wasExpired) {
        claimRegistrationCapacity(database, registration);
      }
    } else if (shouldReleaseCapacity) {
      releaseRegistrationCapacity(database, registration);
    }

    if (payment) {
      payment.provider = 'infinitepay';
      payment.providerPaymentId = normalizedEvent.providerPaymentId || normalizedEvent.providerTransactionId || payment.providerPaymentId;
      payment.status = nextStatus;
      payment.updatedAt = now;
      payment.paidAt = nextStatus === 'paid' ? payment.paidAt || now : payment.paidAt || null;
      payment.expiresAt = nextStatus === 'paid' ? null : payment.expiresAt;
      payment.gatewayStatus = normalizedEvent.gatewayStatus || nextStatus;
      payment.gatewayTransactionId = normalizedEvent.providerTransactionId || payment.gatewayTransactionId || null;
      payment.gatewayPayload = event;
    }

    if (!isDuplicatedEvent) {
      database.paymentEvents.push({
        id: randomUUID(),
        paymentId: payment?.id || '',
        providerEventId: providerEventId || randomUUID(),
        eventType: normalizedEvent.eventType,
        payload: event,
        receivedAt: now,
      });
    }

    database.auditLogs.push({
      id: randomUUID(),
      actor: 'system',
      action: 'payment.webhook_processed',
      entityType: 'registration',
      entityId: registration.id,
      payload: {
        provider: 'infinitepay',
        providerEventId: providerEventId || null,
        providerPaymentId: normalizedEvent.providerPaymentId || null,
        providerTransactionId: normalizedEvent.providerTransactionId || null,
        previousStatus,
        nextStatus,
      },
      createdAt: now,
    });

    console.log(JSON.stringify({
      at: now,
      message: 'payment_webhook_processed',
      provider: 'infinitepay',
      registrationId: registration.id,
      paymentId: payment?.id || null,
      providerEventId: providerEventId || null,
      providerPaymentId: normalizedEvent.providerPaymentId || null,
      providerTransactionId: normalizedEvent.providerTransactionId || null,
      previousStatus,
      nextStatus,
    }));

    return { statusCode: 200, payload: { ok: true, duplicated: isDuplicatedEvent || undefined }, registrationId: registration.id, nextStatus };
  }, { scope: 'checkout' });

  json(res, result.statusCode, result.payload);

  if (result.statusCode === 200 && result.nextStatus === 'paid' && result.registrationId) {
    await processRegistrationEmail('confirmation', result.registrationId);
  }
}

async function handleGetRegistration(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const id = url.pathname.split('/').at(-1) || '';
  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'registration-status' });
  const registration = database.registrations.find((item) => item.id === id);

  if (!registration) {
    json(res, 404, { message: 'Inscricao nao encontrada.' });
    return;
  }
  const payment = database.payments.find((item) => item.registrationId === registration.id);

  json(res, 200, {
    registrationId: registration.id,
    status: registration.status,
    paymentStatus: payment?.status || registration.status,
    amountCents: registration.amountCents,
    distanceId: registration.distanceId,
    lotId: registration.lotId,
    createdAt: registration.createdAt,
    updatedAt: registration.updatedAt,
    expiresAt: registration.expiresAt || null,
    paidAt: registration.paidAt || null,
    confirmedAt: registration.confirmedAt || null,
    gatewayStatus: payment?.gatewayStatus || null,
    gatewayTransactionId: payment?.gatewayTransactionId || payment?.providerPaymentId || null,
    pendingEmailSentAt: registration.pendingEmailSentAt || null,
    confirmationEmailSentAt: registration.confirmationEmailSentAt || null,
  });
}

async function handleGetAvailability(_req: IncomingMessage, res: ServerResponse) {
  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'availability' });
  const event = database.events.find((item) => item.slug === 'funpace-run-2026');

  if (!event) {
    json(res, 404, { message: 'Evento nao encontrado.' });
    return;
  }

  const lots = database.lots
    .filter((item) => item.eventId === event.id)
    .map((lot) => ({
      id: lot.id,
      name: lot.name,
      priceCents: lot.priceCents,
      capacity: lot.capacity,
      soldCount: lot.soldCount,
      remaining: Math.max(lot.capacity - lot.soldCount, 0),
      status: lot.status,
    }));
  const distances = database.distances
    .filter((item) => item.eventId === event.id)
    .map((distance) => {
      const soldCount = database.registrations.filter((registration) => (
        registration.distanceId === distance.id && ['pending_payment', 'paid'].includes(registration.status)
      )).length;

      return {
        id: distance.id,
        name: distance.name,
        capacity: distance.capacity,
        soldCount,
        remaining: Math.max(distance.capacity - soldCount, 0),
        status: distance.status,
      };
    });

  json(res, 200, { event, lots, distances });
}

async function handleHealth(req: IncomingMessage, res: ServerResponse) {
  const startedAt = Date.now();
  const checks = {
    appUrl: Boolean(appUrl),
    apiPublicUrl: Boolean(apiPublicUrl),
    allowedOrigins,
    databaseProvider: process.env.DATABASE_PROVIDER || 'auto',
    databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
    paymentProvider: paymentProvider || 'not_configured',
    infinitePayHandleConfigured: Boolean(process.env.INFINITEPAY_HANDLE),
    infinitePayLegacyHandleConfigured: Boolean(process.env.INFINITIPAY_HANDLE),
    infinitePayEffectiveHandleConfigured: Boolean(infinitePayHandle),
    webhookSecretConfigured: Boolean(webhookSecret),
    adminApiKeyConfigured: Boolean(adminApiKey && adminApiKey !== 'change-me'),
  };

  try {
    const database = await pingDatabase();

    const statusCode = database.ok ? 200 : 503;

    json(res, statusCode, {
      ok: database.ok,
      service: 'funpace-run-api',
      elapsedMs: Date.now() - startedAt,
      database,
      checks,
      databaseRuntime: getDatabaseRuntimeConfig(),
    });
    logRequest(req, statusCode, database.ok ? 'health_ok' : 'health_database_not_configured');
  } catch (error) {
    const errorId = logServerError(req, error);
    json(res, 503, {
      ok: false,
      service: 'funpace-run-api',
      elapsedMs: Date.now() - startedAt,
      database: { ok: false },
      checks,
      databaseRuntime: getDatabaseRuntimeConfig(),
      message: 'Banco de dados indisponivel.',
      errorId,
    });
  }
}

async function getAdminRows(url: URL) {
  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'admin-registrations' });
  const lotId = url.searchParams.get('lotId') || '';
  const distanceId = url.searchParams.get('distanceId') || '';
  const status = url.searchParams.get('status') || '';
  const query = (url.searchParams.get('q') || '').trim().toLowerCase();

  return database.registrations
    .filter((registration) => !lotId || registration.lotId === lotId)
    .filter((registration) => !distanceId || registration.distanceId === distanceId)
    .filter((registration) => !status || registration.status === status)
    .filter((registration) => {
      if (!query) {
        return true;
      }

      const digitQuery = onlyDigits(query);
      return (
        registration.payload.fullName.toLowerCase().includes(query)
        || registration.payload.email.toLowerCase().includes(query)
        || registration.payload.phone.includes(query)
        || registration.payload.cpf.includes(query)
        || (digitQuery.length > 0 && onlyDigits(registration.payload.cpf).includes(digitQuery))
      );
    })
    .map((registration) => toAdminRow(database, registration))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function toAdminRow(database: Database, registration: RegistrationRecord) {
  const distance = database.distances.find((item) => item.id === registration.distanceId);
  const lot = database.lots.find((item) => item.id === registration.lotId);
  const payment = database.payments.find((item) => item.registrationId === registration.id);
  const checkIn = database.checkIns.find((item) => item.registrationId === registration.id);
  const kitDelivery = database.kitDeliveries.find((item) => item.registrationId === registration.id);
  const paymentEvents = payment ? database.paymentEvents.filter((item) => item.paymentId === payment.id) : [];
  const paymentMethod = toStringValue(findFirstValue(payment?.gatewayPayload, ['payment_method', 'paymentMethod', 'method', 'payment_type', 'paymentType']));
  const hasPaymentDivergence = paymentEvents.some((item) => item.eventType === 'infinitepay.amount_mismatch');

  return {
    id: registration.id,
    fullName: registration.payload.fullName,
    email: registration.payload.email,
    cpfMasked: maskCpf(registration.payload.cpf),
    phone: registration.payload.phone,
    birthDate: registration.payload.birthDate,
    age: getAge(registration.payload.birthDate),
    gender: registration.payload.gender,
    emergencyContactName: registration.payload.emergencyContactName,
    emergencyContactPhone: registration.payload.emergencyContactPhone,
    city: registration.payload.city || null,
    state: registration.payload.state || null,
    team: registration.payload.team || null,
    bibNumber: registration.bibNumber || null,
    checkInStatus: checkIn ? 'checked_in' : 'not_started',
    checkInAt: checkIn?.checkedInAt || null,
    checkInBy: checkIn?.checkedInBy || null,
    kitStatus: kitDelivery ? 'delivered' : 'not_delivered',
    kitDeliveredAt: kitDelivery?.deliveredAt || null,
    kitDeliveredBy: kitDelivery?.deliveredBy || null,
    distance: distance?.name || registration.distanceId,
    distanceId: registration.distanceId,
    lot: lot?.name || registration.lotId,
    lotId: registration.lotId,
    shirtSize: registration.payload.shirtSize,
    status: registration.status,
    paymentStatus: payment?.status || registration.status,
    paymentProvider: payment?.provider || null,
    providerPaymentId: payment?.providerPaymentId || null,
    amountCents: registration.amountCents,
    createdAt: registration.createdAt,
    updatedAt: registration.updatedAt,
    expiresAt: registration.expiresAt || null,
    paidAt: registration.paidAt || payment?.paidAt || null,
    confirmedAt: registration.confirmedAt || null,
    gatewayStatus: payment?.gatewayStatus || null,
    gatewayTransactionId: payment?.gatewayTransactionId || null,
    paymentMethod: paymentMethod || null,
    hasPaymentDivergence,
    pendingEmailSentAt: registration.pendingEmailSentAt || null,
    confirmationEmailSentAt: registration.confirmationEmailSentAt || null,
    confirmationEmailProvider: registration.confirmationEmailProvider || null,
    confirmationEmailId: registration.confirmationEmailId || null,
    confirmationEmailError: registration.confirmationEmailError || null,
  };
}

async function handleAdminPaymentDetails(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  if (!requireAdmin(req, res) || !requireAdminDatabase(res)) return;
  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'admin-registrations' });
  const registration = database.registrations.find((item) => item.id === registrationId);
  const payment = database.payments.find((item) => item.registrationId === registrationId);
  if (!registration || !payment) { json(res, 404, { message: 'Pagamento nao encontrado.' }); return; }
  json(res, 200, {
    payment: toAdminRow(database, registration),
    gatewayPayload: payment.gatewayPayload || null,
    events: database.paymentEvents.filter((item) => item.paymentId === payment.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
  });
}

async function handleAdminPaymentReconcile(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  if (!requireAdmin(req, res) || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const rawBody = await readBody(req);
  const body = parseJsonBody<{ reason?: string }>(rawBody);
  const reason = body?.reason?.trim() || '';
  if (reason.length < 5) { json(res, 400, { message: 'Informe um motivo com pelo menos 5 caracteres.' }); return; }
  const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);
    const payment = database.payments.find((item) => item.registrationId === registrationId);
    if (!registration || !payment) return { statusCode: 404, payload: { message: 'Pagamento nao encontrado.' } };
    const now = new Date().toISOString();
    const previousStatus = registration.status;
    if (['payment_failed', 'expired', 'cancelled', 'refunded'].includes(registration.status)) claimRegistrationCapacity(database, registration);
    registration.status = 'paid'; registration.updatedAt = now; registration.paidAt ||= now; registration.confirmedAt ||= now; registration.expiresAt = null;
    payment.status = 'paid'; payment.gatewayStatus = 'manual_reconciled_paid'; payment.paidAt ||= now; payment.updatedAt = now; payment.expiresAt = null;
    database.auditLogs.push({ id: randomUUID(), actor: 'admin', action: 'payment.manual_reconciled', entityType: 'registration', entityId: registrationId, payload: { reason, previousStatus }, createdAt: now });
    return { statusCode: 200, payload: { registration: toAdminRow(database, registration) } };
  }, { scope: 'checkout' });
  json(res, result.statusCode, result.payload);
  if (result.statusCode === 200) await processRegistrationEmail('confirmation', registrationId);
}

async function handleAdminSummary(req: IncomingMessage, res: ServerResponse) {
  if (!requireAdmin(req, res)) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'admin-registrations' });
  const paid = database.registrations.filter((item) => item.status === 'paid');
  const pending = database.registrations.filter((item) => item.status === 'pending_payment');
  const revenueCents = paid.reduce((total, item) => total + item.amountCents, 0);
  const checkIns = database.checkIns.length;
  const kitDeliveries = database.kitDeliveries.length;
  const byStatus = database.registrations.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const byDistance = database.distances.map((distance) => ({
    id: distance.id,
    name: distance.name,
    capacity: distance.capacity,
    total: database.registrations.filter((registration) => registration.distanceId === distance.id).length,
    paid: database.registrations.filter((registration) => registration.distanceId === distance.id && registration.status === 'paid').length,
  }));
  const lots = database.lots.map((lot) => ({
    id: lot.id,
    name: lot.name,
    capacity: lot.capacity,
    soldCount: lot.soldCount,
    remaining: Math.max(lot.capacity - lot.soldCount, 0),
    priceCents: lot.priceCents,
    status: lot.status,
  }));

  json(res, 200, {
    totals: {
      registrations: database.registrations.length,
      paid: paid.length,
      pending: pending.length,
      revenueCents,
      checkIns,
      kitDeliveries,
    },
    byStatus,
    byDistance,
    lots,
  });
}

type AdminActionRequest = {
  notes?: string;
};

async function handleAdminCheckIn(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  if (!requireAdmin(req, res)) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  if (!requireJson(req, res)) {
    return;
  }

  const rawBody = await readBody(req);
  const payload = parseJsonBody<AdminActionRequest>(rawBody) || {};
  const actor = getAdminActor(req);
  const now = new Date().toISOString();

  const result = await transaction((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);

    if (!registration) {
      return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    }

    if (registration.status !== 'paid') {
      return { statusCode: 409, payload: { message: 'Check-in permitido apenas para inscricoes pagas.' } };
    }

    const existing = database.checkIns.find((item) => item.registrationId === registration.id);

    if (existing) {
      existing.checkedInAt = now;
      existing.checkedInBy = actor;
      existing.notes = payload.notes?.trim() || null;
    } else {
      database.checkIns.push({
        id: randomUUID(),
        registrationId: registration.id,
        status: 'checked_in',
        checkedInAt: now,
        checkedInBy: actor,
        notes: payload.notes?.trim() || null,
      });
    }

    database.auditLogs.push({
      id: randomUUID(),
      actor,
      action: 'registration.check_in',
      entityType: 'registration',
      entityId: registration.id,
      payload: { notes: payload.notes?.trim() || null },
      createdAt: now,
    });

    return { statusCode: 200, payload: { registration: toAdminRow(database, registration) } };
  });

  json(res, result.statusCode, result.payload);
}

async function handleAdminKitDelivery(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  if (!requireAdmin(req, res)) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  if (!requireJson(req, res)) {
    return;
  }

  const rawBody = await readBody(req);
  const payload = parseJsonBody<AdminActionRequest>(rawBody) || {};
  const actor = getAdminActor(req);
  const now = new Date().toISOString();

  const result = await transaction((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);

    if (!registration) {
      return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    }

    if (registration.status !== 'paid') {
      return { statusCode: 409, payload: { message: 'Entrega de kit permitida apenas para inscricoes pagas.' } };
    }

    const existing = database.kitDeliveries.find((item) => item.registrationId === registration.id);

    if (existing) {
      existing.deliveredAt = now;
      existing.deliveredBy = actor;
      existing.notes = payload.notes?.trim() || null;
    } else {
      database.kitDeliveries.push({
        id: randomUUID(),
        registrationId: registration.id,
        status: 'delivered',
        deliveredAt: now,
        deliveredBy: actor,
        notes: payload.notes?.trim() || null,
      });
    }

    database.auditLogs.push({
      id: randomUUID(),
      actor,
      action: 'registration.kit_delivered',
      entityType: 'registration',
      entityId: registration.id,
      payload: { notes: payload.notes?.trim() || null },
      createdAt: now,
    });

    return { statusCode: 200, payload: { registration: toAdminRow(database, registration) } };
  });

  json(res, result.statusCode, result.payload);
}

async function handleAdminRegistrationMaintenance(req: IncomingMessage, res: ServerResponse, registrationId: string, action: string) {
  if (!requireAdmin(req, res) || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const body = parseJsonBody<{ reason?: string }>(await readBody(req)) || {};
  const reason = body.reason?.trim() || '';
  if (['cancel', 'undo-check-in', 'undo-kit'].includes(action) && reason.length < 5) { json(res, 400, { message: 'Informe um motivo com pelo menos 5 caracteres.' }); return; }
  if (action === 'resend-email') {
    const database = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
    const registration = database.registrations.find((item) => item.id === registrationId);
    if (!registration || registration.status !== 'paid') { json(res, 409, { message: 'Reenvio permitido apenas para inscricoes pagas.' }); return; }
    await processRegistrationEmail('confirmation', registrationId, { force: true });
    const refreshed = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
    json(res, 200, { registration: toAdminRow(refreshed, refreshed.registrations.find((item) => item.id === registrationId)!) }); return;
  }
  const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);
    if (!registration) return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    const now = new Date().toISOString(); const actor = getAdminActor(req);
    if (action === 'cancel') {
      if (['cancelled', 'refunded'].includes(registration.status)) return { statusCode: 409, payload: { message: 'Inscricao ja encerrada.' } };
      if (['pending_payment', 'paid'].includes(registration.status)) releaseRegistrationCapacity(database, registration);
      registration.status = 'cancelled'; registration.updatedAt = now;
      const payment = database.payments.find((item) => item.registrationId === registrationId); if (payment) { payment.status = 'cancelled'; payment.updatedAt = now; }
    } else if (action === 'undo-check-in') {
      database.checkIns = database.checkIns.filter((item) => item.registrationId !== registrationId);
    } else if (action === 'undo-kit') {
      database.kitDeliveries = database.kitDeliveries.filter((item) => item.registrationId !== registrationId);
    }
    database.auditLogs.push({ id: randomUUID(), actor, action: `registration.${action}`, entityType: 'registration', entityId: registrationId, payload: { reason }, createdAt: now });
    return { statusCode: 200, payload: { registration: toAdminRow(database, registration) } };
  });
  json(res, result.statusCode, result.payload);
}

async function handleAdminRegistrationUpdate(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  if (!requireAdmin(req, res) || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const body = parseJsonBody<{ reason?: string; changes?: Partial<RegistrationFormData> }>(await readBody(req));
  const reason = body?.reason?.trim() || '';
  if (reason.length < 5) { json(res, 400, { message: 'Informe um motivo com pelo menos 5 caracteres.' }); return; }
  const allowedFields = ['fullName', 'email', 'phone', 'birthDate', 'gender', 'shirtSize', 'emergencyContactName', 'emergencyContactPhone', 'city', 'state', 'team'] as const;
  const changes = body?.changes || {};
  const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);
    if (!registration) return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    const before: Record<string, unknown> = {}; const after: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (changes[field] === undefined) continue;
      let value: unknown = changes[field];
      if (typeof value === 'string') value = compactText(value, field === 'state' ? 2 : 180);
      if (field === 'email') value = String(value).toLowerCase();
      if (field === 'state') value = String(value).toUpperCase();
      if (value === registration.payload[field]) continue;
      before[field] = registration.payload[field]; after[field] = value;
      (registration.payload as unknown as Record<string, unknown>)[field] = value;
    }
    if (!String(registration.payload.fullName).trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registration.payload.email)) return { statusCode: 400, payload: { message: 'Nome e email valido sao obrigatorios.' } };
    if (!['female', 'male'].includes(registration.payload.gender) || !['P', 'M', 'G', 'GG'].includes(registration.payload.shirtSize)) return { statusCode: 400, payload: { message: 'Sexo ou tamanho de camisa invalido.' } };
    if (!Object.keys(after).length) return { statusCode: 400, payload: { message: 'Nenhuma alteracao foi informada.' } };
    const now = new Date().toISOString(); registration.updatedAt = now;
    database.auditLogs.push({ id: randomUUID(), actor: getAdminActor(req), action: 'registration.updated', entityType: 'registration', entityId: registrationId, payload: { reason, before, after }, createdAt: now });
    return { statusCode: 200, payload: { registration: toAdminRow(database, registration) } };
  });
  json(res, result.statusCode, result.payload);
}

async function handleAdminRegistrationDetails(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  if (!requireAdmin(req, res) || !requireAdminDatabase(res)) return;
  const database = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
  const registration = database.registrations.find((item) => item.id === registrationId);
  if (!registration) { json(res, 404, { message: 'Inscricao nao encontrada.' }); return; }
  const payment = database.payments.find((item) => item.registrationId === registrationId);
  json(res, 200, {
    registration: toAdminRow(database, registration),
    auditLogs: database.auditLogs.filter((item) => item.entityId === registrationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    paymentEvents: payment ? database.paymentEvents.filter((item) => item.paymentId === payment.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)) : [],
  });
}

async function handleAdminBibNumber(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  if (!requireAdmin(req, res) || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const body = parseJsonBody<{ bibNumber?: string; reason?: string }>(await readBody(req));
  const bibNumber = compactText(body?.bibNumber, 20).toUpperCase(); const reason = body?.reason?.trim() || '';
  if (!/^[A-Z0-9-]{1,20}$/.test(bibNumber) || reason.length < 5) { json(res, 400, { message: 'Numero de peito invalido ou motivo insuficiente.' }); return; }
  const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);
    if (!registration) return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    if (database.registrations.some((item) => item.eventId === registration.eventId && item.id !== registrationId && item.bibNumber === bibNumber)) return { statusCode: 409, payload: { message: 'Numero de peito ja utilizado neste evento.' } };
    const previous = registration.bibNumber || null; const now = new Date().toISOString(); registration.bibNumber = bibNumber; registration.updatedAt = now;
    database.auditLogs.push({ id: randomUUID(), actor: getAdminActor(req), action: 'registration.bib_assigned', entityType: 'registration', entityId: registrationId, payload: { reason, previous, bibNumber }, createdAt: now });
    return { statusCode: 200, payload: { registration: toAdminRow(database, registration) } };
  });
  json(res, result.statusCode, result.payload);
}

async function handleAdminRegistrations(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!requireAdmin(req, res)) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  const rows = await getAdminRows(url);
  const requestedPage = Math.max(Number.parseInt(url.searchParams.get('page') || '1', 10) || 1, 1);
  const pageSize = url.searchParams.has('pageSize')
    ? Math.min(Math.max(Number.parseInt(url.searchParams.get('pageSize') || '25', 10) || 25, 1), 200)
    : Math.max(rows.length, 1);
  const total = rows.length;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(requestedPage, totalPages);
  json(res, 200, { registrations: rows.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total, totalPages } });
}

async function handleAdminAuditLogs(req: IncomingMessage, res: ServerResponse) {
  if (!requireAdmin(req, res)) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'audit' });
  const logs = database.auditLogs
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);

  json(res, 200, { logs });
}

async function handleAdminPartnerships(req: IncomingMessage, res: ServerResponse) {
  if (!requireAdmin(req, res)) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'partnerships' });
  const partnerships = database.partnershipLeads
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toAdminPartnershipLead);

  json(res, 200, { partnerships });
}

async function handleAdminPartnershipStatus(req: IncomingMessage, res: ServerResponse, partnershipId: string) {
  if (!requireAdmin(req, res)) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  if (!requireJson(req, res)) {
    return;
  }

  const rawBody = await readBody(req);
  const payload = parseJsonBody<{ status?: PartnershipLeadStatus }>(rawBody);
  const allowedStatuses: PartnershipLeadStatus[] = ['new', 'contacted', 'negotiating', 'approved', 'rejected'];
  const nextStatus = payload?.status;

  if (!nextStatus || !allowedStatuses.includes(nextStatus)) {
    json(res, 422, { message: 'Status de parceria invalido.' });
    return;
  }

  const actor = getAdminActor(req);
  const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {
    const lead = database.partnershipLeads.find((item) => item.id === partnershipId);

    if (!lead) {
      return { statusCode: 404, payload: { message: 'Proposta de parceria nao encontrada.' } };
    }

    lead.status = nextStatus;
    lead.updatedAt = new Date().toISOString();

    database.auditLogs.push({
      id: randomUUID(),
      actor,
      action: 'partnership.status_updated',
      entityType: 'partnership',
      entityId: lead.id,
      payload: { status: nextStatus },
      createdAt: new Date().toISOString(),
    });

    return { statusCode: 200, payload: { partnership: toAdminPartnershipLead(lead) } };
  });

  json(res, result.statusCode, result.payload);
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

async function handleAdminRegistrationsCsv(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!requireAdmin(req, res)) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  const rows = await getAdminRows(url);
  const headers = [
    'id',
    'nome',
    'email',
    'cpf',
    'telefone',
    'cidade',
    'estado',
    'equipe',
    'nascimento',
    'idade',
    'sexo',
    'contato_emergencia',
    'telefone_emergencia',
    'distancia',
    'lote',
    'camisa',
    'numero_peito',
    'status',
    'pagamento',
    'provider_pagamento',
    'id_pagamento_provider',
    'status_gateway',
    'transacao_gateway',
    'metodo_pagamento',
    'divergencia_pagamento',
    'check_in',
    'kit',
    'pago_em',
    'confirmado_em',
    'email_confirmacao_enviado_em',
    'email_confirmacao_provider',
    'email_confirmacao_erro',
    'valor',
    'criado_em',
  ];
  const lines = rows.map((row) => [
    row.id,
    row.fullName,
    row.email,
    row.cpfMasked,
    row.phone,
    row.city,
    row.state,
    row.team,
    row.birthDate,
    row.age ?? '',
    row.gender,
    row.emergencyContactName,
    row.emergencyContactPhone,
    row.distance,
    row.lot,
    row.shirtSize,
    row.bibNumber,
    row.status,
    row.paymentStatus,
    row.paymentProvider,
    row.providerPaymentId,
    row.gatewayStatus,
    row.gatewayTransactionId,
    row.paymentMethod,
    row.hasPaymentDivergence ? 'sim' : 'nao',
    row.checkInStatus,
    row.kitStatus,
    row.paidAt,
    row.confirmedAt,
    row.confirmationEmailSentAt,
    row.confirmationEmailProvider,
    row.confirmationEmailError,
    (row.amountCents / 100).toFixed(2),
    row.createdAt,
  ].map(escapeCsv).join(','));

  csv(res, 'funpace-run-inscritos.csv', [headers.join(','), ...lines].join('\n'));
}

async function handleAdminPartnershipsCsv(req: IncomingMessage, res: ServerResponse) {
  if (!requireAdmin(req, res)) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'partnerships' });
  const rows = database.partnershipLeads
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const headers = [
    'id',
    'empresa',
    'contato',
    'cargo',
    'email',
    'mensagem',
    'status',
    'origem',
    'criado_em',
    'atualizado_em',
  ];
  const lines = rows.map((row) => [
    row.id,
    row.companyName,
    row.contactName,
    row.contactRole,
    row.corporateEmail,
    row.involvementMessage,
    row.status,
    row.source,
    row.createdAt,
    row.updatedAt,
  ].map(escapeCsv).join(','));

  csv(res, 'funpace-run-parceiros.csv', [headers.join(','), ...lines].join('\n'));
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      await handleHealth(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/registrations') {
      await handleCreateRegistration(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/partnerships') {
      await handleCreatePartnership(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/registrations/')) {
      await handleGetRegistration(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/availability') {
      await handleGetAvailability(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/summary') {
      await handleAdminSummary(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/registrations') {
      await handleAdminRegistrations(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/registrations.csv') {
      await handleAdminRegistrationsCsv(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/audit-logs') {
      await handleAdminAuditLogs(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/partnerships') {
      await handleAdminPartnerships(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/partnerships.csv') {
      await handleAdminPartnershipsCsv(req, res);
      return;
    }

    const adminPartnershipAction = url.pathname.match(/^\/api\/admin\/partnerships\/([^/]+)\/status$/);

    if (req.method === 'POST' && adminPartnershipAction) {
      await handleAdminPartnershipStatus(req, res, decodeURIComponent(adminPartnershipAction[1]));
      return;
    }

    const adminRegistrationAction = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/(check-in|kit)$/);

    const adminRegistrationMaintenance = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/(cancel|resend-email|undo-check-in|undo-kit)$/);
    if (req.method === 'POST' && adminRegistrationMaintenance) {
      await handleAdminRegistrationMaintenance(req, res, decodeURIComponent(adminRegistrationMaintenance[1]), adminRegistrationMaintenance[2]); return;
    }
    const adminRegistrationUpdate = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)$/);
    if (req.method === 'PATCH' && adminRegistrationUpdate) { await handleAdminRegistrationUpdate(req, res, decodeURIComponent(adminRegistrationUpdate[1])); return; }
    if (req.method === 'GET' && adminRegistrationUpdate) { await handleAdminRegistrationDetails(req, res, decodeURIComponent(adminRegistrationUpdate[1])); return; }
    const adminBibNumber = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/bib-number$/);
    if (req.method === 'POST' && adminBibNumber) { await handleAdminBibNumber(req, res, decodeURIComponent(adminBibNumber[1])); return; }

    const adminPaymentAction = url.pathname.match(/^\/api\/admin\/payments\/([^/]+)(?:\/(reconcile))?$/);
    if (adminPaymentAction) {
      const registrationId = decodeURIComponent(adminPaymentAction[1]);
      if (req.method === 'GET' && !adminPaymentAction[2]) { await handleAdminPaymentDetails(req, res, registrationId); return; }
      if (req.method === 'POST' && adminPaymentAction[2] === 'reconcile') { await handleAdminPaymentReconcile(req, res, registrationId); return; }
    }

    if (req.method === 'POST' && adminRegistrationAction) {
      const registrationId = decodeURIComponent(adminRegistrationAction[1]);

      if (adminRegistrationAction[2] === 'check-in') {
        await handleAdminCheckIn(req, res, registrationId);
        return;
      }

      await handleAdminKitDelivery(req, res, registrationId);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/webhooks/payment') {
      await handlePaymentWebhook(req, res);
      return;
    }

    json(res, 404, { message: 'Rota nao encontrada.' });
  } catch (error) {
    const errorId = logServerError(req, error);
    json(res, 500, {
      message: `Erro interno. Nossa equipe ja foi notificada. Codigo: ${errorId}.`,
      errorId,
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(handleApiRequest).listen(port, () => {
    console.log(`FunPace Run API listening on http://localhost:${port}`);
  });
}
