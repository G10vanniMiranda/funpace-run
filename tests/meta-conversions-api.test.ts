import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { afterEach } from 'node:test';
import {
  buildMetaConversionsPayload,
  buildMetaServerEvent,
  buildMetaUserData,
  getMetaCapiConfig,
  normalizeBrazilianPhone,
  normalizeEmail,
  normalizeEventTime,
  normalizeMetaGender,
  normalizeMetaState,
  normalizeMetaText,
  normalizeMetaSourceUrl,
  sanitizeMetaCookie,
  sendMetaServerEvent,
  sha256Normalized,
  validateMetaEventId,
  validatePublicIp,
} from '../server/meta-conversions-api';
import { canQueueMetaPurchase } from '../server/meta-events';

const managedEnv = [
  'META_CAPI_ENABLED',
  'META_PIXEL_ID',
  'META_CONVERSIONS_API_TOKEN',
  'META_GRAPH_API_VERSION',
  'META_TEST_EVENT_CODE',
  'META_CAPI_TIMEOUT_MS',
  'APP_ENV',
];
const originalEnv = Object.fromEntries(managedEnv.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of managedEnv) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureMeta() {
  process.env.META_CAPI_ENABLED = 'true';
  process.env.META_PIXEL_ID = '1033672682712625';
  process.env.META_CONVERSIONS_API_TOKEN = 'server-secret';
  process.env.META_GRAPH_API_VERSION = 'v99.0';
  delete process.env.META_TEST_EVENT_CODE;
}

function validEvent() {
  return buildMetaServerEvent({
    eventName: 'Purchase',
    eventId: 'purchase_registration-123',
    eventTime: Math.floor(Date.now() / 1000),
    eventSourceUrl: 'https://funpace.club/sucesso',
    userData: buildMetaUserData({
      email: ' Atleta@Example.COM ',
      phone: '(69) 99999-9999',
      fullName: 'Ána María da Silva',
      gender: 'female',
      city: 'Porto Velho',
      state: 'RO',
      externalId: 'registration-123',
    }),
    customData: {
      currency: 'BRL',
      value: 99.9,
      content_name: 'FunPace Run 2026',
      content_ids: ['funpace-run-2026'],
      content_type: 'product',
      order_id: 'registration-123',
      num_items: 1,
    },
  });
}

test('normalizes identity fields for Meta matching', () => {
  assert.equal(normalizeEmail(' Atleta@Example.COM '), 'atleta@example.com');
  assert.equal(normalizeEmail('invalid'), undefined);
  assert.equal(normalizeBrazilianPhone('(69) 99999-9999'), '5569999999999');
  assert.equal(normalizeBrazilianPhone('+55 69 99999-9999'), '5569999999999');
  assert.equal(normalizeBrazilianPhone('123'), undefined);
  assert.equal(normalizeMetaText('  São José  '), 'saojose');
  assert.equal(normalizeMetaState(' rÔ '), 'ro');
  assert.equal(normalizeMetaGender('female'), 'f');
  assert.equal(normalizeMetaGender('male'), 'm');
  assert.equal(normalizeMetaGender('unknown'), undefined);
});

test('hashes deterministically, omits empty input and does not hash twice', () => {
  const hash = sha256Normalized('atleta@example.com');
  assert.equal(hash, '734ba9adc379e28568efe12a876def57b839990be38cb433ab1cafbd736a3a12');
  assert.equal(sha256Normalized(''), undefined);
  assert.equal(sha256Normalized(hash), hash);
  assert.equal(sha256Normalized(hash?.toUpperCase()), hash);
});

test('builds user_data without CPF, nulls or unhashed identity fields', () => {
  const userData = buildMetaUserData(
    {
      email: 'atleta@example.com',
      phone: '69999999999',
      fullName: 'Ána Silva',
      gender: 'female',
      city: 'Porto Velho',
      state: 'RO',
      country: 'br',
      externalId: 'registration-123',
    },
    {
      clientIpAddress: '8.8.8.8',
      clientUserAgent: 'Test Browser',
      fbp: 'fb.1.1785006876000.123456789',
      fbc: 'fb.1.1785006876000.valid-click-id',
    },
  );
  const serialized = JSON.stringify(userData);
  for (const key of ['em', 'ph', 'fn', 'ln', 'ge', 'ct', 'st', 'country', 'external_id']) {
    const value = userData[key as keyof typeof userData];
    assert.ok(Array.isArray(value));
    assert.match((value as string[])[0], /^[a-f0-9]{64}$/);
  }
  assert.equal(userData.client_ip_address, '8.8.8.8');
  assert.equal(userData.client_user_agent, 'Test Browser');
  assert.equal(serialized.includes('cpf'), false);
  assert.equal(serialized.includes('null'), false);
  assert.equal(serialized.includes('atleta@example.com'), false);
});

test('validates public IP addresses and rejects private or malformed values', () => {
  assert.equal(validatePublicIp('8.8.8.8'), '8.8.8.8');
  assert.equal(validatePublicIp('::ffff:8.8.8.8'), '8.8.8.8');
  assert.equal(validatePublicIp('::ffff:192.168.1.1'), undefined);
  assert.equal(validatePublicIp('192.168.1.1'), undefined);
  assert.equal(validatePublicIp('127.0.0.1'), undefined);
  assert.equal(validatePublicIp('not-an-ip'), undefined);
});

test('validates Meta cookies and prevents arbitrary source origins', () => {
  process.env.APP_URL = 'https://funpace.club';
  process.env.ALLOWED_ORIGINS = 'https://funpace.club,https://www.funpace.club';
  assert.equal(
    sanitizeMetaCookie('fb.1.1785006876000.valid-click-id'),
    'fb.1.1785006876000.valid-click-id',
  );
  assert.equal(sanitizeMetaCookie('invalid-cookie'), undefined);
  assert.equal(
    normalizeMetaSourceUrl('https://funpace.club/?email=private@example.com#register', '/'),
    'https://funpace.club/',
  );
  assert.equal(
    normalizeMetaSourceUrl('https://attacker.example/collect', '/sucesso'),
    'https://funpace.club/sucesso',
  );
  delete process.env.APP_URL;
  delete process.env.ALLOWED_ORIGINS;
});

test('builds a Purchase payload with seconds, BRL and deterministic event_id', () => {
  const event = validEvent();
  assert.equal(event.event_name, 'Purchase');
  assert.equal(event.event_id, 'purchase_registration-123');
  assert.equal(event.custom_data.currency, 'BRL');
  assert.equal(event.custom_data.value, 99.9);
  assert.ok(Number.isInteger(event.event_time));
  assert.ok(event.event_time < 10_000_000_000);
  assert.equal(validateMetaEventId('Purchase', event.event_id), true);
  assert.equal(validateMetaEventId('Purchase', 'complete_registration_registration-123'), false);
  assert.ok(normalizeEventTime(Date.now() / 1000));
});

test('includes test_event_code only when configured and never includes the token', () => {
  configureMeta();
  process.env.APP_ENV = 'homologation';
  process.env.META_TEST_EVENT_CODE = 'TEST123';
  const payload = buildMetaConversionsPayload(validEvent());
  const serialized = JSON.stringify(payload);
  assert.equal(payload.test_event_code, 'TEST123');
  assert.equal(serialized.includes('server-secret'), false);

  delete process.env.META_TEST_EVENT_CODE;
  delete process.env.APP_ENV;
  assert.equal(buildMetaConversionsPayload(validEvent()).test_event_code, undefined);
});

test('uses the effectively paid discounted amount in Purchase custom data', () => {
  const event = buildMetaServerEvent({
    eventName: 'Purchase', eventId: 'purchase_discounted-registration', eventTime: Math.floor(Date.now() / 1000),
    eventSourceUrl: 'https://funpace.club/sucesso', userData: {},
    customData: {
      currency: 'BRL', value: 8_991 / 100, order_id: 'discounted-registration',
      content_name: 'FunPace Run 2026', content_ids: ['funpace-run-2026'], content_type: 'product',
    },
  });
  assert.equal(event.custom_data.value, 89.91);
});

test('ignores META_TEST_EVENT_CODE explicitly in production', () => {
  configureMeta();
  process.env.APP_ENV = 'production';
  process.env.META_TEST_EVENT_CODE = 'TEST123';
  const config = getMetaCapiConfig();
  assert.equal(config.testEventCode, '');
  assert.equal(config.testEventCodeBlocked, true);
  assert.equal(buildMetaConversionsPayload(validEvent()).test_event_code, undefined);
  delete process.env.APP_ENV;
  delete process.env.META_TEST_EVENT_CODE;
});

test('accepts a valid Meta response', async () => {
  configureMeta();
  const result = await sendMetaServerEvent(validEvent(), async () => (
    new Response(JSON.stringify({ events_received: 1, messages: [], fbtrace_id: 'trace' }), { status: 200 })
  ));
  assert.deepEqual(result.ok, true);
  if (result.ok) assert.equal(result.eventsReceived, 1);
});

test('normalizes whitespace and casing in the Meta CAPI enable flag', async () => {
  configureMeta();
  process.env.META_CAPI_ENABLED = '  TRUE\r\n';
  let calls = 0;
  const result = await sendMetaServerEvent(validEvent(), async () => {
    calls += 1;
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});

for (const [status, retryable] of [[400, false], [401, false], [429, true], [500, true]] as const) {
  test(`classifies HTTP ${status} correctly`, async () => {
    configureMeta();
    const result = await sendMetaServerEvent(validEvent(), async () => (
      new Response(JSON.stringify({ error: { code: status, type: 'test' } }), { status })
    ));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.retryable, retryable);
  });
}

test('rejects invalid JSON and events_received zero', async () => {
  configureMeta();
  const invalidJson = await sendMetaServerEvent(validEvent(), async () => new Response('not-json', { status: 200 }));
  assert.equal(invalidJson.ok, false);
  if (!invalidJson.ok) assert.equal(invalidJson.errorCode, 'META_INVALID_RESPONSE');

  const zero = await sendMetaServerEvent(validEvent(), async () => (
    new Response(JSON.stringify({ events_received: 0 }), { status: 200 })
  ));
  assert.equal(zero.ok, false);
  if (!zero.ok) assert.equal(zero.retryable, false);
});

test('does not call Meta when disabled or missing credentials', async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls += 1;
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  };
  process.env.META_CAPI_ENABLED = 'false';
  const disabled = await sendMetaServerEvent(validEvent(), fetchMock);
  assert.equal(disabled.ok, false);

  process.env.META_CAPI_ENABLED = 'true';
  delete process.env.META_CONVERSIONS_API_TOKEN;
  const unconfigured = await sendMetaServerEvent(validEvent(), fetchMock);
  assert.equal(unconfigured.ok, false);
  assert.equal(calls, 0);
});

test('classifies timeout as retryable', async () => {
  configureMeta();
  process.env.META_CAPI_TIMEOUT_MS = '1000';
  const result = await sendMetaServerEvent(validEvent(), (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorCode, 'META_TIMEOUT');
    assert.equal(result.retryable, true);
  }
});

test('migration enforces authoritative deduplication and concurrent claiming', () => {
  const migration = readFileSync('server/migrations/20260725_meta_capi_integration_events.sql', 'utf8');
  assert.match(migration, /unique \(provider, event_name, event_id\)/i);
  const rlsMigration = readFileSync('server/migrations/20260725_enable_rls_meta_capi_integration_events.sql', 'utf8');
  assert.match(rlsMigration, /alter table public\."run-integration-events"\s+enable row level security/i);
  const store = readFileSync('server/database.ts', 'utf8');
  assert.match(store, /on conflict \(provider,event_name,event_id\) do nothing/i);
  assert.match(store, /for update(?: of integration)? skip locked/i);
  assert.match(store, /status='sent'/i);
});

test('only a financially confirmed registration is eligible for server Purchase', () => {
  const paidAt = new Date().toISOString();
  const consentAt = new Date(Date.parse(paidAt) - 1_000).toISOString();
  assert.equal(canQueueMetaPurchase('paid', 'paid', paidAt, true, consentAt), true);
  for (const status of ['pending_payment', 'cancelled', 'expired', 'payment_failed', 'refunded']) {
    assert.equal(canQueueMetaPurchase(status, status, null, true, consentAt), false);
  }
  assert.equal(canQueueMetaPurchase('paid', 'pending_payment', paidAt, true, consentAt), false);
  assert.equal(canQueueMetaPurchase('paid', 'paid', null, true, consentAt), false);
  assert.equal(canQueueMetaPurchase('paid', 'paid', paidAt, false, consentAt), false);
});
