import type { Database, PaymentEventRecord, PaymentRecord, RegistrationRecord } from './database.js';
import { BUSINESS_TIMEZONE, businessDateKey, businessTodayKey, businessWeekStart } from './business-time.js';

/**
 * ADMIN-002 — SINGLE EXECUTIVE METRIC ENGINE.
 *
 * This module is the ONLY authority for the executive dashboard business
 * numbers: revenue, participant conversion, checkout conversion and the
 * people-vs-rows distinction. `buildExecutiveDashboard` (operational-intelligence)
 * and `handleAdminSummary` (index) both consume it — no parallel formulas.
 *
 * Business decisions ratified by the ADMIN-002 Human Business Gate:
 *  - Primary conversion = unique paid people / unique people who registered.
 *  - Checkout conversion is a SEPARATE metric over the checkout population only.
 *  - "Receita líquida" is not a valid metric today: we expose grossRevenueCents
 *    and confirmedRevenueCents, never a fabricated net.
 *  - People (deduplicated) and registration rows are distinct numbers.
 *  - Percentages use one rule: one decimal place.
 *  - Stage 2: "today" and "this week" are read in America/Porto_Velho
 *    (calendar day; calendar week starting Monday, week-to-date) via the
 *    shared `business-time` authority. UTC is never reinterpreted for buckets.
 */

/** Re-exported for convenience; the canonical home is ./business-time.ts. */
export { BUSINESS_TIMEZONE };

/** Single rounding rule for every percentage the dashboard shows. */
export const PERCENT_DECIMALS = 1;

/** ADMIN-002 Stage 1 RBAC: only administrator/finance may see revenue numbers. */
export function financialVisibleForRole(role: string | null | undefined): boolean {
  return role === 'administrator' || role === 'finance';
}

/** numerator/denominator -> percentage with the one ratified rounding rule. */
export function toPercent1(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Deduplicating personal identity. Uses the domain key that already exists on
 * every registration (`cpfHash`). Never surfaced in any HTTP response.
 */
export function personIdentityKey(registration: RegistrationRecord): string {
  return (registration.cpfHash || `registration:${registration.id}`).trim();
}

function distinctPeople(registrations: RegistrationRecord[]): number {
  const seen = new Set<string>();
  for (const registration of registrations) seen.add(personIdentityKey(registration));
  return seen.size;
}

function revenueTimestamp(registration: RegistrationRecord): string {
  return registration.paidAt || registration.confirmedAt || registration.createdAt;
}

/** A payment that actually went through a checkout (has a checkout artefact). */
export function paymentHadCheckout(payment: PaymentRecord, paymentEvents: PaymentEventRecord[]): boolean {
  if (payment.checkoutUrl || payment.providerPaymentId) return true;
  return paymentEvents.some(
    (event) => event.paymentId === payment.id && event.eventType.includes('checkout_created'),
  );
}

export type ExecutiveMetrics = {
  financial: {
    grossRevenueCents: number;
    confirmedRevenueCents: number;
    todayRevenueCents: number;
    weekRevenueCents: number;
    averageTicketCents: number;
  };
  registrations: {
    registrationRows: number;
    uniquePeople: number;
    paidRegistrationRows: number;
    uniquePaidPeople: number;
    participantConversionRate: number;
  };
  checkouts: {
    created: number;
    paid: number;
    checkoutConversionRate: number;
    abandonmentRate: number;
  };
};

export function buildExecutiveMetrics(database: Database, now: Date = new Date()): ExecutiveMetrics {
  const registrations = database.registrations;
  const paid = registrations.filter((registration) => registration.status === 'paid');

  // --- financial ---
  const grossRevenueCents = paid.reduce((sum, registration) => sum + registration.amountCents, 0);

  const paidPaymentByRegistration = new Set(
    database.payments
      .filter((payment) => payment.status === 'paid')
      .map((payment) => payment.registrationId),
  );
  // "Confirmada" = paid registration reconciled against a paid payment ledger row
  // (manual_pix / manual_reconciled_paid payments carry status='paid', so they
  // count — per the ratified manual-payment treatment). No fabricated net model.
  const confirmedRevenueCents = paid.reduce(
    (sum, registration) =>
      paidPaymentByRegistration.has(registration.id) ? sum + registration.amountCents : sum,
    0,
  );

  // "today" and "this week" are business-local (America/Porto_Velho), not UTC.
  const todayKey = businessTodayKey(now);
  const weekStart = businessWeekStart(now); // Monday 00:00 business-local, as an instant
  const todayRevenueCents = paid
    .filter((registration) => businessDateKey(revenueTimestamp(registration)) === todayKey)
    .reduce((sum, registration) => sum + registration.amountCents, 0);
  const weekRevenueCents = paid
    .filter((registration) => new Date(revenueTimestamp(registration)) >= weekStart)
    .reduce((sum, registration) => sum + registration.amountCents, 0);

  // Ticket médio = gross / paid rows. Zero population => 0. NEVER a lot price.
  const averageTicketCents = paid.length ? Math.round(grossRevenueCents / paid.length) : 0;

  // --- registrations: people vs rows ---
  const registrationRows = registrations.length;
  const uniquePeople = distinctPeople(registrations);
  const paidRegistrationRows = paid.length;
  const uniquePaidPeople = distinctPeople(paid);
  const participantConversionRate = toPercent1(uniquePaidPeople, uniquePeople);

  // --- checkout population (separate universe) ---
  const checkoutsCreatedList = database.payments.filter((payment) =>
    paymentHadCheckout(payment, database.paymentEvents),
  );
  const created = checkoutsCreatedList.length;
  // Numerator lives in the SAME universe as the denominator: a paid payment that
  // never had a checkout (e.g. a bare manual reconciliation) counts in neither.
  const checkoutsPaid = checkoutsCreatedList.filter((payment) => payment.status === 'paid').length;
  const checkoutConversionRate = toPercent1(checkoutsPaid, created);
  const abandonmentRate = clampPercent(Math.round((100 - checkoutConversionRate) * 10) / 10);

  return {
    financial: {
      grossRevenueCents,
      confirmedRevenueCents,
      todayRevenueCents,
      weekRevenueCents,
      averageTicketCents,
    },
    registrations: {
      registrationRows,
      uniquePeople,
      paidRegistrationRows,
      uniquePaidPeople,
      participantConversionRate,
    },
    checkouts: {
      created,
      paid: checkoutsPaid,
      checkoutConversionRate,
      abandonmentRate,
    },
  };
}
