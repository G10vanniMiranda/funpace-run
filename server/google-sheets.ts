import { createSign } from 'node:crypto';
import { isGoogleSheetsAllowed } from './environment.js';
import { buildRemarketingProjections, type RemarketingProjection } from './remarketing.js';
import { buildConfirmedPaymentsProjection, type ConfirmedPaymentProjection } from './confirmed-payments.js';
import {
  buildGoogleSheetLayoutRequests,
  googleSheetsDateSerial,
  type ActualGoogleSheetLayout,
} from './google-sheets-layout.js';
import {
  claimGoogleSheetSync,
  completeGoogleSheetSync,
  enqueueGoogleSheetSync,
  failGoogleSheetSync,
  listClaimableGoogleSheetSyncs,
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
export const GOOGLE_SHEETS_REQUEST_TIMEOUT_MS = 20_000;

export const GOOGLE_SHEET_TABS = {
  registrations: 'Inscrições',
  payments: 'Financeiro',
  shirts: 'Camisas',
  check_in: 'Check-in',
  lots: 'Lotes',
  alerts: 'Alertas',
  partnerships: 'Patrocínio',
  emails: 'Emails enviados',
  remarketing: 'Remarketing',
  confirmed_payments: 'Pagamentos Confirmados',
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
  remarketing: ['person_key', 'registration_id_reference', 'full_name', 'whatsapp', 'email', 'cpf_masked', 'first_registration_at', 'last_registration_at', 'last_payment_attempt_at', 'amount', 'lot', 'distance', 'registration_status', 'payment_status', 'attempt_count', 'checkout_count', 'partner_or_origin', 'remarketing_status', 'eligible', 'suppression_reason', 'last_payment_check_at', 'updated_at'],
  confirmed_payments: ['Data do pagamento', 'Nome completo', 'CPF parcial', 'WhatsApp', 'E-mail', 'Distância', 'Camisa', 'Lote', 'Número de peito', 'Valor pago', 'Meio de pagamento', 'Parceiro', 'Tipo de parceiro', 'Origem de aquisição', 'Cupom', 'Desconto', 'ID da inscrição', 'ID do pagamento', 'Provider'],
} as const;

export type GoogleSheetsConfig = {
  enabled: boolean;
  remarketingEnabled: boolean;
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
  const remarketingEnabled = enabled && environment.GOOGLE_SHEETS_REMARKETING_ENABLED === 'true';
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
    remarketingEnabled,
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
    googleSheetsDateSerial(registration.createdAt) || '',
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
    googleSheetsDateSerial(payment.paidAt || payment.updatedAt) || '',
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
    checkIn?.checkedInAt ? googleSheetsDateSerial(checkIn.checkedInAt) || '' : '',
    sanitizeSheetText(checkIn?.checkedInBy || kitDelivery?.deliveredBy),
    registration.id,
  ];
}

export function buildRemarketingSheetRow(projection: RemarketingProjection): SheetCell[] {
  return [
    projection.personKey,
    projection.registrationIdReference,
    sanitizeSheetText(projection.fullName),
    sanitizeSheetText(projection.whatsapp),
    sanitizeSheetText(projection.email),
    projection.cpfMasked,
    googleSheetsDateSerial(projection.firstRegistrationAt) || '',
    googleSheetsDateSerial(projection.lastRegistrationAt) || '',
    googleSheetsDateSerial(projection.lastPaymentAttemptAt) || '',
    projection.amountCents / 100,
    sanitizeSheetText(projection.lot),
    sanitizeSheetText(projection.distance),
    projection.registrationStatus,
    projection.paymentStatus,
    projection.attemptCount,
    projection.checkoutCount,
    sanitizeSheetText(projection.partnerOrOrigin),
    projection.remarketingStatus,
    projection.eligible,
    projection.suppressionReason,
    googleSheetsDateSerial(projection.lastPaymentCheckAt) || '',
    googleSheetsDateSerial(projection.updatedAt) || '',
  ];
}

export function buildConfirmedPaymentSheetRow(projection: ConfirmedPaymentProjection): SheetCell[] {
  return [
    googleSheetsDateSerial(projection.paidAt) || '',
    sanitizeSheetText(projection.fullName),
    projection.cpfMasked,
    sanitizeSheetText(projection.whatsapp),
    sanitizeSheetText(projection.email),
    sanitizeSheetText(projection.distance),
    projection.shirtSize,
    sanitizeSheetText(projection.lot),
    sanitizeSheetText(projection.bibNumber),
    projection.amountCents / 100,
    sanitizeSheetText(projection.paymentMethod),
    sanitizeSheetText(projection.partner),
    sanitizeSheetText(projection.partnerType),
    sanitizeSheetText(projection.acquisitionOrigin),
    sanitizeSheetText(projection.coupon),
    projection.discountCents / 100,
    projection.registrationId,
    projection.paymentId,
    sanitizeSheetText(projection.provider),
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
    signal: AbortSignal.timeout(GOOGLE_SHEETS_REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => null) || {}) as { access_token?: string; expires_in?: number; error?: string };

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
  sheets?: ActualGoogleSheetLayout[];
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

export class GoogleSheetSyncFailure extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'GoogleSheetSyncFailure';
  }
}

export function classifyGoogleSheetSyncFailure(error: unknown) {
  if (error instanceof GoogleSheetSyncFailure) return error;
  if (error instanceof GoogleSheetsApiError) {
    const retryable = error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
    return new GoogleSheetSyncFailure(error.message, retryable);
  }
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  const normalizedMessage = message.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const transient = error instanceof DOMException && error.name === 'TimeoutError'
    || /timeout|timed out|aborted|econn|eai_again|enotfound|socket|network|temporar/i.test(normalizedMessage);
  const permanent = /cabecalho inesperado|nao encontrad[oa]|linha invalida|chave de sincronizacao invalida|nao suportado|faltam variaveis|nao esta habilitado/i.test(normalizedMessage);
  return new GoogleSheetSyncFailure(message, transient || !permanent);
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
  const keyIndexCache = new Map<string, Map<string, number>>();

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
      signal: init.signal || AbortSignal.timeout(GOOGLE_SHEETS_REQUEST_TIMEOUT_MS),
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

    return (payload ?? {}) as ResponsePayload;
  }

  async function getValues(range: string) {
    return request<ValueRange>('leitura de valores', `/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  }

  async function batchUpdate(requests: Array<Record<string, unknown>>) {
    if (requests.length === 0) return { replies: [] };
    return request<{ replies?: unknown[] }>('formatação da planilha', ':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests }),
    });
  }

  async function getSpreadsheetMetadata() {
    const fields = 'sheets(properties(sheetId,title,gridProperties),basicFilter,protectedRanges,conditionalFormats,bandedRanges,data(columnMetadata,rowMetadata))';
    return request<SpreadsheetMetadata>('leitura da estrutura completa', `?includeGridData=true&fields=${encodeURIComponent(fields)}`);
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

  async function ensureSpreadsheetLayout(sheetKeys: GoogleSheetKey[] = Object.keys(GOOGLE_SHEET_TABS) as GoogleSheetKey[]) {
    const metadata = await getSpreadsheetMetadata();
    const byTitle = new Map((metadata.sheets || []).map((sheet) => [sheet.properties?.title, sheet]));
    const requests: Array<Record<string, unknown>> = [];
    for (const sheetKey of sheetKeys) {
      const sheet = byTitle.get(GOOGLE_SHEET_TABS[sheetKey]);
      const sheetId = sheet?.properties?.sheetId;
      if (typeof sheetId !== 'number' || !sheet) throw new Error(`Aba ${GOOGLE_SHEET_TABS[sheetKey]} não encontrada para layout.`);
      const title = GOOGLE_SHEET_TABS[sheetKey];
      const firstColumnValues = (await getValues(`${quoteSheetTitle(title)}!A:A`)).values || [];
      const dataRowCount = Math.max(firstColumnValues.length - 1, 0);
      requests.push(...buildGoogleSheetLayoutRequests(sheetKey, sheetId, sheet, config.serviceAccountEmail, dataRowCount));
    }
    await batchUpdate(requests);
    return { sheetCount: sheetKeys.length, requestCount: requests.length };
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
    const keyIndexCacheKey = `${sheetKey}:${keyColumnIndex}`;
    let rowNumber = preferredRowNumber && preferredRowNumber >= 2 ? preferredRowNumber : null;

    if (rowNumber) {
      const validationRange = `${quoteSheetTitle(title)}!${keyColumn}${rowNumber}`;
      const currentKey = (await getValues(validationRange)).values?.[0]?.[0];
      if (normalizeComparableCell(currentKey) !== keyValue.trim()) rowNumber = null;
    }

    if (!rowNumber) {
      let keyIndex = keyIndexCache.get(keyIndexCacheKey);
      if (!keyIndex) {
        const keysRange = `${quoteSheetTitle(title)}!${keyColumn}2:${keyColumn}`;
        const keys = (await getValues(keysRange)).values || [];
        keyIndex = new Map<string, number>();
        keys.forEach((item, index) => {
          const key = normalizeComparableCell(item[0]);
          if (key && !keyIndex!.has(key)) keyIndex!.set(key, index + 2);
        });
        keyIndexCache.set(keyIndexCacheKey, keyIndex);
      }
      rowNumber = keyIndex.get(keyValue.trim()) || null;
    }

    if (rowNumber) {
      const rowRange = `${quoteSheetTitle(title)}!A${rowNumber}:${columnName(headers.length - 1)}${rowNumber}`;
      await updateValues(rowRange, [row]);
      keyIndexCache.get(keyIndexCacheKey)?.set(keyValue.trim(), rowNumber);
      return { action: 'updated' as const, rowNumber };
    }

    const appended = await appendValues(`${quoteSheetTitle(title)}!A:${columnName(headers.length - 1)}`, [row]);
    const updatedRange = appended.updates?.updatedRange || appended.updatedRange;
    const match = updatedRange?.match(/![A-Z]+(\d+)(?::|$)/);
    const appendedRowNumber = match ? Number(match[1]) : null;
    if (appendedRowNumber) keyIndexCache.get(keyIndexCacheKey)?.set(keyValue.trim(), appendedRowNumber);
    return { action: 'created' as const, rowNumber: appendedRowNumber };
  }

  async function replaceRows(sheetKey: GoogleSheetKey, rows: SheetCell[][]) {
    const headers = [...GOOGLE_SHEET_HEADERS[sheetKey]] as SheetCell[];
    if (rows.some((row) => row.length !== headers.length)) {
      throw new Error(`Resumo inválido para ${GOOGLE_SHEET_TABS[sheetKey]}.`);
    }

    const title = GOOGLE_SHEET_TABS[sheetKey];
    const endColumn = columnName(headers.length - 1);
    const fullRange = `${quoteSheetTitle(title)}!A:${endColumn}`;
    const previousRows = (await getValues(fullRange)).values || [];
    const replacement = [headers, ...rows];
    const writeRange = `${quoteSheetTitle(title)}!A1:${endColumn}${replacement.length}`;
    await updateValues(writeRange, replacement);

    const written = (await getValues(writeRange)).values || [];
    const matches = replacement.length === written.length && replacement.every((expectedRow, rowIndex) => (
      expectedRow.every((cell, columnIndex) => normalizeComparableCell(cell) === normalizeComparableCell(written[rowIndex]?.[columnIndex]))
    ));
    if (!matches) {
      throw new Error(`Verificação pós-escrita falhou na aba ${title}; a cauda anterior foi preservada.`);
    }

    if (previousRows.length > replacement.length) {
      await clearValues(`${quoteSheetTitle(title)}!A${replacement.length + 1}:${endColumn}${previousRows.length}`);
    }
    keyIndexCache.clear();
    return { rowCount: rows.length };
  }

  return {
    ensureSpreadsheetStructure,
    ensureSpreadsheetLayout,
    getSpreadsheetMetadata,
    batchUpdate,
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
      return [lot.name, lot.capacity, confirmed, reserved, Math.max(lot.capacity - occupied, 0), lot.capacity ? Number((occupied / lot.capacity * 100).toFixed(1)) : 0, googleSheetsDateSerial(now.toISOString()) || ''] as SheetCell[];
    });
    await client.replaceRows('lots', rows); return { action: 'replaced' as const, rowNumber: null };
  }

  if (task.entityType === 'partnership') {
    const lead = database.partnershipLeads.find((item) => item.id === task.entityId);
    if (!lead) throw new Error(`Parceria ${task.entityId} não encontrada.`);
    const row: SheetCell[] = [sanitizeSheetText(lead.companyName), sanitizeSheetText(lead.contactName), sanitizeSheetText(lead.contactRole), sanitizeSheetText(lead.corporateEmail), lead.status, lead.source, googleSheetsDateSerial(lead.createdAt) || '', lead.id];
    return client.upsertRow('partnerships', row, 7, lead.id, task.rowNumber);
  }

  if (task.entityType === 'email') {
    const registration = database.registrations.find((item) => item.id === task.entityId);
    if (!registration) throw new Error(`Inscrição ${task.entityId} não encontrada.`);
    const emailAt = registration.confirmationEmailSentAt || registration.confirmationEmailLastAttemptAt || registration.updatedAt;
    const row: SheetCell[] = [googleSheetsDateSerial(emailAt) || '', registration.id, sanitizeSheetText(registration.payload.email), registration.confirmationEmailSentAt ? 'enviado' : 'falhou', registration.confirmationEmailProvider || '', registration.confirmationEmailId || '', sanitizeSheetText(registration.confirmationEmailError)];
    return client.upsertRow('emails', row, 1, registration.id, task.rowNumber);
  }

  if (task.entityType === 'alert') {
    const alert = (await listOperationalAlertsInPostgres()).find((item) => item.id === task.entityId);
    if (!alert) throw new Error(`Alerta ${task.entityId} não encontrado.`);
    const row: SheetCell[] = [alert.severity, alert.alertType, sanitizeSheetText(alert.title), alert.status, alert.entityType || '', alert.acknowledgedBy || '', googleSheetsDateSerial(alert.detectedAt) || '', alert.id];
    return client.upsertRow('alerts', row, 7, alert.id, task.rowNumber);
  }

  if (task.entityType === 'remarketing') {
    const projection = buildRemarketingProjections(database).find((item) => item.personKey === task.entityId);
    if (!projection) throw new Error(`Pessoa técnica ${task.entityId} não encontrada para Remarketing.`);
    return client.upsertRow('remarketing', buildRemarketingSheetRow(projection), 0, projection.personKey, task.rowNumber);
  }

  if (task.entityType === 'confirmed_payments_projection') {
    const result = buildConfirmedPaymentsProjection(database);
    if (result.diagnostics.registrationPaidWithoutPaidPayment > 0 || result.diagnostics.paymentPaidWithoutPaidRegistration > 0) {
      console.warn(JSON.stringify({
        at: new Date().toISOString(),
        message: 'confirmed_payments_projection_mismatch',
        diagnostics: result.diagnostics,
      }));
    }
    await client.replaceRows('confirmed_payments', result.projections.map(buildConfirmedPaymentSheetRow));
    return { action: 'replaced' as const, rowNumber: null, diagnostics: result.diagnostics };
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
  synchronizeAlerts?: typeof synchronizeOperationalAlertsInPostgres;
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
    loadDatabase?: () => Promise<Database>;
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
    { entityType: 'confirmed_payments_projection', entityId: 'paid-and-paid', sheetName: 'confirmed_payments', operation: 'replace' },
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

  const remarketingTask = await queueRemarketingGoogleSheetSyncForRegistration(registrationId, {
    config,
    enqueue,
    loadDatabase: dependencies.loadDatabase,
  });
  if (remarketingTask) queued.push(remarketingTask);

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
export function queueConfirmedPaymentsProjectionGoogleSheetSync(dependencies: { config?: GoogleSheetsConfig; enqueue?: typeof enqueueGoogleSheetSync } = {}) { return queueProjection({ entityType: 'confirmed_payments_projection', entityId: 'paid-and-paid', sheetName: 'confirmed_payments', operation: 'replace' }, dependencies); }

export async function reconcileConfirmedPaymentsGoogleSheetSync(
  dependencies: { config?: GoogleSheetsConfig; enqueue?: typeof enqueueGoogleSheetSync } = {},
) {
  const config = dependencies.config || getGoogleSheetsConfig();
  if (!config.enabled || config.configurationIssue) {
    return { queued: false, enabled: config.enabled, configurationIssue: config.configurationIssue };
  }
  const task = await queueConfirmedPaymentsProjectionGoogleSheetSync(dependencies);
  return { queued: Boolean(task), task, enabled: true, configurationIssue: null };
}

export async function queueRemarketingGoogleSheetSyncForRegistration(
  registrationId: string,
  dependencies: { config?: GoogleSheetsConfig; enqueue?: typeof enqueueGoogleSheetSync; loadDatabase?: () => Promise<Database> } = {},
) {
  const config = dependencies.config || getGoogleSheetsConfig();
  if (!config.remarketingEnabled || config.configurationIssue) return null;
  try {
    const database = await (dependencies.loadDatabase || snapshot)();
    const projection = buildRemarketingProjections(database).find((item) => item.registrationIds.includes(registrationId));
    if (!projection) return null;
    return await (dependencies.enqueue || enqueueGoogleSheetSync)({
      entityType: 'remarketing', entityId: projection.personKey, sheetName: 'remarketing', operation: 'upsert',
    });
  } catch (error) {
    console.error(JSON.stringify({
      at: new Date().toISOString(), message: 'remarketing_sync_queue_failed', registrationId,
      error: error instanceof Error ? error.message.slice(0, 300) : 'Unknown error',
    }));
    return null;
  }
}

export async function reconcileRemarketingGoogleSheetSyncs(
  limit = 25,
  dependencies: { config?: GoogleSheetsConfig; enqueue?: typeof enqueueGoogleSheetSync; loadDatabase?: () => Promise<Database> } = {},
) {
  const config = dependencies.config || getGoogleSheetsConfig();
  if (!config.remarketingEnabled || config.configurationIssue) {
    return {
      candidates: 0, pendingReconciliation: 0, queued: 0, unchanged: 0, rolloutEnabled: false,
      enabled: config.enabled, configurationIssue: config.configurationIssue,
    };
  }
  const database = await (dependencies.loadDatabase || snapshot)();
  const projections = buildRemarketingProjections(database);
  const existingByPerson = new Map(database.googleSheetSyncs
    .filter((task) => task.entityType === 'remarketing')
    .map((task) => [task.entityId, task]));
  const stale = projections.filter((projection) => {
    const task = existingByPerson.get(projection.personKey);
    if (!task) return true;
    if (task.status !== 'synchronized') return false;
    return Boolean(task.synchronizedAt && task.synchronizedAt < projection.updatedAt);
  }).sort((left, right) => {
    const paidPriority = Number(right.suppressionReason === 'PAID') - Number(left.suppressionReason === 'PAID');
    return paidPriority || right.updatedAt.localeCompare(left.updatedAt) || left.personKey.localeCompare(right.personKey);
  });
  const selected = stale.slice(0, Math.min(Math.max(Math.trunc(limit), 1), 50));
  for (const projection of selected) {
    await (dependencies.enqueue || enqueueGoogleSheetSync)({
      entityType: 'remarketing', entityId: projection.personKey, sheetName: 'remarketing', operation: 'upsert',
    });
  }
  return {
    candidates: projections.length, pendingReconciliation: stale.length, queued: selected.length, unchanged: projections.length - stale.length, rolloutEnabled: true,
    enabled: config.enabled, configurationIssue: config.configurationIssue,
  };
}

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
    await (dependencies.synchronizeAlerts || synchronizeOperationalAlertsInPostgres)([{
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
    await client.ensureSpreadsheetLayout([task.sheetName]);
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
    const failure = classifyGoogleSheetSyncFailure(error);
    try {
      await fail(task.id, failure);
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
      error: failure.message.slice(0, 500),
      retryable: failure.retryable,
      elapsedMs: Date.now() - startedAt,
    }));
    return { status: 'failed' as const, retryable: failure.retryable };
  }
}

type ProcessGoogleSheetSyncBacklogDependencies = ProcessGoogleSheetSyncDependencies & {
  list?: typeof listClaimableGoogleSheetSyncs;
};

export async function processGoogleSheetSyncBacklog(
  limit = 10,
  dependencies: ProcessGoogleSheetSyncBacklogDependencies = {},
) {
  const config = dependencies.config || getGoogleSheetsConfig();
  if (!config.enabled || config.configurationIssue) {
    return {
      selected: 0, synchronized: 0, failed: 0, skipped: 0, recoveredStale: 0,
      configurationIssue: config.configurationIssue || (config.enabled ? null : 'disabled'),
    };
  }

  const candidates = await (dependencies.list || listClaimableGoogleSheetSyncs)(limit);
  if (candidates.length === 0) {
    return { selected: 0, synchronized: 0, failed: 0, skipped: 0, recoveredStale: 0, configurationIssue: null };
  }

  const database = await (dependencies.loadDatabase || snapshot)();
  const client = dependencies.client || createGoogleSheetsClient({ config });
  const counts = {
    selected: candidates.length,
    synchronized: 0,
    failed: 0,
    skipped: 0,
    recoveredStale: candidates.filter((item) => item.status === 'processing').length,
    configurationIssue: null as string | null,
  };

  for (const candidate of candidates) {
    const result = await processGoogleSheetSync(candidate.id, {
      ...dependencies,
      config,
      client,
      loadDatabase: async () => database,
    });
    if (result.status === 'synchronized') counts.synchronized += 1;
    else if (result.status === 'failed') counts.failed += 1;
    else counts.skipped += 1;
  }
  return counts;
}
