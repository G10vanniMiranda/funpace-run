/**
 * ADMIN-003 Stage 3 — RBAC + PII MINIMISATION for the Admin "Inscrições" surface.
 *
 * Single authority for "who can see what" on a registration/participant row.
 * Pure and provider-independent: no DB, no React, no request context — it takes
 * an already-built admin row (the output of `toAdminRow`) plus the caller's role
 * and returns the role-shaped, minimised object.
 *
 * Human policy (authoritative, not re-opened here):
 *   - administrator / finance: full operational + financial identification.
 *   - operation: event-floor role. Can identify a participant and run
 *     check-in / kit / bib, but MUST NOT see financial data, payment/gateway
 *     identifiers, coupon/discount, partner financial attribution, or
 *     unnecessary PII. Participant e-mail/phone are masked. Emergency contact
 *     is available in the DETAIL view only (operational / emergency purpose),
 *     never in the list. History carries no amount/payment data for operation.
 *
 * Minimisation is by ABSENCE, not by null: prohibited fields are deleted from
 * the response object, so `("amountCents" in row) === false` for operation.
 */

export type RegistrationViewRole = 'administrator' | 'finance' | 'operation';
export type RegistrationViewSurface = 'list' | 'detail';

/**
 * `giovanni@example.com` -> `gi******@example.com`. Keeps the first two chars of
 * the local part and the full domain; never fewer than four mask chars.
 * Deterministic, reveals no length beyond "> 2".
 */
export function maskEmail(email: unknown): string {
  const value = String(email ?? '').trim();
  const at = value.indexOf('@');
  if (at < 1) return value ? '***' : '';
  const local = value.slice(0, at);
  const domain = value.slice(at); // includes '@'
  const visible = local.slice(0, 2);
  const stars = '*'.repeat(Math.max(local.length - 2, 4));
  return `${visible}${stars}${domain}`;
}

/**
 * `+55 11 99999-1234` -> `*******1234`. Masks every digit except the last four;
 * four or fewer digits are fully masked. Non-digits are dropped.
 */
export function maskPhone(phone: unknown): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 4) return '*'.repeat(digits.length);
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

// Financial / gateway / coupon / partner-attribution / confirmation-provider /
// unnecessary-PII fields removed for `operation` on every Inscrições surface.
export const OPERATION_HIDDEN_FIELDS = [
  'amountCents',
  'originalPriceCents',
  'finalPriceCents',
  'discountPercentage',
  'discountAmountCents',
  'couponCode',
  'couponAppliedAt',
  'couponUsedAt',
  'paymentStatus',
  'paymentProvider',
  'providerPaymentId',
  'gatewayStatus',
  'gatewayTransactionId',
  'paymentMethod',
  'hasPaymentDivergence',
  'paidAt',
  'confirmedAt',
  'expiresAt',
  'partnerId',
  'partnerName',
  'partnerType',
  'partnerLink',
  'partnerIdentifiedAt',
  'confirmationEmailSentAt',
  'confirmationEmailProvider',
  'confirmationEmailId',
  'confirmationEmailError',
  'birthDate',
] as const;

// Available to `operation` in the DETAIL view (emergency purpose) but never in
// the list.
export const OPERATION_DETAIL_ONLY_FIELDS = ['emergencyContactName', 'emergencyContactPhone'] as const;

/**
 * Role-shape an admin registration row. administrator / finance pass through
 * unchanged; operation gets the minimised, masked object.
 */
export function serializeAdminRegistrationForRole<T extends object>(
  row: T,
  role: RegistrationViewRole,
  surface: RegistrationViewSurface,
): T {
  if (role !== 'operation') return row;
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const field of OPERATION_HIDDEN_FIELDS) delete out[field];
  if (surface === 'list') for (const field of OPERATION_DETAIL_ONLY_FIELDS) delete out[field];
  if ('email' in out) out.email = maskEmail(out.email);
  if ('phone' in out) out.phone = maskPhone(out.phone);
  return out as T;
}

export function serializeAdminRegistrationsForRole<T extends object>(
  rows: T[],
  role: RegistrationViewRole,
  surface: RegistrationViewSurface,
): T[] {
  if (role !== 'operation') return rows;
  return rows.map((row) => serializeAdminRegistrationForRole(row, role, surface));
}

/**
 * Person attempt-history projection. operation keeps status / timestamp /
 * canonical flag / technical id; amount and payment timestamp are removed.
 */
export function serializeRegistrationHistoryForRole<T extends object>(
  items: T[],
  role: RegistrationViewRole,
): T[] {
  if (role !== 'operation') return items;
  return items.map((item) => {
    const out: Record<string, unknown> = { ...(item as Record<string, unknown>) };
    delete out.amountCents;
    delete out.paidAt;
    return out as T;
  });
}

// Timeline entry types an `operation` user may see, plus the detail keys that
// are safe to keep on them. Everything else (payment events, gateway payloads,
// raw audit-log payloads with IP / user-agent / session / PII diffs, e-mail
// message ids, amounts, transaction ids) is dropped.
export const OPERATION_TIMELINE_TYPES: ReadonlySet<string> = new Set([
  'registration.created',
  'registration.confirmed',
  'registration.cancelled',
  'registration.check_in',
  'registration.kit_delivered',
  'registration.bib_assigned',
  'registration.undo-check-in',
  'registration.undo-kit',
  'check_in.completed',
  'kit.delivered',
]);
const OPERATION_TIMELINE_DETAIL_KEYS: ReadonlySet<string> = new Set([
  'notes',
  'bibNumber',
  'previous',
  'status',
]);

export function serializeRegistrationTimelineForRole<
  T extends { type: string; details?: Record<string, unknown> },
>(events: T[], role: RegistrationViewRole): T[] {
  if (role !== 'operation') return events;
  return events
    .filter((event) => OPERATION_TIMELINE_TYPES.has(event.type))
    .map((event) => ({
      ...event,
      details: Object.fromEntries(
        Object.entries(event.details ?? {}).filter(([key]) => OPERATION_TIMELINE_DETAIL_KEYS.has(key)),
      ),
    }));
}
