import type { AuditLogRecord, Database, RegistrationRecord } from './database.js';
import { getCouponCampaignAttribution } from './coupons.js';
import { buildRemarketingProjections, type RemarketingProjection } from './remarketing.js';

export const VOLTA10_REMARKETING_CAMPAIGN = 'whatsapp_remarketing_volta10';
export const VOLTA10_REMARKETING_SOURCE = 'whatsapp';
export const REMARKETING_CAMPAIGN_EVENTS = ['eligible', 'message_sent'] as const;
export type RemarketingCampaignManualEvent = typeof REMARKETING_CAMPAIGN_EVENTS[number];

function normalize(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 120) : '';
}

export function isVolta10RemarketingAttribution(attribution: RegistrationRecord['payload']['attribution']) {
  if (!attribution) return false;
  const campaign = normalize(attribution.lastTouch?.utmCampaign || attribution.utmCampaign || attribution.campaign);
  return campaign === VOLTA10_REMARKETING_CAMPAIGN;
}

export function buildCouponCampaignAuditPayload(couponCode: unknown) {
  return getCouponCampaignAttribution(couponCode) || {};
}

function auditPayload(log: AuditLogRecord) {
  return log.payload && typeof log.payload === 'object' ? log.payload as Record<string, unknown> : {};
}

function isCampaignLog(log: AuditLogRecord, action: string) {
  return log.action === action && normalize(auditPayload(log).campaign) === VOLTA10_REMARKETING_CAMPAIGN;
}

function projectionIndex(projections: RemarketingProjection[]) {
  const byRegistration = new Map<string, RemarketingProjection>();
  for (const projection of projections) {
    for (const registrationId of projection.registrationIds) byRegistration.set(registrationId, projection);
  }
  return byRegistration;
}

function personKeyForLog(log: AuditLogRecord, byRegistration: Map<string, RemarketingProjection>) {
  const explicit = auditPayload(log).personKey;
  if (typeof explicit === 'string' && explicit.startsWith('rmk_')) return explicit;
  return byRegistration.get(log.entityId)?.personKey || '';
}

function personKeysForLogs(logs: AuditLogRecord[], action: string, byRegistration: Map<string, RemarketingProjection>) {
  return new Set(logs
    .filter((log) => isCampaignLog(log, action))
    .map((log) => personKeyForLog(log, byRegistration))
    .filter(Boolean));
}

export function summarizeVolta10RemarketingCampaign(database: Pick<Database,
  'registrations' | 'payments' | 'distances' | 'lots' | 'auditLogs'>) {
  const projections = buildRemarketingProjections(database);
  const byRegistration = projectionIndex(projections);
  const eligibleSnapshot = personKeysForLogs(database.auditLogs, 'remarketing.eligible', byRegistration);
  const currentEligible = new Set(projections.filter((item) => item.eligible).map((item) => item.personKey));
  const eligible = new Set([...eligibleSnapshot, ...currentEligible]);
  const messagesSent = personKeysForLogs(database.auditLogs, 'remarketing.message_sent', byRegistration);
  const checkoutReturns = personKeysForLogs(database.auditLogs, 'remarketing.checkout_returned', byRegistration);
  const couponRegistrations = database.registrations.filter((registration) => (
    getCouponCampaignAttribution(registration.couponCode)?.campaign === VOLTA10_REMARKETING_CAMPAIGN
  ));
  const couponApplied = new Set([
    ...personKeysForLogs(database.auditLogs, 'coupon.applied', byRegistration),
    ...couponRegistrations
    .map((registration) => byRegistration.get(registration.id)?.personKey)
    .filter((value): value is string => Boolean(value)),
  ]);
  const paidRegistrations = couponRegistrations.filter((registration) => (
    registration.status === 'paid' || Boolean(registration.paidAt) || Boolean(registration.confirmedAt)
  ));
  const paymentsConfirmed = new Set(paidRegistrations
    .map((registration) => byRegistration.get(registration.id)?.personKey)
    .filter((value): value is string => Boolean(value)));
  const recoveredRevenueCents = paidRegistrations.reduce((total, item) => total + item.amountCents, 0);
  const totalDiscountCents = paidRegistrations.reduce((total, item) => total + (item.discountAmountCents || 0), 0);

  return {
    campaign: VOLTA10_REMARKETING_CAMPAIGN,
    source: VOLTA10_REMARKETING_SOURCE,
    eligible: eligible.size,
    currentlyEligible: currentEligible.size,
    messagesSent: messagesSent.size,
    checkoutReturns: checkoutReturns.size,
    couponApplied: couponApplied.size,
    paymentsConfirmed: paymentsConfirmed.size,
    recoveredRevenueCents,
    totalDiscountCents,
    conversionRate: messagesSent.size > 0 ? Number(((paymentsConfirmed.size / messagesSent.size) * 100).toFixed(2)) : 0,
  };
}

export function selectCampaignProjections(
  database: Pick<Database, 'registrations' | 'payments' | 'distances' | 'lots' | 'auditLogs'>,
  registrationIds?: string[],
) {
  const projections = buildRemarketingProjections(database).filter((item) => item.eligible);
  if (!registrationIds?.length) return projections;
  const requested = new Set(registrationIds);
  return projections.filter((projection) => projection.registrationIds.some((id) => requested.has(id)));
}
