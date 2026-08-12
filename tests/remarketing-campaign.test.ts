import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AuditLogRecord, Database, PaymentRecord, RegistrationRecord } from '../server/database.js';
import { getCouponCampaignAttribution } from '../server/coupons.js';
import {
  buildCouponCampaignAuditPayload,
  isVolta10RemarketingAttribution,
  summarizeVolta10RemarketingCampaign,
  VOLTA10_REMARKETING_CAMPAIGN,
} from '../server/remarketing-campaign.js';
import { buildRemarketingProjections } from '../server/remarketing.js';

const NOW = '2026-08-10T12:00:00.000Z';

function registration(id: string, overrides: Partial<RegistrationRecord> = {}): RegistrationRecord {
  return {
    id,
    eventId: 'event',
    distanceId: 'distance',
    lotId: 'lot',
    cpfHash: `cpf-${id}`,
    status: 'pending_payment',
    amountCents: 8_991,
    originalPriceCents: 9_990,
    finalPriceCents: 8_991,
    discountPercentage: 10,
    discountAmountCents: 999,
    couponCode: 'VOLTA10',
    couponAppliedAt: NOW,
    payload: {
      fullName: `Pessoa ${id}`, email: `${id}@mail.test.br`, cpf: '12345678901', phone: '69999999999',
      city: 'Porto Velho', state: 'RO', team: '', birthDate: '1990-01-01', gender: 'female', shirtSize: 'M', distance: '5K',
      emergencyContactName: 'Contato', emergencyContactPhone: '69988888888', termsAccepted: true, regulationAccepted: true, privacyAccepted: true,
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function payment(registrationId: string, paid = false): PaymentRecord {
  return {
    id: `payment-${registrationId}`, registrationId, provider: 'infinitepay', status: paid ? 'paid' : 'pending_payment', amountCents: 8_991,
    providerPaymentId: `checkout-${registrationId}`, checkoutUrl: `https://checkout.test/${registrationId}`,
    createdAt: NOW, updatedAt: NOW, paidAt: paid ? NOW : null, expiresAt: '2026-08-20T00:00:00.000Z',
  };
}

function audit(action: string, entityId: string, personKey: string): AuditLogRecord {
  return {
    id: `${action}-${entityId}`, actor: 'system', action, entityType: 'registration', entityId,
    payload: { campaign: VOLTA10_REMARKETING_CAMPAIGN, source: 'whatsapp', personKey }, createdAt: NOW,
  };
}

function database(registrations: RegistrationRecord[], payments: PaymentRecord[], auditLogs: AuditLogRecord[] = []): Database {
  return {
    events: [], distances: [{ id: 'distance', eventId: 'event', name: '5K', distanceKm: 5, capacity: 100, status: 'active' }],
    lots: [{ id: 'lot', eventId: 'event', name: 'Lote', priceCents: 9_990, capacity: 100, soldCount: 0, status: 'active', startsAt: NOW, endsAt: NOW, orderIndex: 1, continuesAfterCapacity: false }],
    registrations, payments, paymentEvents: [], googleSheetSyncs: [], checkIns: [], kitDeliveries: [], auditLogs,
    adminSessions: [], adminUsers: [], partnershipLeads: [], partners: [],
  };
}

test('VOLTA10 has canonical server-side WhatsApp campaign attribution', () => {
  assert.deepEqual(getCouponCampaignAttribution(' volta10 '), { campaign: VOLTA10_REMARKETING_CAMPAIGN, source: 'whatsapp' });
  assert.deepEqual(buildCouponCampaignAuditPayload('Volta10'), { campaign: VOLTA10_REMARKETING_CAMPAIGN, source: 'whatsapp' });
  assert.equal(getCouponCampaignAttribution('unknown'), null);
});

test('checkout return requires the exact campaign and never requires exposing the coupon', () => {
  assert.equal(isVolta10RemarketingAttribution({ lastTouch: { utmCampaign: VOLTA10_REMARKETING_CAMPAIGN, utmSource: 'whatsapp' } }), true);
  assert.equal(isVolta10RemarketingAttribution({ utmCampaign: VOLTA10_REMARKETING_CAMPAIGN.toUpperCase() }), true);
  assert.equal(isVolta10RemarketingAttribution({ utmCampaign: 'other_campaign' }), false);
  assert.equal(isVolta10RemarketingAttribution(undefined), false);
});

test('Postgres checkout return uses a narrow idempotent audit insert instead of full database persistence', () => {
  const serverSource = readFileSync('server/index.ts', 'utf8');
  const databaseSource = readFileSync('server/database.ts', 'utf8');
  const handler = serverSource.slice(
    serverSource.indexOf('async function recordRemarketingCheckoutReturn'),
    serverSource.indexOf('async function handleCreateRegistration'),
  );
  const directWriter = databaseSource.slice(
    databaseSource.indexOf('export async function appendRemarketingCheckoutReturnInPostgres'),
    databaseSource.indexOf('export async function findPartnerRegistrationBySessionInPostgres'),
  );

  assert.match(handler, /if \(usesPostgresDatabase\(\)\)[\s\S]*appendRemarketingCheckoutReturnInPostgres/);
  assert.match(directWriter, /insert into \$\{table\.auditLogs\}/);
  assert.match(directWriter, /where not exists/);
  assert.match(directWriter, /remarketing-checkout-return:/);
  assert.doesNotMatch(directWriter, /savePostgresDatabase|funpace-run-write/);
});

test('campaign funnel deduplicates people and sums only legitimately paid coupon snapshots', () => {
  const pending = registration('pending', {
    amountCents: 9_990, finalPriceCents: 9_990, discountPercentage: 0, discountAmountCents: 0,
    couponCode: null, couponAppliedAt: null,
  });
  const paid = registration('paid', { status: 'paid', paidAt: NOW, confirmedAt: NOW, couponUsedAt: NOW });
  const db = database([pending, paid], [payment(pending.id), payment(paid.id, true)]);
  const projections = buildRemarketingProjections(db);
  const pendingKey = projections.find((item) => item.registrationIds.includes(pending.id))!.personKey;
  const paidKey = projections.find((item) => item.registrationIds.includes(paid.id))!.personKey;
  db.auditLogs.push(
    audit('remarketing.eligible', paid.id, paidKey),
    audit('remarketing.message_sent', paid.id, paidKey),
    audit('remarketing.message_sent', paid.id, paidKey),
    audit('remarketing.checkout_returned', paid.id, paidKey),
    audit('remarketing.eligible', pending.id, pendingKey),
    audit('coupon.applied', pending.id, pendingKey),
  );

  assert.deepEqual(summarizeVolta10RemarketingCampaign(db), {
    campaign: VOLTA10_REMARKETING_CAMPAIGN,
    source: 'whatsapp',
    eligible: 2,
    currentlyEligible: 1,
    messagesSent: 1,
    checkoutReturns: 1,
    couponApplied: 2,
    paymentsConfirmed: 1,
    recoveredRevenueCents: 8_991,
    totalDiscountCents: 999,
    conversionRate: 100,
  });
});
