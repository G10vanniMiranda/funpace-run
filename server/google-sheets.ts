import { createSign } from 'node:crypto';
import { isGoogleSheetsAllowed } from './environment.js';
import {
  claimGoogleSheetSync,
  completeGoogleSheetSync,
  enqueueGoogleSheetSync,
  failGoogleSheetSync,
  snapshot,
  synchronizeOperationalAlertsInPostgres,
  listOperationalAlertsInPostgres,
  type Database,
  type GoogleSheetSyncRecord,
  type GoogleSheetSyncInput,
  CheckInRecord,
  KitDeliveryRecord,
  PaymentRecord,
  RegistrationRecord,
} from './database.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export const GOOGLE_SHEET_TABS = {
  registrations: 'Inscrições',
  payments: 'Financeiro',
  shirts: 'Camisas',
  check_in: 'Check-in',
  lots: 'Lotes',
  alerts: 'Alertas',
  partnerships: 'Patrocínio',
  emails: 'Emails enviados',
} as const;

export const GOOGLE_SHEET_HEADERS = {
  registrations: ['Data da inscrição', 'Status', 'Nome', 'CPF parcial', 'WhatsApp', 'E-mail', 'Sexo', 'Distância', 'Camisa', 'Lote', 'Valor', 'Método de pagamento', 'ID da inscrição', 'ID do pagamento'],
  payments: ['Data', 'ID da inscrição', 'ID do pagamento', 'Status', 'Método', 'Valor', 'Gateway', 'Transaction ID'],
  shirts: ['Tamanho', 'Quantidade'],
  // The last column is a technical idempotency key and should be hidden operationally.
  check_in: ['Nome', 'CPF parcial', 'Distância', 'Camisa', 'Kit entregue', 'Horário', 'Responsável', 'ID da inscrição'],
  lots: ['Lote', 'Capacidade', 'Pagas', 'Reservadas', 'Disponíveis', 'Ocupação %', 'Atualizado em'],
  alerts: ['Gravidade', 'Tipo', 'Título', 'Status', 'Origem', 'Responsável', 'Horário', 'ID'],
  partnerships: ['Empresa', 'Contato', 'Cargo', 'E-mail', 'Status', 'Origem', 'Criado em', 'ID'],
  emails: ['Data', 'Inscrição', 'Destinatário', 'Status', 'Provedor', 'Message ID', 'Erro'],
} as const;

export type GoogleSheetsConfig = {
  enabled: boolean;
  spreadsheetId: string;
  serviceAccountEmail: string;
  privateKey: string;
  configurationIssue: string | null;
};

export type SheetCell = string | number | boolean;
export type GoogleSheetKey = keyof typeof GOOGLE_SHEET_TABS;

export type RegistrationSheetContext = {
  registration: RegistrationRecord;
  payment: PaymentRecord | null;
  distanceName: string;
  lotName: string;
  paymentMethod?: string | null;
};

export type PaymentSheetContext = {
  payment: PaymentRecord;
  paymentMethod?: string | null;
};

export type CheckInSheetContext = {
  registration: RegistrationRecord;
  checkIn: CheckInRecord | null;
  kitDelivery: KitDeliveryRecord | null;
  distanceName: string;
};

type FetchLike = typeof fetch;

let cachedAccessToken: { token: string; expiresAt: number; cacheKey: string } | null = null;
const spreadsheetStructureReadiness = new Map<string, Promise<void>>();

function base64Url(value: string) {
  return Buffer.from(value).toString('base64url');
}

export function normalizeGooglePrivateKey(value: string | undefined) {
  return (value || '').trim().replace(/^['"]|['"]$/g, '').replace(/\\n/g, '\n');
}

export function getGoogleSheetsConfig(environment: NodeJS.ProcessEnv = process.env): GoogleSheetsConfig {
  const enabled = isGoogleSheetsAllowed(environment);
  const spreadsheetId = (environment.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim();
  const serviceAccountEmail = (environment.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const privateKey = normalizeGooglePrivateKey(environment.GOOGLE_PRIVATE_KEY);
  const missing = [
    !spreadsheetId && 'GOOGLE_SHEETS_SPREADSHEET_ID',
    !serviceAccountEmail && 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    !privateKey && 'GOOGLE_PRIVATE_KEY',
  ].filter(Boolean);

  return {
    enabled,
    spreadsheetId,
    serviceAccountEmail,
    privateKey,
    configurationIssue: enabled && missing.length > 0
      ? `Google Sheets habilitado, mas faltam variáveis: ${missing.join(', ')}.`
      : null,
  };
}

export function isGoogleSheetsConfigured(config = getGoogleSheetsConfig()) {
  return config.enabled && !config.configurationIssue;
}

export function maskCpfForSheet(cpf: string) {
  const digits = cpf.replace(/\D/g, '');

  if (digits.length !== 11) {
    return '***.***.***-**';
  }

  return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
}

export function sanitizeSheetText(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  return /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
}

function displayGender(gender: RegistrationRecord['payload']['gender']) {
  if (gender === 'female') return 'Feminino';
  if (gender === 'male') return 'Masculino';
  return '';
}

export function buildRegistrationSheetRow(context: RegistrationSheetContext): SheetCell[] {
  const { registration, payment } = context;

  return [
    registration.createdAt,
    registration.status,
    sanitizeSheetText(registration.payload.fullName),
    maskCpfForSheet(registration.payload.cpf),
    sanitizeSheetText(registration.payload.phone),
    sanitizeSheetText(registration.payload.email),
    displayGender(registration.payload.gender),
    sanitizeSheetText(context.distanceName),
    registration.payload.shirtSize,
    sanitizeSheetText(context.lotName),
    registration.amountCents / 100,
    sanitizeSheetText(context.paymentMethod),
    registration.id,
    payment?.id || '',
  ];
}

export function buildPaymentSheetRow(context: PaymentSheetContext): SheetCell[] {
  const { payment } = context;

  return [
    payment.paidAt || payment.updatedAt,
    payment.registrationId,
    payment.id,
    payment.status,
    sanitizeSheetText(context.paymentMethod),
    payment.amountCents / 100,
    sanitizeSheetText(payment.provider),
    sanitizeSheetText(payment.gatewayTransactionId || payment.providerPaymentId),
  ];
}

export function buildShirtSummaryRows(summary: ReadonlyArray<{ size: string; quantity: number }>): SheetCell[][] {
  return summary.map((item) => [sanitizeSheetText(item.size), item.quantity]);
}

export function buildCheckInSheetRow(context: CheckInSheetContext): SheetCell[] {
  const { registration, checkIn, kitDelivery } = context;

  return [
    sanitizeSheetText(registration.payload.fullName),
    maskCpfForSheet(registration.payload.cpf),
    sanitizeSheetText(context.distanceName),
    registration.payload.shirtSize,
    kitDelivery ? 'Sim' : 'Não',
    checkIn?.checkedInAt || '',
    sanitizeSheetText(checkIn?.checkedInBy || kitDelivery?.deliveredBy),
    registration.id,
  ];
}

export function createServiceAccountAssertion(config: GoogleSheetsConfig, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!isGoogleSheetsConfigured(config)) {
    throw new Error(config.configurationIssue || 'Google Sheets não está habilitado.');
  }

  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: config.serviceAccountEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const unsignedToken = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();

  return `${unsignedToken}.${signer.sign(config.privateKey, 'base64url')}`;
}

export async function getGoogleSheetsAccessToken(
  config = getGoogleSheetsConfig(),
  fetchImplementation: FetchLike = fetch,
) {
  if (!isGoogleSheetsConfigured(config)) {
    throw new Error(config.configurationIssue || 'Google Sheets não está habilitado.');
  }

  const now = Date.now();
  const cacheKey = `${config.serviceAccountEmail}:${config.spreadsheetId}`;
  if (cachedAccessToken && cachedAccessToken.cacheKey === cacheKey && cachedAccessToken.expiresAt > now + 60_000) {
    return cachedAccessToken.token;
  }

  const response = await fetchImplementation(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: createServiceAccountAssertion(config),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json() as { access_token?: string; expires_in?: number; error?: string };

  if (!response.ok || !payload.access_token) {
    throw new Error(`Falha ao autenticar no Google Sheets (${response.status}${payload.error ? `: ${payload.error}` : ''}).`);
  }

  cachedAccessToken = {
    token: payload.access_token,
    expiresAt: now + Math.max(60, payload.expires_in || 3600) * 1000,
    cacheKey,
  };
  return payload.access_token;
}

type GoogleSheetsClientOptions = {
  config?: GoogleSheetsConfig;
  fetchImplementation?: FetchLike;
  accessTokenProvider?: () => Promise<string>;
};

type SpreadsheetMetadata = {
  sheets?: Array<{ properties?: { title?: string } }>;
};

type ValueRange = {
  values?: SheetCell[][];
  updatedRange?: string;
  updates?: { updatedRange?: string };
};

export class GoogleSheetsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly operation: string,
  ) {
    super(message);
    this.name = 'GoogleSheetsApiError';
  }
}

function quoteSheetTitle(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

function columnName(index: number) {
  let result = '';
  let value = index + 1;

  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }

  return result;
}

function normalizeComparableCell(value: SheetCell | null | undefined) {
  return String(value ?? '').trim();
}

function safeGoogleErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const error = (payload as { error?: unknown }).error;
  if (typeof error === 'string') return error.slice(0, 240);
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message.slice(0, 240);
  }
  return '';
}

export function createGoogleSheetsClient(options: GoogleSheetsClientOptions = {}) {
  const config = options.config || getGoogleSheetsConfig();
  const fetchImplementation = options.fetchImplementation || fetch;
  const accessTokenProvider = options.accessTokenProvider
    || (() => getGoogleSheetsAccessToken(config, fetchImplementation));
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}`;

  async function request<ResponsePayload>(
    operation: string,
    path: string,
    init: RequestInit = {},
  ): Promise<ResponsePayload> {
    if (!isGoogleSheetsConfigured(config)) {
      throw new Error(config.configurationIssue || 'Google Sheets não está habilitado.');
    }

    const token = await accessTokenProvider();
    const response = await fetchImplementation(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: init.signal || AbortSignal.timeout(10_000),
    });
    const payload = response.status === 204
      ? null
      : await response.json().catch(() => null);

    if (!response.ok) {
      const detail = safeGoogleErrorMessage(payload);
      throw new GoogleSheetsApiError(
        `Google Sheets recusou ${operation} (${response.status}${detail ? `: ${detail}` : ''}).`,
        response.status,
        operation,
      );
    }

    return payload as ResponsePayload;
  }

  async function getValues(range: string) {
    return request<ValueRange>('leitura de valores', `/values/${encodeURIComponent(range)}?majorDimension=ROWS`);
  }

  async function updateValues(range: string, values: SheetCell[][]) {
    return request<ValueRange>('atualização de valores', `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ majorDimension: 'ROWS', values }),
    });
  }

  async function appendValues(range: string, values: SheetCell[][]) {
    return request<ValueRange>('inclusão de valores', `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ majorDimension: 'ROWS', values }),
    });
  }

  async function clearValues(range: string) {
    await request<unknown>('limpeza de valores', `/values/${encodeURIComponent(range)}:clear`, {
      method: 'POST',
      body: '{}',
    });
  }

  async function ensureSpreadsheetStructure() {
    const metadata = await request<SpreadsheetMetadata>('leitura da estrutura', '?fields=sheets.properties.title');
    const existingTitles = new Set((metadata.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean));
    const missingTitles = Object.values(GOOGLE_SHEET_TABS).filter((title) => !existingTitles.has(title));

    if (missingTitles.length > 0) {
      await request<unknown>('criação de abas', ':batchUpdate', {
        method: 'POST',
        body: JSON.stringify({
          requests: missingTitles.map((title) => ({ addSheet: { properties: { title } } })),
        }),
      });
    }

    for (const sheetKey of Object.keys(GOOGLE_SHEET_TABS) as GoogleSheetKey[]) {
      const title = GOOGLE_SHEET_TABS[sheetKey];
      const headers = [...GOOGLE_SHEET_HEADERS[sheetKey]] as SheetCell[];
      const endColumn = columnName(headers.length - 1);
      const headerRange = `${quoteSheetTitle(title)}!A1:${endColumn}1`;
      const current = (await getValues(headerRange)).values?.[0] || [];

      if (current.length === 0) {
        await updateValues(headerRange, [headers]);
        continue;
      }

      const matches = headers.length === current.length
        && headers.every((header, index) => normalizeComparableCell(current[index]) === header);
      if (!matches) {
        throw new Error(`Cabeçalho inesperado na aba ${title}. Corrija a primeira linha antes de sincronizar.`);
      }
    }

    return { createdSheets: missingTitles };
  }

  async function upsertRow(
    sheetKey: GoogleSheetKey,
    row: SheetCell[],
    keyColumnIndex: number,
    keyValue: string,
    preferredRowNumber?: number | null,
  ) {
    const headers = GOOGLE_SHEET_HEADERS[sheetKey];
    if (row.length !== headers.length) {
      throw new Error(`Linha inválida para ${GOOGLE_SHEET_TABS[sheetKey]}: esperadas ${headers.length} colunas, recebidas ${row.length}.`);
    }
    if (keyColumnIndex < 0 || keyColumnIndex >= headers.length || !keyValue.trim()) {
      throw new Error('Chave de sincronização inválida.');
    }

    const title = GOOGLE_SHEET_TABS[sheetKey];
    const keyColumn = columnName(keyColumnIndex);
    let rowNumber = preferredRowNumber && preferredRowNumber >= 2 ? preferredRowNumber : null;

    if (rowNumber) {
      const validationRange = `${quoteSheetTitle(title)}!${keyColumn}${rowNumber}`;
      const currentKey = (await getValues(validationRange)).values?.[0]?.[0];
      if (normalizeComparableCell(currentKey) !== keyValue.trim()) rowNumber = null;
    }

    if (!rowNumber) {
      const keysRange = `${quoteSheetTitle(title)}!${keyColumn}2:${keyColumn}`;
      const keys = (await getValues(keysRange)).values || [];
      const foundIndex = keys.findIndex((item) => normalizeComparableCell(item[0]) === keyValue.trim());
      if (foundIndex >= 0) rowNumber = foundIndex + 2;
    }

    if (rowNumber) {
      const rowRange = `${quoteSheetTitle(title)}!A${rowNumber}:${columnName(headers.length - 1)}${rowNumber}`;
      await updateValues(rowRange, [row]);
      return { action: 'updated' as const, rowNumber };
    }

    const appended = await appendValues(`${quoteSheetTitle(title)}!A:${columnName(headers.length - 1)}`, [row]);
    const updatedRange = appended.updates?.updatedRange || appended.updatedRange;
    const match = updatedRange?.match(/![A-Z]+(\d+)(?::|$)/);
    return { action: 'created' as const, rowNumber: match ? Number(match[1]) : null };
  }

  async function replaceRows(sheetKey: GoogleSheetKey, rows: SheetCell[][]) {
    const headers = [...GOOGLE_SHEET_HEADERS[sheetKey]] as SheetCell[];
    if (rows.some((row) => row.length !== headers.length)) {
      throw new Error(`Resumo inválido para ${GOOGLE_SHEET_TABS[sheetKey]}.`);
    }

    const title = GOOGLE_SHEET_TABS[sheetKey];
    const endColumn = columnName(headers.length - 1);
    await clearValues(`${quoteSheetTitle(title)}!A:${endColumn}`);
    await updateValues(`${quoteSheetTitle(title)}!A1:${endColumn}${rows.length + 1}`, [headers, ...rows]);
    return { rowCount: rows.length };
  }

  return {
    ensureSpreadsheetStructure,
    getValues,
    updateValues,
    appendValues,
    clearValues,
    upsertRow,
    replaceRows,
  };
}

export type GoogleSheetsClient = ReturnType<typeof createGoogleSheetsClient>;

async function ensureSpreadsheetStructureOnce(
  spreadsheetId: string,
  client: GoogleSheetsClient,
) {
  let readiness = spreadsheetStructureReadiness.get(spreadsheetId);
  if (!readiness) {
    readiness = client.ensureSpreadsheetStructure().then(() => undefined);
    spreadsheetStructureReadiness.set(spreadsheetId, readiness);
    readiness.catch(() => spreadsheetStructureReadiness.delete(spreadsheetId));
  }
  await readiness;
}

function findPaymentMethod(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['payment_method', 'paymentMethod', 'method', 'payment_type', 'paymentType']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  for (const nested of Object.values(record)) {
    const found = findPaymentMethod(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

export async function executeGoogleSheetSyncTask(
  task: GoogleSheetSyncRecord,
  database: Database,
  client: GoogleSheetsClient,
) {
  if (task.entityType === 'registration') {
    const registration = database.registrations.find((item) => item.id === task.entityId);
    if (!registration) throw new Error(`Inscrição ${task.entityId} não encontrada para sincronização.`);
    const payment = database.payments.find((item) => item.registrationId === registration.id) || null;
    const distance = database.distances.find((item) => item.id === registration.distanceId);
    const lot = database.lots.find((item) => item.id === registration.lotId);
    const row = buildRegistrationSheetRow({
      registration,
      payment,
      distanceName: distance?.name || registration.distanceId,
      lotName: lot?.name || registration.lotId,
      paymentMethod: findPaymentMethod(payment?.gatewayPayload),
    });
    return client.upsertRow('registrations', row, 12, registration.id, task.rowNumber);
  }

  if (task.entityType === 'payment') {
    const payment = database.payments.find((item) => item.id === task.entityId);
    if (!payment) throw new Error(`Pagamento ${task.entityId} não encontrado para sincronização.`);
    const row = buildPaymentSheetRow({ payment, paymentMethod: findPaymentMethod(payment.gatewayPayload) });
    return client.upsertRow('payments', row, 2, payment.id, task.rowNumber);
  }

  if (task.entityType === 'check_in') {
    const registration = database.registrations.find((item) => item.id === task.entityId);
    if (!registration) throw new Error(`Inscrição ${task.entityId} não encontrada para check-in.`);
    const row = buildCheckInSheetRow({
      registration,
      checkIn: database.checkIns.find((item) => item.registrationId === registration.id) || null,
      kitDelivery: database.kitDeliveries.find((item) => item.registrationId === registration.id) || null,
      distanceName: database.distances.find((item) => item.id === registration.distanceId)?.name || registration.distanceId,
    });
    return client.upsertRow('check_in', row, 7, registration.id, task.rowNumber);
  }

  if (task.entityType === 'shirt_summary') {
    const quantities = new Map<string, number>();
    for (const registration of database.registrations) {
      if (registration.status !== 'paid') continue;
      const size = registration.payload.shirtSize;
      quantities.set(size, (quantities.get(size) || 0) + 1);
    }
    const sizes = ['P', 'M', 'G', 'GG'];
    const rows = buildShirtSummaryRows(sizes.map((size) => ({ size, quantity: quantities.get(size) || 0 })));
    await client.replaceRows('shirts', rows);
    return { action: 'replaced' as const, rowNumber: null };
  }

  if (task.entityType === 'lot_summary') {
    const now = new Date();
    const rows = database.lots.slice().sort((a, b) => a.orderIndex - b.orderIndex).map((lot) => {
      const related = database.registrations.filter((registration) => registration.lotId === lot.id);
      const confirmed = related.filter((registration) => registration.status === 'paid').length;
      const reserved = related.filter((registration) => registration.status === 'pending_payment' && (!registration.expiresAt || new Date(registration.expiresAt) > now)).length;
      const occupied = confirmed + reserved;
      return [lot.name, lot.capacity, confirmed, reserved, Math.max(lot.capacity - occupied, 0), lot.capacity ? Number((occupied / lot.capacity * 100).toFixed(1)) : 0, now.toISOString()] as SheetCell[];
    });
    await client.replaceRows('lots', rows); return { action: 'replaced' as const, rowNumber: null };
  }

  if (task.entityType === 'partnership') {
    const lead = database.partnershipLeads.find((item) => item.id === task.entityId);
    if (!lead) throw new Error(`Parceria ${task.entityId} não encontrada.`);
    const row: SheetCell[] = [sanitizeSheetText(lead.companyName), sanitizeSheetText(lead.contactName), sanitizeSheetText(lead.contactRole), sanitizeSheetText(lead.corporateEmail), lead.status, lead.source, lead.createdAt, lead.id];
    return client.upsertRow('partnerships', row, 7, lead.id, task.rowNumber);
  }

  if (task.entityType === 'email') {
    const registration = database.registrations.find((item) => item.id === task.entityId);
    if (!registration) throw new Error(`Inscrição ${task.entityId} não encontrada.`);
    const row: SheetCell[] = [registration.confirmationEmailSentAt || registration.confirmationEmailLastAttemptAt || registration.updatedAt, registration.id, sanitizeSheetText(registration.payload.email), registration.confirmationEmailSentAt ? 'enviado' : 'falhou', registration.confirmationEmailProvider || '', registration.confirmationEmailId || '', sanitizeSheetText(registration.confirmationEmailError)];
    return client.upsertRow('emails', row, 1, registration.id, task.rowNumber);
  }

  if (task.entityType === 'alert') {
    const alert = (await listOperationalAlertsInPostgres()).find((item) => item.id === task.entityId);
    if (!alert) throw new Error(`Alerta ${task.entityId} não encontrado.`);
    const row: SheetCell[] = [alert.severity, alert.alertType, sanitizeSheetText(alert.title), alert.status, alert.entityType || '', alert.acknowledgedBy || '', alert.detectedAt, alert.id];
    return client.upsertRow('alerts', row, 7, alert.id, task.rowNumber);
  }

  throw new Error(`Tipo de sincronização não suportado: ${task.entityType}.`);
}

type ProcessGoogleSheetSyncDependencies = {
  config?: GoogleSheetsConfig;
  client?: GoogleSheetsClient;
  loadDatabase?: () => Promise<Database>;
  claim?: typeof claimGoogleSheetSync;
  complete?: typeof completeGoogleSheetSync;
  fail?: typeof failGoogleSheetSync;
};

export async function queueRegistrationGoogleSheetSync(
  registrationId: string,
  dependencies: {
    config?: GoogleSheetsConfig;
    enqueue?: typeof enqueueGoogleSheetSync;
  } = {},
) {
  const config = dependencies.config || getGoogleSheetsConfig();
  if (!config.enabled) return null;

  try {
    const task = await (dependencies.enqueue || enqueueGoogleSheetSync)({
      entityType: 'registration',
      entityId: registrationId,
      sheetName: 'registrations',
      operation: 'upsert',
    });
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      message: 'google_sheets_sync_queued',
      syncId: task.id,
      entityType: task.entityType,
      entityId: task.entityId,
      sheetName: task.sheetName,
    }));
    return task;
  } catch (error) {
    console.error(JSON.stringify({
      at: new Date().toISOString(),
      message: 'google_sheets_sync_queue_failed',
      entityType: 'registration',
      entityId: registrationId,
      error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
    }));
    return null;
  }
}

export async function queueConfirmedPaymentGoogleSheetSync(
  registrationId: string,
  paymentId: string,
  dependencies: {
    config?: GoogleSheetsConfig;
    enqueue?: typeof enqueueGoogleSheetSync;
  } = {},
) {
  const config = dependencies.config || getGoogleSheetsConfig();
  if (!config.enabled) return [];

  const enqueue = dependencies.enqueue || enqueueGoogleSheetSync;
  const inputs = [
    { entityType: 'registration', entityId: registrationId, sheetName: 'registrations', operation: 'upsert' },
    { entityType: 'payment', entityId: paymentId, sheetName: 'payments', operation: 'upsert' },
    { entityType: 'shirt_summary', entityId: 'paid-registrations', sheetName: 'shirts', operation: 'replace' },
    { entityType: 'lot_summary', entityId: 'all-lots', sheetName: 'lots', operation: 'replace' },
  ] as const;
  const queued: GoogleSheetSyncRecord[] = [];

  for (const input of inputs) {
    try {
      const task = await enqueue(input);
      queued.push(task);
      console.log(JSON.stringify({
        at: new Date().toISOString(),
        message: 'google_sheets_sync_queued',
        syncId: task.id,
        entityType: task.entityType,
        entityId: task.entityId,
        sheetName: task.sheetName,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        at: new Date().toISOString(),
        message: 'google_sheets_sync_queue_failed',
        entityType: input.entityType,
        entityId: input.entityId,
        sheetName: input.sheetName,
        error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
      }));
    }
  }

  return queued;
}

export async function queueCheckInGoogleSheetSync(
  registrationId: string,
  dependencies: {
    config?: GoogleSheetsConfig;
    enqueue?: typeof enqueueGoogleSheetSync;
  } = {},
) {
  const config = dependencies.config || getGoogleSheetsConfig();
  if (!config.enabled) return null;

  try {
    const task = await (dependencies.enqueue || enqueueGoogleSheetSync)({
      entityType: 'check_in',
      entityId: registrationId,
      sheetName: 'check_in',
      operation: 'upsert',
    });
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      message: 'google_sheets_sync_queued',
      syncId: task.id,
      entityType: task.entityType,
      entityId: task.entityId,
      sheetName: task.sheetName,
    }));
    return task;
  } catch (error) {
    console.error(JSON.stringify({
      at: new Date().toISOString(),
      message: 'google_sheets_sync_queue_failed',
      entityType: 'check_in',
      entityId: registrationId,
      sheetName: 'check_in',
      error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
    }));
    return null;
  }
}

async function queueProjection(input: GoogleSheetSyncInput, dependencies: { config?: GoogleSheetsConfig; enqueue?: typeof enqueueGoogleSheetSync } = {}) {
  const config = dependencies.config || getGoogleSheetsConfig(); if (!config.enabled) return null;
  try { return await (dependencies.enqueue || enqueueGoogleSheetSync)(input); }
  catch (error) { console.error(JSON.stringify({ at: new Date().toISOString(), message: 'google_sheets_projection_queue_failed', ...input, error: error instanceof Error ? error.message : String(error) })); return null; }
}

export function queueLotSummaryGoogleSheetSync(dependencies: { config?: GoogleSheetsConfig; enqueue?: typeof enqueueGoogleSheetSync } = {}) { return queueProjection({ entityType: 'lot_summary', entityId: 'all-lots', sheetName: 'lots', operation: 'replace' }, dependencies); }
export function queuePartnershipGoogleSheetSync(partnershipId: string, dependencies: { config?: GoogleSheetsConfig; enqueue?: typeof enqueueGoogleSheetSync } = {}) { return queueProjection({ entityType: 'partnership', entityId: partnershipId, sheetName: 'partnerships', operation: 'upsert' }, dependencies); }
export function queueEmailGoogleSheetSync(registrationId: string, dependencies: { config?: GoogleSheetsConfig; enqueue?: typeof enqueueGoogleSheetSync } = {}) { return queueProjection({ entityType: 'email', entityId: registrationId, sheetName: 'emails', operation: 'upsert' }, dependencies); }

export async function processQueuedGoogleSheetSyncs(tasks: ReadonlyArray<Pick<GoogleSheetSyncRecord, 'id'>>) {
  const results = [];
  for (const task of tasks) {
    results.push(await processGoogleSheetSync(task.id));
  }
  return results;
}

export async function processGoogleSheetSync(
  syncId: string,
  dependencies: ProcessGoogleSheetSyncDependencies = {},
) {
  const config = dependencies.config || getGoogleSheetsConfig();
  if (!config.enabled) {
    console.log(JSON.stringify({ at: new Date().toISOString(), message: 'google_sheets_not_configured', reason: 'disabled', syncId }));
    return { status: 'skipped' as const, reason: 'disabled' as const };
  }

  const claim = dependencies.claim || claimGoogleSheetSync;
  const complete = dependencies.complete || completeGoogleSheetSync;
  const fail = dependencies.fail || failGoogleSheetSync;
  let task: GoogleSheetSyncRecord | null = null;
  try {
    task = await claim(syncId);
  } catch (error) {
    console.error(JSON.stringify({
      at: new Date().toISOString(),
      message: 'google_sheets_sync_claim_failed',
      syncId,
      error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
    }));
    await synchronizeOperationalAlertsInPostgres([{
      dedupeKey: `google-sheets:claim:${syncId}`, severity: 'warning', alertType: 'google_sheets_error',
      title: 'Erro no Google Sheets', message: error instanceof Error ? error.message.slice(0, 500) : 'Falha na sincronização.',
      entityType: 'google_sheet_sync', entityId: syncId, payload: { stage: 'claim' },
    }]).catch(() => undefined);
    return { status: 'failed' as const };
  }
  if (!task) return { status: 'skipped' as const, reason: 'not_claimable' as const };

  const startedAt = Date.now();
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    message: 'google_sheets_sync_started',
    syncId: task.id,
    entityType: task.entityType,
    entityId: task.entityId,
    sheetName: task.sheetName,
    attempt: task.attempts,
  }));

  try {
    if (config.configurationIssue) throw new Error(config.configurationIssue);
    const database = await (dependencies.loadDatabase || snapshot)();
    const client = dependencies.client || createGoogleSheetsClient({ config });
    await ensureSpreadsheetStructureOnce(config.spreadsheetId, client);
    const result = await executeGoogleSheetSyncTask(task, database, client);
    await complete(task.id, result.rowNumber);
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      message: 'google_sheets_sync_completed',
      syncId: task.id,
      entityType: task.entityType,
      entityId: task.entityId,
      sheetName: task.sheetName,
      action: result.action,
      rowNumber: result.rowNumber,
      elapsedMs: Date.now() - startedAt,
    }));
    return { status: 'synchronized' as const, ...result };
  } catch (error) {
    try {
      await fail(task.id, error);
    } catch (persistenceError) {
      console.error(JSON.stringify({
        at: new Date().toISOString(),
        message: 'google_sheets_sync_failure_persist_failed',
        syncId: task.id,
        error: persistenceError instanceof Error ? persistenceError.message.slice(0, 500) : 'Unknown error',
      }));
    }
    console.error(JSON.stringify({
      at: new Date().toISOString(),
      message: 'google_sheets_sync_failed',
      syncId: task.id,
      entityType: task.entityType,
      entityId: task.entityId,
      sheetName: task.sheetName,
      error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
      elapsedMs: Date.now() - startedAt,
    }));
    return { status: 'failed' as const };
  }
}
