import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database, EventRecord, PaymentEventRecord, PaymentRecord, RegistrationRecord } from '../server/database';
import { buildExecutiveDashboard } from '../server/operational-intelligence';

/**
 * ADMIN-002 Stage 5B — parity oracle.
 *
 * The lean 'admin-dashboard' read drops audit-logs / email-deliveries /
 * google-sheet-sync and stops materialising raw jsonb (full registration
 * payload, meta_context, gateway_payload, payment-event payload). This proves
 * the executive dashboard output is IDENTICAL whether it is built from a full
 * database or from the lean shape — i.e. no metric depends on the dropped data.
 *
 * alerts / reconciliation are intentionally out of scope (removed from the
 * contract by the Stage 5B Human Gate).
 */

const NOW = new Date('2026-08-26T15:00:00.000Z'); // Wed 11:00 America/Porto_Velho

const event = (id: string, slug: string): EventRecord => ({
  id, name: `Event ${id}`, slug, status: 'published', date: '2026-09-20',
  startTime: '06:00', locationName: 'Arena', city: 'Porto Velho', state: 'RO',
});

const FULL_PAYLOAD_EXTRA = {
  fullName: 'Fulano Sintetico da Silva',
  email: 'fulano@example.test',
  phone: '+55 69 99999-0000',
  cpf: '000.000.000-00',
  address: { street: 'Rua Teste', number: '100', zip: '76800-000' },
  emergencyContact: { name: 'Beltrano', phone: '+55 69 98888-0000' },
};

const reg = (
  id: string,
  eventId: string,
  status: RegistrationRecord['status'],
  o: Partial<RegistrationRecord> & { city?: string; gender?: string; shirt?: string; distance?: string; utmSource?: string; utmCampaign?: string } = {},
): RegistrationRecord => ({
  id, eventId, distanceId: `${eventId}-d`, lotId: `${eventId}-l`,
  cpfHash: o.cpfHash || `cpf-${id}`, status, amountCents: o.amountCents ?? 10_000,
  payload: {
    city: o.city || 'Porto Velho', state: 'RO', gender: o.gender || 'female',
    shirtSize: o.shirt || 'M', distance: o.distance || '5K', birthDate: '1996-01-01',
    attribution: { utmSource: o.utmSource || 'instagram', utmCampaign: o.utmCampaign || 'lancamento', source: o.utmSource || 'instagram' },
  } as RegistrationRecord['payload'],
  createdAt: o.createdAt || '2026-08-20T09:00:00.000Z',
  updatedAt: o.updatedAt || '2026-08-20T09:00:00.000Z',
  paidAt: o.paidAt, confirmedAt: o.confirmedAt, expiresAt: o.expiresAt,
  confirmationEmailSentAt: o.confirmationEmailSentAt, confirmationEmailError: o.confirmationEmailError,
});

const pay = (id: string, registrationId: string, o: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id, registrationId, provider: o.provider || 'infinitepay', status: o.status || 'paid',
  amountCents: o.amountCents ?? 10_000, providerPaymentId: o.providerPaymentId ?? id,
  checkoutUrl: o.checkoutUrl === undefined ? `https://checkout/${id}` : o.checkoutUrl,
  gatewayTransactionId: null, createdAt: '2026-08-20T09:01:00.000Z', updatedAt: o.updatedAt || '2026-08-20T09:02:00.000Z',
  paidAt: o.paidAt ?? '2026-08-20T09:02:00.000Z', gatewayStatus: o.gatewayStatus ?? 'paid',
});

const pe = (id: string, paymentId: string, eventType: string, receivedAt: string): PaymentEventRecord => ({
  id, paymentId, providerEventId: `nsu-${id}`, eventType, receivedAt, payload: {},
});

function baseDatabase(overrides: Partial<Database>): Database {
  return {
    events: [], distances: [
      { id: 'A-d', eventId: 'A', name: '5K', distanceKm: 5, capacity: 1000, status: 'active' },
      { id: 'B-d', eventId: 'B', name: '10K', distanceKm: 10, capacity: 1000, status: 'active' },
    ],
    lots: [
      { id: 'A-l', eventId: 'A', name: 'Lote A', priceCents: 10_000, capacity: 1000, soldCount: 0, status: 'active', startsAt: '', endsAt: '', orderIndex: 1, continuesAfterCapacity: false },
      { id: 'B-l', eventId: 'B', name: 'Lote B', priceCents: 20_000, capacity: 1000, soldCount: 0, status: 'active', startsAt: '', endsAt: '', orderIndex: 1, continuesAfterCapacity: false },
    ],
    registrations: [], payments: [], paymentEvents: [], emailDeliveries: [], googleSheetSyncs: [],
    checkIns: [], kitDeliveries: [], auditLogs: [], adminSessions: [], adminUsers: [],
    partnershipLeads: [], partners: [], ...overrides,
  };
}

/** full DB: raw payload extras, meta_context, gateway_payload, pe.payload, + dead tables populated. */
function toFull(base: Database): Database {
  return {
    ...base,
    registrations: base.registrations.map((r) => ({
      ...r,
      payload: { ...r.payload, ...FULL_PAYLOAD_EXTRA } as RegistrationRecord['payload'],
      metaContext: { fbp: 'fb.1.x', fbc: 'fb.1.y', ip: '203.0.113.1', ua: 'Mozilla/5.0' },
    })),
    payments: base.payments.map((p) => ({ ...p, gatewayPayload: { customer: FULL_PAYLOAD_EXTRA, raw: { a: 1, b: [1, 2, 3] } } })),
    paymentEvents: base.paymentEvents.map((e) => ({ ...e, payload: { customer: FULL_PAYLOAD_EXTRA, card: { holder: 'Fulano' } } })),
    auditLogs: [
      { id: 'al1', actor: 'system', action: 'payment.webhook_processed', entityType: 'registration', entityId: base.registrations[0]?.id || 'x', payload: { big: 'x'.repeat(500) }, createdAt: '2026-08-20T09:03:00.000Z' } as never,
    ],
    emailDeliveries: [
      { id: 'ed1', registrationId: base.registrations[0]?.id || 'x', kind: 'confirmation', recipientEmail: 'fulano@example.test', recipientHash: 'a'.repeat(64), contextKey: 'k', idempotencyKey: 'i', provider: 'resend', providerMessageId: 'm', status: 'sent', attemptCount: 1, attemptedAt: '', sentAt: '2026-08-20T09:04:00.000Z', failedAt: null, error: null, metadata: {}, createdAt: '', updatedAt: '' } as never,
    ],
    googleSheetSyncs: [
      { id: 'gs1', entityType: 'registration', entityId: base.registrations[0]?.id || 'x', sheetName: 'registrations', operation: 'upsert', status: 'synchronized', rowNumber: 2, attempts: 1, lastAttemptAt: '', synchronizedAt: '2026-08-20T09:05:00.000Z', lastError: null, createdAt: '', updatedAt: '' } as never,
    ],
  };
}

/** lean DB: exactly what the 'admin-dashboard' SELECT would yield. */
function toLean(base: Database): Database {
  return {
    ...base,
    registrations: base.registrations.map((r) => ({
      ...r,
      // allow-listed payload slice only; metaContext -> {} (map default)
      payload: {
        city: r.payload.city, state: r.payload.state, gender: r.payload.gender,
        shirtSize: r.payload.shirtSize, distance: r.payload.distance, birthDate: r.payload.birthDate,
        attribution: r.payload.attribution,
      } as RegistrationRecord['payload'],
      metaContext: {},
    })),
    payments: base.payments.map((p) => ({ ...p, gatewayPayload: undefined })),
    paymentEvents: base.paymentEvents.map((e) => ({ ...e, payload: undefined as never })),
    auditLogs: [], emailDeliveries: [], googleSheetSyncs: [],
  };
}

const strip = (dashboard: ReturnType<typeof buildExecutiveDashboard>) => {
  const { generatedAt, ...rest } = dashboard as Record<string, unknown>;
  void generatedAt;
  return rest;
};

function assertParity(base: Database, eventId: string, label: string) {
  const full = strip(buildExecutiveDashboard(toFull(base), NOW, { eventId }));
  const lean = strip(buildExecutiveDashboard(toLean(base), NOW, { eventId }));
  assert.deepEqual(lean, full, `${label}: lean read == full read`);
}

test('parity — single event, mixed statuses, marketing, shirts, lots, tz-boundary paidAt', () => {
  const base = baseDatabase({
    events: [event('A', 'a')],
    registrations: [
      reg('a1', 'A', 'paid', { cpfHash: 'p1', shirt: 'P', paidAt: '2026-08-24T05:00:00.000Z' }), // Mon local
      reg('a2', 'A', 'paid', { cpfHash: 'p2', shirt: 'GG', gender: 'male', paidAt: '2026-08-26T02:00:00.000Z' }), // local 08-25 22:00
      reg('a3', 'A', 'paid', { cpfHash: 'p3', utmSource: 'google', utmCampaign: 'search', paidAt: '2026-08-26T14:00:00.000Z' }),
      reg('a4', 'A', 'expired', { cpfHash: 'p4' }),
      reg('a5', 'A', 'cancelled', { cpfHash: 'p5' }),
      reg('a6', 'A', 'pending_payment', { cpfHash: 'p6', expiresAt: '2026-08-27T00:00:00.000Z' }),
    ],
    payments: [
      pay('pa1', 'a1'), pay('pa2', 'a2'), pay('pa3', 'a3'),
      pay('pa4', 'a4', { status: 'expired' }),
      pay('pa-manual', 'a1', { status: 'paid', provider: 'manual_pix', providerPaymentId: null, checkoutUrl: null, gatewayStatus: 'manual_reconciled_paid' }),
    ],
    paymentEvents: [
      pe('e1', 'pa1', 'infinitepay.checkout_created', '2026-08-24T04:59:00.000Z'),
      pe('e2', 'pa1', 'infinitepay.payment_status_changed', '2026-08-24T05:00:00.000Z'),
      pe('e3', 'pa3', 'infinitepay.checkout_created', '2026-08-26T13:00:00.000Z'),
    ],
  });
  assertParity(base, 'A', 'single event');
});

test('parity — two events, same cpf_hash across both, no cross contamination', () => {
  const base = baseDatabase({
    events: [event('A', 'a'), event('B', 'b')],
    registrations: [
      reg('a1', 'A', 'paid', { cpfHash: 'shared', paidAt: '2026-08-25T12:00:00.000Z' }),
      reg('a2', 'A', 'paid', { cpfHash: 'only-a', paidAt: '2026-08-25T13:00:00.000Z' }),
      reg('b1', 'B', 'paid', { cpfHash: 'shared', amountCents: 20_000, paidAt: '2026-08-25T12:30:00.000Z' }),
      reg('b2', 'B', 'expired', { cpfHash: 'only-b' }),
    ],
    payments: [pay('pa1', 'a1'), pay('pa2', 'a2'), pay('pb1', 'b1', { amountCents: 20_000 })],
    paymentEvents: [pe('e1', 'pa1', 'infinitepay.checkout_created', '2026-08-25T11:00:00.000Z')],
  });
  assertParity(base, 'A', 'two events / A');
  assertParity(base, 'B', 'two events / B');
});

test('parity — no paid registrations', () => {
  const base = baseDatabase({
    events: [event('A', 'a')],
    registrations: [reg('a1', 'A', 'expired'), reg('a2', 'A', 'cancelled')],
    payments: [pay('pa1', 'a1', { status: 'expired' })],
  });
  assertParity(base, 'A', 'no paid');
});

test('parity + no pathological failure — ~10k registrations deterministic fixture', () => {
  const N = Number(process.env.PARITY_FIXTURE_SIZE || 10_000);
  const registrations: RegistrationRecord[] = [];
  const payments: PaymentRecord[] = [];
  const paymentEvents: PaymentEventRecord[] = [];
  const cities = ['Porto Velho', 'Ji-Parana', 'Ariquemes', 'Cacoal', 'Vilhena'];
  const shirts = ['P', 'M', 'G', 'GG', 'XG'];
  const utms = ['instagram', 'google', 'facebook', 'whatsapp', 'direct'];
  for (let i = 0; i < N; i += 1) {
    const status = i % 100 < 42 ? 'paid' : i % 100 < 78 ? 'expired' : 'cancelled';
    const paidAt = status === 'paid' ? `2026-08-${String(10 + (i % 16)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:30:00.000Z` : undefined;
    registrations.push(reg(`r${i}`, 'A', status, {
      cpfHash: `person-${i % Math.ceil(N * 0.7)}`, amountCents: 9_000 + (i % 5) * 1000,
      city: cities[i % 5], shirt: shirts[i % 5], gender: i % 2 ? 'male' : 'female',
      utmSource: utms[i % 5], utmCampaign: `c${i % 7}`, paidAt, confirmedAt: paidAt,
      confirmationEmailSentAt: paidAt && i % 9 ? paidAt : undefined,
    }));
    if (status === 'paid') {
      const artefactless = i % 11 === 0;
      payments.push(pay(`p${i}`, `r${i}`, {
        amountCents: 9_000 + (i % 5) * 1000, paidAt,
        provider: artefactless ? 'manual_pix' : 'infinitepay',
        providerPaymentId: artefactless ? null : `pp${i}`,
        checkoutUrl: artefactless ? null : `https://checkout/${i}`,
      }));
      if (!artefactless && i % 3 === 0) paymentEvents.push(pe(`e${i}`, `p${i}`, 'infinitepay.checkout_created', `2026-08-${String(10 + (i % 16)).padStart(2, '0')}T08:00:00.000Z`));
      if (i % 5 === 0) paymentEvents.push(pe(`w${i}`, `p${i}`, 'infinitepay.payment_status_changed', `2026-08-${String(10 + (i % 16)).padStart(2, '0')}T09:00:00.000Z`));
    }
  }
  const base = baseDatabase({ events: [event('A', 'a')], registrations, payments, paymentEvents });

  const started = process.hrtime.bigint();
  const full = strip(buildExecutiveDashboard(toFull(base), NOW, { eventId: 'A' }));
  const lean = strip(buildExecutiveDashboard(toLean(base), NOW, { eventId: 'A' }));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.deepEqual(lean, full, `${N}-row fixture: lean == full`);
  // determinism: a second build yields byte-identical output
  assert.deepEqual(strip(buildExecutiveDashboard(toLean(base), NOW, { eventId: 'A' })), lean, 'deterministic');
  // sanity: the numbers are non-trivial and internally consistent
  const f = full as { financial: Record<string, number>; registrations: Record<string, number> };
  assert.ok(f.financial.grossRevenueCents > 0);
  assert.ok(f.registrations.paidRegistrationRows > 0 && f.registrations.paidRegistrationRows <= N);
  assert.ok(f.registrations.uniquePeople <= f.registrations.registrationRows);
  assert.ok(elapsedMs < 8_000, `two full builds under 8s (was ${elapsedMs.toFixed(0)}ms)`);
});
