import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import test from 'node:test';
import type { Database, GoogleSheetSyncRecord, PaymentRecord, RegistrationRecord } from '../server/database.js';
import {
  buildPaymentSheetRow,
  buildRegistrationSheetRow,
  createGoogleSheetsClient,
  executeGoogleSheetSyncTask,
  createServiceAccountAssertion,
  getGoogleSheetsConfig,
  maskCpfForSheet,
  normalizeGooglePrivateKey,
  processGoogleSheetSync,
  queueCheckInGoogleSheetSync,
  queueConfirmedPaymentGoogleSheetSync,
  queueRegistrationGoogleSheetSync,
  sanitizeSheetText,
  type GoogleSheetsClient,
} from '../server/google-sheets.js';

const configuredEnvironment = {
  GOOGLE_SHEETS_ENABLED: 'true',
  GOOGLE_SHEETS_SPREADSHEET_ID: 'spreadsheet-1',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@example.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: 'not-used-by-mocked-token-provider',
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const registration: RegistrationRecord = {
  id: 'registration-1',
  eventId: 'event-1',
  distanceId: 'distance-5k',
  lotId: 'lot-1',
  cpfHash: 'hash',
  status: 'pending_payment',
  amountCents: 7990,
  payload: {
    fullName: 'Maria da Silva',
    email: 'maria@example.com',
    cpf: '123.456.789-01',
    phone: '+55 69 99999-0000',
    city: 'Porto Velho',
    state: 'RO',
    team: '',
    birthDate: '1990-01-01',
    gender: 'female',
    shirtSize: 'M',
    distance: '5K',
    emergencyContactName: 'Contato',
    emergencyContactPhone: '69999990001',
    termsAccepted: true,
    regulationAccepted: true,
    privacyAccepted: true,
  },
  createdAt: '2026-07-08T12:00:00.000Z',
  updatedAt: '2026-07-08T12:00:00.000Z',
};

const payment: PaymentRecord = {
  id: 'payment-1',
  registrationId: registration.id,
  provider: 'infinitepay',
  status: 'paid',
  amountCents: 7990,
  providerPaymentId: 'invoice-1',
  checkoutUrl: null,
  createdAt: '2026-07-08T12:00:00.000Z',
  updatedAt: '2026-07-08T12:05:00.000Z',
  paidAt: '2026-07-08T12:05:00.000Z',
  gatewayTransactionId: 'transaction-1',
};

const database: Database = {
  events: [],
  distances: [{ id: 'distance-5k', eventId: 'event-1', name: '5K', distanceKm: 5, capacity: 100, status: 'active' }],
  lots: [{ id: 'lot-1', eventId: 'event-1', name: 'Lote 1', priceCents: 7990, capacity: 100, soldCount: 1, status: 'active', startsAt: '', endsAt: '', orderIndex: 1, continuesAfterCapacity: false }],
  registrations: [registration],
  payments: [payment],
  paymentEvents: [],
  googleSheetSyncs: [],
  checkIns: [],
  kitDeliveries: [],
  auditLogs: [],
  adminSessions: [],
  adminUsers: [],
  partnershipLeads: [],
};

function syncTask(overrides: Partial<GoogleSheetSyncRecord> = {}): GoogleSheetSyncRecord {
  return {
    id: 'sync-1',
    entityType: 'registration',
    entityId: registration.id,
    sheetName: 'registrations',
    operation: 'upsert',
    status: 'processing',
    rowNumber: 9,
    attempts: 1,
    lastAttemptAt: '2026-07-08T12:10:00.000Z',
    synchronizedAt: null,
    lastError: null,
    createdAt: '2026-07-08T12:00:00.000Z',
    updatedAt: '2026-07-08T12:10:00.000Z',
    ...overrides,
  };
}

test('keeps integration disabled without requiring credentials', () => {
  const config = getGoogleSheetsConfig({ GOOGLE_SHEETS_ENABLED: 'false' });
  assert.equal(config.enabled, false);
  assert.equal(config.configurationIssue, null);
});

test('reports every missing variable when integration is enabled', () => {
  const config = getGoogleSheetsConfig({ GOOGLE_SHEETS_ENABLED: 'true' });
  assert.match(config.configurationIssue || '', /GOOGLE_SHEETS_SPREADSHEET_ID/);
  assert.match(config.configurationIssue || '', /GOOGLE_SERVICE_ACCOUNT_EMAIL/);
  assert.match(config.configurationIssue || '', /GOOGLE_PRIVATE_KEY/);
});

test('normalizes escaped private key line breaks', () => {
  assert.equal(normalizeGooglePrivateKey('"line-1\\nline-2"'), 'line-1\nline-2');
});

test('masks CPF and neutralizes spreadsheet formulas', () => {
  assert.equal(maskCpfForSheet('123.456.789-01'), '123.***.***-01');
  assert.equal(maskCpfForSheet('invalid'), '***.***.***-**');
  assert.equal(sanitizeSheetText('=IMPORTXML("url")'), "'=IMPORTXML(\"url\")");
  assert.equal(sanitizeSheetText('Maria'), 'Maria');
});

test('builds registration row in the documented column order', () => {
  const row = buildRegistrationSheetRow({
    registration,
    payment,
    distanceName: '5K',
    lotName: 'Lote 1',
    paymentMethod: 'pix',
  });

  assert.equal(row.length, 14);
  assert.deepEqual(row.slice(0, 6), [
    registration.createdAt,
    registration.status,
    registration.payload.fullName,
    '123.***.***-01',
    "'+55 69 99999-0000",
    registration.payload.email,
  ]);
  assert.deepEqual(row.slice(10), [79.9, 'pix', registration.id, payment.id]);
});

test('builds payment row with internal and gateway identifiers', () => {
  assert.deepEqual(buildPaymentSheetRow({ payment, paymentMethod: 'pix' }), [
    payment.paidAt,
    registration.id,
    payment.id,
    'paid',
    'pix',
    79.9,
    'infinitepay',
    'transaction-1',
  ]);
});

test('creates a valid RS256 service account assertion', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const config = getGoogleSheetsConfig({
    GOOGLE_SHEETS_ENABLED: 'true',
    GOOGLE_SHEETS_SPREADSHEET_ID: 'spreadsheet-1',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@example.iam.gserviceaccount.com',
    GOOGLE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  const assertion = createServiceAccountAssertion(config, 1_700_000_000);
  const [header, claims, signature] = assertion.split('.');
  const decodedClaims = JSON.parse(Buffer.from(claims, 'base64url').toString()) as Record<string, unknown>;

  assert.equal(decodedClaims.iss, 'service@example.iam.gserviceaccount.com');
  assert.equal(decodedClaims.iat, 1_700_000_000);
  assert.equal(decodedClaims.exp, 1_700_003_600);
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url')), true);
});

test('creates missing tabs and initializes their headers', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('?fields=sheets.properties.title')) return jsonResponse({ sheets: [] });
    if (url.includes('/values/') && init?.method !== 'PUT') return jsonResponse({ values: [] });
    return jsonResponse({});
  }) as typeof fetch;
  const client = createGoogleSheetsClient({
    config: getGoogleSheetsConfig(configuredEnvironment),
    fetchImplementation: fetchMock,
    accessTokenProvider: async () => 'test-token',
  });

  const result = await client.ensureSpreadsheetStructure();

  assert.equal(result.createdSheets.length, 4);
  const batchCall = calls.find((call) => call.url.endsWith(':batchUpdate'));
  assert.ok(batchCall);
  assert.equal(JSON.parse(String(batchCall.init?.body)).requests.length, 4);
  assert.equal(calls.filter((call) => call.init?.method === 'PUT').length, 4);
});

test('refuses to overwrite an unexpected header', async () => {
  const fetchMock = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('?fields=sheets.properties.title')) {
      return jsonResponse({ sheets: Object.values({ registrations: 'Inscrições', payments: 'Pagamentos', shirts: 'Camisas', check_in: 'Check-in' }).map((title) => ({ properties: { title } })) });
    }
    return jsonResponse({ values: [['Cabeçalho alterado']] });
  }) as typeof fetch;
  const client = createGoogleSheetsClient({
    config: getGoogleSheetsConfig(configuredEnvironment),
    fetchImplementation: fetchMock,
    accessTokenProvider: async () => 'test-token',
  });

  await assert.rejects(client.ensureSpreadsheetStructure(), /Cabeçalho inesperado/);
});

test('updates an existing registration instead of appending a duplicate', async () => {
  const methods: string[] = [];
  const fetchMock = (async (_input: string | URL | Request, init?: RequestInit) => {
    methods.push(init?.method || 'GET');
    if (!init?.method) return jsonResponse({ values: [['other-registration'], [registration.id]] });
    return jsonResponse({});
  }) as typeof fetch;
  const client = createGoogleSheetsClient({
    config: getGoogleSheetsConfig(configuredEnvironment),
    fetchImplementation: fetchMock,
    accessTokenProvider: async () => 'test-token',
  });
  const row = buildRegistrationSheetRow({ registration, payment, distanceName: '5K', lotName: 'Lote 1' });

  const result = await client.upsertRow('registrations', row, 12, registration.id);

  assert.deepEqual(result, { action: 'updated', rowNumber: 3 });
  assert.deepEqual(methods, ['GET', 'PUT']);
});

test('appends a new payment and captures its row number', async () => {
  const methods: string[] = [];
  const fetchMock = (async (_input: string | URL | Request, init?: RequestInit) => {
    methods.push(init?.method || 'GET');
    if (!init?.method) return jsonResponse({ values: [] });
    return jsonResponse({ updates: { updatedRange: "'Pagamentos'!A7:H7" } });
  }) as typeof fetch;
  const client = createGoogleSheetsClient({
    config: getGoogleSheetsConfig(configuredEnvironment),
    fetchImplementation: fetchMock,
    accessTokenProvider: async () => 'test-token',
  });

  const result = await client.upsertRow('payments', buildPaymentSheetRow({ payment }), 2, payment.id);

  assert.deepEqual(result, { action: 'created', rowNumber: 7 });
  assert.deepEqual(methods, ['GET', 'POST']);
});

test('replaces shirt summary by clearing stale rows first', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return jsonResponse({});
  }) as typeof fetch;
  const client = createGoogleSheetsClient({
    config: getGoogleSheetsConfig(configuredEnvironment),
    fetchImplementation: fetchMock,
    accessTokenProvider: async () => 'test-token',
  });

  const result = await client.replaceRows('shirts', [['P', 10], ['M', 20]]);

  assert.deepEqual(result, { rowCount: 2 });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /'Camisas'!A%3AB:clear$/);
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal(calls[1].init?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)).values, [
    ['Tamanho', 'Quantidade'],
    ['P', 10],
    ['M', 20],
  ]);
});

test('executes registration task using persisted row as an idempotency hint', async () => {
  let received: unknown[] = [];
  const client = {
    upsertRow: async (...args: unknown[]) => {
      received = args;
      return { action: 'updated' as const, rowNumber: 9 };
    },
  } as unknown as GoogleSheetsClient;

  const result = await executeGoogleSheetSyncTask(syncTask(), database, client);

  assert.deepEqual(result, { action: 'updated', rowNumber: 9 });
  assert.equal(received[0], 'registrations');
  assert.equal(received[2], 12);
  assert.equal(received[3], registration.id);
  assert.equal(received[4], 9);
});

test('builds shirt summary only from paid registrations', async () => {
  let rows: unknown = null;
  const client = {
    replaceRows: async (_sheet: string, receivedRows: unknown) => {
      rows = receivedRows;
      return { rowCount: 4 };
    },
  } as unknown as GoogleSheetsClient;
  const paidDatabase = {
    ...database,
    registrations: [{ ...registration, status: 'paid' as const }],
  };

  await executeGoogleSheetSyncTask(syncTask({ entityType: 'shirt_summary', entityId: 'paid', sheetName: 'shirts', operation: 'replace', rowNumber: null }), paidDatabase, client);

  assert.deepEqual(rows, [['P', 0], ['M', 1], ['G', 0], ['GG', 0]]);
});

test('marks a claimed sync as completed', async () => {
  let completed: { id: string; rowNumber: number | null } | null = null;
  const task = syncTask();
  const client = {
    ensureSpreadsheetStructure: async () => ({ createdSheets: [] }),
    upsertRow: async () => ({ action: 'updated' as const, rowNumber: 9 }),
  } as unknown as GoogleSheetsClient;

  const result = await processGoogleSheetSync(task.id, {
    config: getGoogleSheetsConfig(configuredEnvironment),
    client,
    loadDatabase: async () => database,
    claim: async () => task,
    complete: async (id, rowNumber) => { completed = { id, rowNumber }; },
    fail: async () => assert.fail('failure callback must not run'),
  });

  assert.equal(result.status, 'synchronized');
  assert.deepEqual(completed, { id: task.id, rowNumber: 9 });
});

test('records failure without throwing into the main flow', async () => {
  let failed = false;
  const task = syncTask();
  const client = {
    ensureSpreadsheetStructure: async () => ({ createdSheets: [] }),
    upsertRow: async () => { throw new Error('simulated Sheets outage'); },
  } as unknown as GoogleSheetsClient;

  const result = await processGoogleSheetSync(task.id, {
    config: getGoogleSheetsConfig(configuredEnvironment),
    client,
    loadDatabase: async () => database,
    claim: async () => task,
    complete: async () => assert.fail('completion callback must not run'),
    fail: async (_id, error) => { failed = error instanceof Error; },
  });

  assert.equal(result.status, 'failed');
  assert.equal(failed, true);
});

test('does not enqueue registration sync while integration is disabled', async () => {
  let enqueueCalled = false;
  const result = await queueRegistrationGoogleSheetSync(registration.id, {
    config: getGoogleSheetsConfig({ GOOGLE_SHEETS_ENABLED: 'false' }),
    enqueue: async () => {
      enqueueCalled = true;
      return syncTask({ status: 'pending' });
    },
  });

  assert.equal(result, null);
  assert.equal(enqueueCalled, false);
});

test('queues a new registration with the correct idempotency key', async () => {
  let received: unknown = null;
  const result = await queueRegistrationGoogleSheetSync(registration.id, {
    config: getGoogleSheetsConfig(configuredEnvironment),
    enqueue: async (input) => {
      received = input;
      return syncTask({ status: 'pending' });
    },
  });

  assert.ok(result);
  assert.deepEqual(received, {
    entityType: 'registration',
    entityId: registration.id,
    sheetName: 'registrations',
    operation: 'upsert',
  });
});

test('absorbs an outbox failure so registration can continue', async () => {
  const result = await queueRegistrationGoogleSheetSync(registration.id, {
    config: getGoogleSheetsConfig(configuredEnvironment),
    enqueue: async () => { throw new Error('database temporarily unavailable'); },
  });

  assert.equal(result, null);
});

test('absorbs claim failure during best-effort processing', async () => {
  const result = await processGoogleSheetSync('sync-claim-error', {
    config: getGoogleSheetsConfig(configuredEnvironment),
    claim: async () => { throw new Error('claim failed'); },
  });

  assert.equal(result.status, 'failed');
});

test('queues registration, payment and shirt summary after confirmation', async () => {
  const received: Array<Record<string, string>> = [];
  const tasks = await queueConfirmedPaymentGoogleSheetSync(registration.id, payment.id, {
    config: getGoogleSheetsConfig(configuredEnvironment),
    enqueue: async (input) => {
      received.push(input);
      return syncTask({
        id: `sync-${received.length}`,
        entityType: input.entityType,
        entityId: input.entityId,
        sheetName: input.sheetName,
        operation: input.operation,
        status: 'pending',
      });
    },
  });

  assert.equal(tasks.length, 3);
  assert.deepEqual(received, [
    { entityType: 'registration', entityId: registration.id, sheetName: 'registrations', operation: 'upsert' },
    { entityType: 'payment', entityId: payment.id, sheetName: 'payments', operation: 'upsert' },
    { entityType: 'shirt_summary', entityId: 'paid-registrations', sheetName: 'shirts', operation: 'replace' },
  ]);
});

test('continues queuing remaining payment projections after one outbox failure', async () => {
  let attempt = 0;
  const tasks = await queueConfirmedPaymentGoogleSheetSync(registration.id, payment.id, {
    config: getGoogleSheetsConfig(configuredEnvironment),
    enqueue: async (input) => {
      attempt += 1;
      if (attempt === 2) throw new Error('simulated payment queue failure');
      return syncTask({
        id: `sync-${attempt}`,
        entityType: input.entityType,
        entityId: input.entityId,
        sheetName: input.sheetName,
        operation: input.operation,
        status: 'pending',
      });
    },
  });

  assert.equal(attempt, 3);
  assert.deepEqual(tasks.map((task) => task.entityType), ['registration', 'shirt_summary']);
});

test('queues check-in projection with registration as idempotency key', async () => {
  let received: unknown = null;
  const task = await queueCheckInGoogleSheetSync(registration.id, {
    config: getGoogleSheetsConfig(configuredEnvironment),
    enqueue: async (input) => {
      received = input;
      return syncTask({
        entityType: input.entityType,
        entityId: input.entityId,
        sheetName: input.sheetName,
        operation: input.operation,
        status: 'pending',
      });
    },
  });

  assert.ok(task);
  assert.deepEqual(received, {
    entityType: 'check_in',
    entityId: registration.id,
    sheetName: 'check_in',
    operation: 'upsert',
  });
});

test('check-in executor reflects delivery and keeps technical registration id', async () => {
  let receivedRow: unknown[] = [];
  const client = {
    upsertRow: async (_sheet: string, row: unknown[]) => {
      receivedRow = row;
      return { action: 'created' as const, rowNumber: 2 };
    },
  } as unknown as GoogleSheetsClient;
  const operationalDatabase: Database = {
    ...database,
    checkIns: [{ id: 'check-1', registrationId: registration.id, status: 'checked_in', checkedInAt: '2026-09-20T09:00:00.000Z', checkedInBy: 'operator@example.com', notes: null }],
    kitDeliveries: [{ id: 'kit-1', registrationId: registration.id, status: 'delivered', deliveredAt: '2026-09-20T09:05:00.000Z', deliveredBy: 'operator@example.com', notes: null }],
  };

  await executeGoogleSheetSyncTask(syncTask({ entityType: 'check_in', sheetName: 'check_in', rowNumber: null }), operationalDatabase, client);

  assert.equal(receivedRow.length, 8);
  assert.equal(receivedRow[4], 'Sim');
  assert.equal(receivedRow[5], '2026-09-20T09:00:00.000Z');
  assert.equal(receivedRow[7], registration.id);
});

test('check-in executor reflects reversed operational state', async () => {
  let receivedRow: unknown[] = [];
  const client = {
    upsertRow: async (_sheet: string, row: unknown[]) => {
      receivedRow = row;
      return { action: 'updated' as const, rowNumber: 2 };
    },
  } as unknown as GoogleSheetsClient;

  await executeGoogleSheetSyncTask(syncTask({ entityType: 'check_in', sheetName: 'check_in', rowNumber: 2 }), database, client);

  assert.equal(receivedRow[4], 'Não');
  assert.equal(receivedRow[5], '');
  assert.equal(receivedRow[6], '');
});
