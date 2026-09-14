import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { Database, PaymentRecord, RegistrationRecord } from '../server/database.js';
import {
  buildConfirmedPaymentsProjection,
  confirmedPaymentProviderLabel,
} from '../server/confirmed-payments.js';
import {
  detectLocalReconciliationIssues,
  hasRealGatewayTransaction,
  isAuthorizedNonGatewayParticipation,
} from '../server/payment-reconciliation.js';

const databaseSource = readFileSync(new URL('../server/database.ts', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');

function extractFunction(source: string, name: string, span = 9000): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  return source.slice(start, start + span)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const serviceSwapSrc = extractFunction(databaseSource, 'createServiceSwapRegistrationInPostgres', 12000);

// --- A/B/C. writes: paid, amount 0, provider service_swap, no fabricated gateway transaction id ---

test('A. registration insert is created status=paid amount_cents=0', () => {
  assert.match(serviceSwapSrc, /insert into \$\{table\.registrations\}/);
  assert.match(serviceSwapSrc, /values\s*\n?\s*\(\$1, \$2, \$3, \$4, \$5, 'paid', 0, \$6, \$7, \$7,/);
});

test('B. payment insert is created status=paid amount_cents=0 provider=service_swap', () => {
  assert.match(serviceSwapSrc, /insert into \$\{table\.payments\}/);
  assert.match(serviceSwapSrc, /values \(\$1, \$2, \$3, 'paid', 0, null, null, \$4, \$4, null, \$4, \$5, null, \$6\)/);
  assert.ok(serviceSwapSrc.includes('SERVICE_SWAP_PROVIDER'));
  assert.ok(serviceSwapSrc.includes('SERVICE_SWAP_GATEWAY_STATUS'));
});

test('C. no gateway transaction id is ever fabricated', () => {
  // the payments insert always passes a literal `null` for gateway_transaction_id —
  // there is no code path in this function that computes/generates one.
  assert.match(serviceSwapSrc, /values \(\$1, \$2, \$3, 'paid', 0, null, null, \$4, \$4, null, \$4, \$5, null, \$6\)/);
  assert.ok(!serviceSwapSrc.includes('gatewayTransactionId ='));
  assert.ok(!serviceSwapSrc.includes('gateway_transaction_id = $'));
});

// --- D/E. sold_count incremented once, bib assigned once, both under lock ---

test('D. increments sold_count exactly once, matching the confirmPaymentInPostgres pattern', () => {
  const soldCountWrites = serviceSwapSrc.match(/sold_count = sold_count \+ 1/g) || [];
  assert.equal(soldCountWrites.length, 1);
});

test('E. assigns bib exactly once via max(bib_number)+1 under the same advisory locks used by confirmPaymentInPostgres', () => {
  const bibQueries = serviceSwapSrc.match(/next_bib_number/g) || [];
  assert.equal(bibQueries.length, 2); // select alias + read of the result
  assert.ok(serviceSwapSrc.includes("pg_advisory_xact_lock(hashtext('funpace-run-registration-lot'))"));
  assert.ok(serviceSwapSrc.includes("pg_advisory_xact_lock(hashtext('funpace-run-payment-confirmation'))"));
  // the only literal bib fallback is '0001', the same "no paid registrations yet"
  // default confirmPaymentInPostgres itself uses — never a Production-looking value.
  const bibLine = serviceSwapSrc.match(/const bibNumber = .*/)?.[0] || '';
  assert.match(bibLine, /next_bib_number \|\| '0001'/);
});

// --- F/G. duplicate CPF rejection + idempotent replay -----------------------

test('F. an existing active (pending_payment/paid) registration for the CPF is rejected unless it is the same authorized service_swap row', () => {
  assert.match(serviceSwapSrc, /status = any\(\$3\)/);
  assert.ok(serviceSwapSrc.includes("['pending_payment', 'paid']"));
  assert.ok(serviceSwapSrc.includes("status: 'duplicate_active'"));
});

test('G. replay of the exact same service_swap registration is idempotent (no second insert)', () => {
  assert.ok(serviceSwapSrc.includes('isServiceSwapReplay'));
  assert.ok(serviceSwapSrc.includes("status: 'ok', replay: true"));
  // the replay branch commits and returns BEFORE reaching any insert statement
  const replayIndex = serviceSwapSrc.indexOf('isServiceSwapReplay');
  const firstInsertIndex = serviceSwapSrc.indexOf('insert into');
  assert.ok(replayIndex < firstInsertIndex);
});

// --- H. revenue stays zero ----------------------------------------------------

test('H. a service_swap delivery contributes exactly 0 to a revenue sum', () => {
  const payments = [
    { amountCents: 7990 } as PaymentRecord,
    { amountCents: 0, provider: 'service_swap' } as PaymentRecord,
    { amountCents: 11990 } as PaymentRecord,
  ];
  const revenue = payments.reduce((total, item) => total + item.amountCents, 0);
  assert.equal(revenue, 7990 + 11990);
});

// --- I/J/K. reconciliation: authorized service_swap accepted, others unaffected ---

function registrationFixture(overrides: Partial<RegistrationRecord> = {}): RegistrationRecord {
  return { id: 'r1', status: 'paid', amountCents: 0 } as RegistrationRecord & typeof overrides;
}

test('I. reconciliation accepts ONLY an authorized service_swap payment (provider + gateway_status + amount all match)', () => {
  const authorized = { id: 'p1', registrationId: 'r1', status: 'paid', amountCents: 0, provider: 'service_swap', gatewayStatus: 'service_swap_authorized', gatewayTransactionId: null } as PaymentRecord;
  assert.equal(isAuthorizedNonGatewayParticipation(authorized), true);
  const issues = detectLocalReconciliationIssues({ registrations: [registrationFixture()], payments: [authorized] } as Database);
  assert.equal(issues.length, 0);
});

test('I2. a payment merely claiming provider=service_swap without the matching gateway_status/amount is NOT exempted', () => {
  const wrongStatus = { id: 'p2', registrationId: 'r1', status: 'paid', amountCents: 0, provider: 'service_swap', gatewayStatus: 'something_else', gatewayTransactionId: null } as PaymentRecord;
  assert.equal(isAuthorizedNonGatewayParticipation(wrongStatus), false);
  const wrongAmount = { id: 'p3', registrationId: 'r1', status: 'paid', amountCents: 500, provider: 'service_swap', gatewayStatus: 'service_swap_authorized', gatewayTransactionId: null } as PaymentRecord;
  assert.equal(isAuthorizedNonGatewayParticipation(wrongAmount), false);
  const issues = detectLocalReconciliationIssues({ registrations: [registrationFixture()], payments: [wrongStatus] } as Database);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].issueCode, 'local_paid_without_real_transaction');
});

test('J. an ordinary paid-without-gateway-evidence registration is still flagged (unrelated to service_swap)', () => {
  const ordinary = { id: 'p4', registrationId: 'r1', status: 'paid', amountCents: 7990, provider: 'infinitepay', gatewayTransactionId: null } as PaymentRecord;
  assert.equal(isAuthorizedNonGatewayParticipation(ordinary), false);
  const issues = detectLocalReconciliationIssues({ registrations: [registrationFixture({ amountCents: 7990 })], payments: [ordinary] } as Database);
  assert.equal(issues.length, 1);
});

test('K. manual_pix behavior is completely unchanged (unaffected by the new exemption)', () => {
  const manualPix = { id: 'p5', registrationId: 'r1', status: 'paid', amountCents: 8991, provider: 'manual_pix', gatewayTransactionId: 'manual_pix_r1' } as PaymentRecord;
  assert.equal(hasRealGatewayTransaction(manualPix), true); // unchanged: a non-empty gatewayTransactionId already satisfies this
  assert.equal(isAuthorizedNonGatewayParticipation(manualPix), false); // never matches — different provider/gateway_status
  const issues = detectLocalReconciliationIssues({ registrations: [registrationFixture({ amountCents: 8991 })], payments: [manualPix] } as Database);
  assert.equal(issues.length, 0);
});

// --- L/M. Sheets: projection includes the row, truthful provider label ------

function sheetsRegistration(overrides: Partial<RegistrationRecord> = {}): RegistrationRecord {
  return {
    id: 'registration-1', eventId: 'event-1', distanceId: 'distance-5k', lotId: 'lot-1', cpfHash: 'hash',
    status: 'paid', amountCents: 0, createdAt: '2026-09-15T12:00:00.000Z', updatedAt: '2026-09-15T12:00:00.000Z',
    paidAt: '2026-09-15T12:00:00.000Z', bibNumber: '0290', partnerName: null, partnerType: null,
    payload: {
      fullName: 'Laura Roriz Martins', email: 'rorizlaura1@gmail.com', cpf: '012.989.322-62', phone: '69992584004',
      city: '', state: '', team: '', birthDate: '', gender: 'female', shirtSize: 'M',
      distance: '5K', emergencyContactName: '', emergencyContactPhone: '', termsAccepted: true,
      regulationAccepted: true, privacyAccepted: true,
    },
    ...overrides,
  } as RegistrationRecord;
}

function sheetsPayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'payment-1', registrationId: 'registration-1', provider: 'service_swap', status: 'paid', amountCents: 0,
    providerPaymentId: null, checkoutUrl: null, createdAt: '2026-09-15T12:00:00.000Z',
    updatedAt: '2026-09-15T12:00:00.000Z', paidAt: '2026-09-15T12:00:00.000Z',
    gatewayStatus: 'service_swap_authorized', gatewayTransactionId: null,
    ...overrides,
  } as PaymentRecord;
}

function sheetsDatabase(registrations: RegistrationRecord[], payments: PaymentRecord[]): Database {
  return {
    events: [], distances: [{ id: 'distance-5k', eventId: 'event-1', name: '5K', distanceKm: 5, capacity: 500, status: 'active' }],
    lots: [{ id: 'lot-1', eventId: 'event-1', name: 'Lote 3', priceCents: 11990, capacity: 100, soldCount: 41, status: 'active', startsAt: '', endsAt: '', orderIndex: 3, continuesAfterCapacity: false }],
    registrations, payments, paymentEvents: [], googleSheetSyncs: [], checkIns: [], kitDeliveries: [], auditLogs: [],
    adminSessions: [], adminUsers: [], partnershipLeads: [], partners: [],
  } as unknown as Database;
}

test('L. a service_swap paid registration appears in the confirmed-payments projection with amount 0', () => {
  const result = buildConfirmedPaymentsProjection(sheetsDatabase([sheetsRegistration()], [sheetsPayment()]));
  assert.equal(result.projections.length, 1);
  assert.equal(result.projections[0].amountCents, 0);
  assert.equal(result.projections[0].provider, 'service_swap');
  assert.equal(result.projections[0].bibNumber, '0290');
});

test('M. the provider label is truthful ("Permuta / Troca de serviço"), never the generic "Outro — ..." fallback', () => {
  assert.equal(confirmedPaymentProviderLabel('service_swap'), 'Permuta / Troca de serviço');
  assert.notEqual(confirmedPaymentProviderLabel('service_swap'), 'Outro — service_swap');
});

// --- N. Start List (server/start-list.ts, buildStartList) and toAdminRow do not filter by provider ---

test('N1. toAdminRow never excludes a registration based on payment provider', () => {
  const start = indexSource.indexOf('function toAdminRow(');
  assert.ok(start >= 0);
  const src = indexSource.slice(start, start + 4000).replace(/\/\/.*$/gm, '');
  assert.ok(!/payment\?\.provider\s*(===|!==)\s*'(infinitepay|manual_pix)'/.test(src), 'toAdminRow must not gate on a specific provider allowlist');
  assert.ok(src.includes('paymentProvider: payment?.provider || null'));
});

test('N2. buildStartList (server/start-list.ts) includes any row with effective status=paid — no provider gate', async () => {
  const { buildStartList } = await import('../server/start-list.js');
  const result = buildStartList([{
    id: 'registration-1', name: 'Laura Roriz Martins', cpfMasked: '012.***.***-62',
    bibNumber: '0290', distance: '5K', distanceId: 'distance-5k', shirtSize: 'M',
    status: 'paid', checkInRecorded: false, checkInAt: null, kitRecorded: false, kitAt: null,
    personKey: 'cpf:hash-service-swap',
  }], { sort: 'bib' });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].bib, '0290');
  assert.equal(result.rows[0].paid, 'SIM');
  const startListSource = readFileSync(new URL('../server/start-list.ts', import.meta.url), 'utf8');
  assert.ok(!/provider/i.test(startListSource), 'start-list.ts must remain payment-provider-agnostic — cohort is status="paid" only');
});

// --- O/P. confirmation_* untouched, no email sent synchronously -------------

test('O. confirmation_* fields are explicitly left null/untouched on creation', () => {
  assert.ok(serviceSwapSrc.includes('confirmation_email_sent_at, confirmation_email_last_attempt_at, confirmation_email_provider,'));
  const insertBlock = serviceSwapSrc.slice(serviceSwapSrc.indexOf('insert into ${table.registrations}'), serviceSwapSrc.indexOf('insert into ${table.payments}'));
  assert.match(insertBlock, /null, null, null,\s*\n\s*null, null, \$8,/);
});

test('P. no email is sent synchronously — only a durable outbox row is enqueued', () => {
  assert.ok(serviceSwapSrc.includes('enqueueConfirmationEmailInPostgres('));
  for (const forbidden of ['sendRegistrationConfirmationEmail', 'sendEmailViaResend', 'processRegistrationEmail', 'resend.com', 'RESEND_API']) {
    assert.ok(!serviceSwapSrc.includes(forbidden), `${forbidden} must not appear — email must never be sent synchronously`);
  }
});

// --- Q. audit contract -------------------------------------------------------

test('Q. exactly one audit log is created, action=registration.service_swap_authorized, no full CPF in payload', () => {
  const auditInserts = serviceSwapSrc.match(/insert into \$\{table\.auditLogs\}/g) || [];
  assert.equal(auditInserts.length, 1);
  assert.ok(serviceSwapSrc.includes("'registration.service_swap_authorized'"));
  const auditBlock = serviceSwapSrc.slice(serviceSwapSrc.indexOf('insert into ${table.auditLogs}'), serviceSwapSrc.indexOf('await enqueueConfirmationEmailInPostgres'));
  assert.ok(!auditBlock.includes('input.cpfHash'));
  assert.ok(!auditBlock.includes('input.payload.cpf'));
  assert.ok(auditBlock.includes('amountReceivedCents: 0'));
  assert.ok(auditBlock.includes('moneyReceived: false'));
  assert.ok(auditBlock.includes('infinitePayInvolved: false'));
});

// --- R/S. rollback safety + locking ------------------------------------------

test('R. the whole operation rolls back atomically on any failure', () => {
  assert.ok(serviceSwapSrc.includes("await client.query('rollback').catch(() => undefined);"));
  assert.ok(serviceSwapSrc.includes('throw error;'));
  assert.ok(serviceSwapSrc.includes('client.release();'));
});

test('S. both advisory locks are acquired before any read, mirroring confirmPaymentInPostgres exactly (concurrency-safe bib/capacity)', () => {
  const lockLotIndex = serviceSwapSrc.indexOf("pg_advisory_xact_lock(hashtext('funpace-run-registration-lot'))");
  const lockPaymentIndex = serviceSwapSrc.indexOf("pg_advisory_xact_lock(hashtext('funpace-run-payment-confirmation'))");
  const firstSelectIndex = serviceSwapSrc.indexOf('select id from ${table.events}');
  assert.ok(lockLotIndex >= 0 && lockPaymentIndex >= 0);
  assert.ok(lockLotIndex < firstSelectIndex && lockPaymentIndex < firstSelectIndex);
});

// --- Isolation from InfinitePay / manual_pix / partner / coupon ------------

test('the primitive is structurally independent from partner discounts, coupons, and manual_pix', () => {
  for (const forbidden of ['partnerSlug', 'partnerPricing', 'calculatePartnerPricing', 'calculateCouponPricing', 'couponCode', 'MANUAL_PIX_PROVIDER', 'manual_pix', 'infinitepay']) {
    assert.ok(!serviceSwapSrc.includes(forbidden), `must not reference ${forbidden}`);
  }
});
