import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { validateRegistration } from '../src/lib/validation';
import type { CreateRegistrationResponse, RegistrationFormData, RegistrationStatus } from '../src/types/registration';
import { snapshot, transaction, type PaymentRecord, type RegistrationRecord } from './database';

const port = Number(process.env.API_PORT || 3001);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || '';
const adminApiKey = process.env.ADMIN_API_KEY || 'change-me';
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && adminApiKey === 'change-me') {
  throw new Error('ADMIN_API_KEY must be changed in production.');
}

const rateLimit = new Map<string, { count: number; resetAt: number }>();

function setCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Webhook-Signature,X-Admin-Key');
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

function logRequest(req: IncomingMessage, statusCode: number, message: string) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    method: req.method,
    path: req.url?.split('?')[0],
    statusCode,
    message,
  }));
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
  if (isAdminAuthorized(req)) {
    return true;
  }

  json(res, 401, { message: 'Acesso administrativo nao autorizado.' });
  return false;
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

function sanitizeRegistration(input: RegistrationFormData): RegistrationFormData {
  return {
    ...input,
    fullName: input.fullName.trim(),
    email: input.email.trim().toLowerCase(),
    cpf: input.cpf.trim(),
    phone: input.phone.trim(),
    emergencyContactName: input.emergencyContactName.trim(),
    emergencyContactPhone: input.emergencyContactPhone.trim(),
  };
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

  const response = transaction<CreateRegistrationResponse & { statusCode: number }>((database) => {
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
      const response: CreateRegistrationResponse = {
        registrationId: existing.id,
        registrationStatus: existing.status,
        checkoutStatus: 'not_configured',
        checkoutUrl: null,
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
    };
    const payment: PaymentRecord = {
      id: randomUUID(),
      registrationId: registration.id,
      provider: 'not_configured',
      status: 'pending_payment',
      amountCents: registration.amountCents,
      providerPaymentId: null,
      checkoutUrl: null,
      createdAt: now,
      updatedAt: now,
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
      message: 'Inscricao pre-criada. Configure um adaptador de pagamento real para gerar checkout.',
    };
  });

  const { statusCode, ...payloadResponse } = response;
  logRequest(req, statusCode, response.registrationId ? 'registration_processed' : 'registration_rejected');
  json(res, statusCode, payloadResponse);
}

async function handlePaymentWebhook(req: IncomingMessage, res: ServerResponse) {
  if (!requireJson(req, res)) {
    return;
  }

  const rawBody = await readBody(req);
  const signature = Array.isArray(req.headers['x-webhook-signature'])
    ? req.headers['x-webhook-signature'][0]
    : req.headers['x-webhook-signature'];

  if (!verifyWebhookSignature(rawBody, signature)) {
    json(res, 401, { message: 'Webhook nao autorizado.' });
    return;
  }

  const event = parseJsonBody<{ registrationId?: string; status?: RegistrationStatus; providerEventId?: string; eventType?: string }>(rawBody);

  if (!event?.registrationId || !event.status) {
    json(res, 422, { message: 'Webhook invalido.' });
    return;
  }

  const result = transaction<{ statusCode: number; payload: unknown }>((database) => {
    const registration = database.registrations.find((item) => item.id === event.registrationId);

    if (!registration) {
      return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    }

    const payment = database.payments.find((item) => item.registrationId === registration.id);
    const now = new Date().toISOString();

    registration.status = event.status;
    registration.updatedAt = now;

    if (payment) {
      payment.status = event.status;
      payment.updatedAt = now;
    }

    database.paymentEvents.push({
      id: randomUUID(),
      paymentId: payment?.id || '',
      providerEventId: event.providerEventId || randomUUID(),
      eventType: event.eventType || 'payment.status_changed',
      payload: event,
      receivedAt: now,
    });

    return { statusCode: 200, payload: { ok: true } };
  });

  json(res, result.statusCode, result.payload);
}

function handleGetRegistration(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const id = url.pathname.split('/').at(-1) || '';
  const database = snapshot();
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
  });
}

function handleGetAvailability(_req: IncomingMessage, res: ServerResponse) {
  const database = snapshot();
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

function getAdminRows(url: URL) {
  const database = snapshot();
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
      );
    })
    .map((registration) => {
      const distance = database.distances.find((item) => item.id === registration.distanceId);
      const lot = database.lots.find((item) => item.id === registration.lotId);
      const payment = database.payments.find((item) => item.registrationId === registration.id);

      return {
        id: registration.id,
        fullName: registration.payload.fullName,
        email: registration.payload.email,
        phone: registration.payload.phone,
        distance: distance?.name || registration.distanceId,
        distanceId: registration.distanceId,
        lot: lot?.name || registration.lotId,
        lotId: registration.lotId,
        shirtSize: registration.payload.shirtSize,
        status: registration.status,
        paymentStatus: payment?.status || registration.status,
        amountCents: registration.amountCents,
        createdAt: registration.createdAt,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function handleAdminSummary(req: IncomingMessage, res: ServerResponse) {
  if (!requireAdmin(req, res)) {
    return;
  }

  const database = snapshot();
  const paid = database.registrations.filter((item) => item.status === 'paid');
  const pending = database.registrations.filter((item) => item.status === 'pending_payment');
  const revenueCents = paid.reduce((total, item) => total + item.amountCents, 0);
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
    },
    byStatus,
    byDistance,
    lots,
  });
}

function handleAdminRegistrations(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!requireAdmin(req, res)) {
    return;
  }

  json(res, 200, { registrations: getAdminRows(url) });
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function handleAdminRegistrationsCsv(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!requireAdmin(req, res)) {
    return;
  }

  const rows = getAdminRows(url);
  const headers = ['id', 'nome', 'email', 'telefone', 'distancia', 'lote', 'camisa', 'status', 'pagamento', 'valor', 'criado_em'];
  const lines = rows.map((row) => [
    row.id,
    row.fullName,
    row.email,
    row.phone,
    row.distance,
    row.lot,
    row.shirtSize,
    row.status,
    row.paymentStatus,
    (row.amountCents / 100).toFixed(2),
    row.createdAt,
  ].map(escapeCsv).join(','));

  csv(res, 'funpace-run-inscritos.csv', [headers.join(','), ...lines].join('\n'));
}

createServer(async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/api/registrations') {
      await handleCreateRegistration(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/registrations/')) {
      handleGetRegistration(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/availability') {
      handleGetAvailability(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/summary') {
      handleAdminSummary(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/registrations') {
      handleAdminRegistrations(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/registrations.csv') {
      handleAdminRegistrationsCsv(req, res, url);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/webhooks/payment') {
      await handlePaymentWebhook(req, res);
      return;
    }

    json(res, 404, { message: 'Rota nao encontrada.' });
  } catch {
    json(res, 500, { message: 'Erro interno da API.' });
  }
}).listen(port, () => {
  console.log(`FunPace Run API listening on http://localhost:${port}`);
});
