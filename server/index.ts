import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { validateRegistration } from '../src/lib/validation.js';
import type { CreateRegistrationResponse, RegistrationFormData, RegistrationStatus } from '../src/types/registration';
import { pingDatabase, transaction, type Database, type PartnershipLeadRecord, type PartnershipLeadStatus, type PaymentRecord, type RegistrationRecord } from './database.js';
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

function toPaymentProviderStatus(status: unknown): RegistrationStatus {
  if (status === 'paid' || status === true) {
    return 'paid';
  }

  if (status === 'cancelled' || status === 'refunded' || status === 'expired') {
    return status;
  }

  if (status === 'payment_failed') {
    return 'payment_failed';
  }

  return 'pending_payment';
}

type PendingCheckout = CreateRegistrationResponse & {
  statusCode: number;
  amountCents?: number;
  description?: string;
};

async function markPaymentCreationFailed(registrationId: string) {
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
  });
}

async function handleCreateRegistration(req: IncomingMessage, res: ServerResponse) {
  if (!requireJson(req, res)) {
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

  const response = await transaction<PendingCheckout>((database) => {
    expirePendingPayments(database);

    const event = database.events.find((item) => item.slug === 'funpace-run-2026' && item.status === 'published');

    if (!event) {
      return {
        statusCode: 409,
        registrationId: '',
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
        registrationId: '',
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
        registrationId: '',
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
        registrationId: existing.id,
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
    };

    activeLot.soldCount += 1;
    database.registrations.push(registration);
    database.payments.push(payment);

    return {
      statusCode: 201,
      registrationId: registration.id,
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
  });

  if (
    response.statusCode === 201
    && paymentProvider === 'infinitepay'
    && response.amountCents
    && response.description
  ) {
    if (!infinitePayHandle) {
      await markPaymentCreationFailed(response.registrationId);
      response.statusCode = 503;
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
        });

        response.checkoutStatus = 'created';
        response.checkoutUrl = checkout.checkoutUrl;
      } catch (error) {
        const errorId = logServerError(req, error);
        await markPaymentCreationFailed(response.registrationId);
        response.statusCode = 502;
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
  logRequest(req, statusCode, response.registrationId ? 'registration_processed' : 'registration_rejected');
  json(res, statusCode, payloadResponse);
}

async function handleCreatePartnership(req: IncomingMessage, res: ServerResponse) {
  if (!requireJson(req, res)) {
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

  const event = parseJsonBody<{
    registrationId?: string;
    status?: RegistrationStatus;
    providerEventId?: string;
    eventType?: string;
    order_nsu?: string;
    transaction_nsu?: string;
    invoice_slug?: string;
    slug?: string;
    amount?: number;
    paid_amount?: number;
    paid?: boolean;
    capture_method?: string;
    receipt_url?: string;
  }>(rawBody);

  const registrationId = event?.registrationId || event?.order_nsu || '';
  const nextStatus = toPaymentProviderStatus(event?.status || event?.paid);

  if (!registrationId || !event) {
    json(res, 422, { message: 'Webhook invalido.' });
    return;
  }

  const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {
    expirePendingPayments(database);

    const registration = database.registrations.find((item) => item.id === registrationId);

    if (!registration) {
      return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    }

    const payment = database.payments.find((item) => item.registrationId === registration.id);
    const now = new Date().toISOString();
    const providerEventId = event.providerEventId || event.transaction_nsu || event.invoice_slug || event.slug || '';

    if (typeof event.amount === 'number' && event.amount !== registration.amountCents) {
      return { statusCode: 400, payload: { message: 'Valor do pagamento divergente.' } };
    }

    if (providerEventId && database.paymentEvents.some((item) => item.providerEventId === providerEventId)) {
      return { statusCode: 200, payload: { ok: true, duplicated: true } };
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

      if (wasExpired) {
        claimRegistrationCapacity(database, registration);
      }
    } else if (shouldReleaseCapacity) {
      releaseRegistrationCapacity(database, registration);
    }

    if (payment) {
      payment.provider = 'infinitepay';
      payment.providerPaymentId = event.transaction_nsu || event.invoice_slug || event.slug || payment.providerPaymentId;
      payment.status = nextStatus;
      payment.updatedAt = now;
      payment.expiresAt = nextStatus === 'paid' ? null : payment.expiresAt;
    }

    database.paymentEvents.push({
      id: randomUUID(),
      paymentId: payment?.id || '',
      providerEventId: providerEventId || randomUUID(),
      eventType: event.eventType || 'infinitepay.payment_status_changed',
      payload: event,
      receivedAt: now,
    });

    return { statusCode: 200, payload: { ok: true } };
  });

  json(res, result.statusCode, result.payload);
}

async function handleGetRegistration(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const id = url.pathname.split('/').at(-1) || '';
  const database = await transaction((currentDatabase) => {
    expirePendingPayments(currentDatabase);
    return currentDatabase;
  });
  const registration = database.registrations.find((item) => item.id === id);

  if (!registration) {
    json(res, 404, { message: 'Inscricao nao encontrada.' });
    return;
  }

  json(res, 200, {
    registrationId: registration.id,
    status: registration.status,
    amountCents: registration.amountCents,
    distanceId: registration.distanceId,
    lotId: registration.lotId,
    createdAt: registration.createdAt,
    updatedAt: registration.updatedAt,
    expiresAt: registration.expiresAt || null,
  });
}

async function handleGetAvailability(_req: IncomingMessage, res: ServerResponse) {
  const database = await transaction((currentDatabase) => {
    expirePendingPayments(currentDatabase);
    return currentDatabase;
  });
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

    json(res, 200, {
      ok: true,
      service: 'funpace-run-api',
      elapsedMs: Date.now() - startedAt,
      database,
      checks,
    });
    logRequest(req, 200, 'health_ok');
  } catch (error) {
    const errorId = logServerError(req, error);
    json(res, 503, {
      ok: false,
      service: 'funpace-run-api',
      elapsedMs: Date.now() - startedAt,
      database: { ok: false },
      checks,
      message: 'Banco de dados indisponivel.',
      errorId,
    });
  }
}

async function getAdminRows(url: URL) {
  const database = await transaction((currentDatabase) => {
    expirePendingPayments(currentDatabase);
    return currentDatabase;
  });
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

      return (
        registration.payload.fullName.toLowerCase().includes(query)
        || registration.payload.email.toLowerCase().includes(query)
        || registration.payload.phone.includes(query)
        || registration.payload.cpf.includes(query)
        || onlyDigits(registration.payload.cpf).includes(onlyDigits(query))
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
    city: null,
    state: null,
    team: null,
    bibNumber: null,
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
    amountCents: registration.amountCents,
    createdAt: registration.createdAt,
    expiresAt: registration.expiresAt || null,
  };
}

async function handleAdminSummary(req: IncomingMessage, res: ServerResponse) {
  if (!requireAdmin(req, res)) {
    return;
  }

  const database = await transaction((currentDatabase) => {
    expirePendingPayments(currentDatabase);
    return currentDatabase;
  });
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

async function handleAdminRegistrations(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!requireAdmin(req, res)) {
    return;
  }

  json(res, 200, { registrations: await getAdminRows(url) });
}

async function handleAdminAuditLogs(req: IncomingMessage, res: ServerResponse) {
  if (!requireAdmin(req, res)) {
    return;
  }

  const database = await transaction((currentDatabase) => {
    expirePendingPayments(currentDatabase);
    return currentDatabase;
  });
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

  const database = await transaction((currentDatabase) => currentDatabase);
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

  const rows = await getAdminRows(url);
  const headers = [
    'id',
    'nome',
    'email',
    'cpf',
    'telefone',
    'nascimento',
    'idade',
    'sexo',
    'contato_emergencia',
    'telefone_emergencia',
    'distancia',
    'lote',
    'camisa',
    'status',
    'pagamento',
    'check_in',
    'kit',
    'valor',
    'criado_em',
  ];
  const lines = rows.map((row) => [
    row.id,
    row.fullName,
    row.email,
    row.cpfMasked,
    row.phone,
    row.birthDate,
    row.age ?? '',
    row.gender,
    row.emergencyContactName,
    row.emergencyContactPhone,
    row.distance,
    row.lot,
    row.shirtSize,
    row.status,
    row.paymentStatus,
    row.checkInStatus,
    row.kitStatus,
    (row.amountCents / 100).toFixed(2),
    row.createdAt,
  ].map(escapeCsv).join(','));

  csv(res, 'funpace-run-inscritos.csv', [headers.join(','), ...lines].join('\n'));
}

async function handleAdminPartnershipsCsv(req: IncomingMessage, res: ServerResponse) {
  if (!requireAdmin(req, res)) {
    return;
  }

  const database = await transaction((currentDatabase) => currentDatabase);
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
