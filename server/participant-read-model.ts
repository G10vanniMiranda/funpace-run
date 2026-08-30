import type { RegistrationRecord } from './database.js';

/**
 * ADMIN-003 Stage 2 — PERSON-CENTRIC READ MODEL for the Admin "Inscrições" tab.
 *
 * Human Business Policy (authoritative, not re-opened here):
 *   - the tab represents PEOPLE within ONE event, not registration rows;
 *   - 1 person = 1 row per event; historical attempts are preserved untouched
 *     in the database and surface as the person's HISTORY, never as independent
 *     main rows;
 *   - a person is deduplicated ONLY within an event (same cpf_hash in Event A
 *     and Event B = one person in each);
 *   - canonical registration priority: (a) paid, (b) active attempt,
 *     (c) newest historical.
 *
 * This module is a pure read-model transform: it never mutates the input rows,
 * never touches the database, and is provider-independent. It MUST be given
 * registrations that already belong to a single resolved event.
 */

type RegistrationStatus = RegistrationRecord['status'];

/** "active" = a not-yet-resolved attempt the operator could still act on. */
const ACTIVE_STATUSES: readonly RegistrationStatus[] = ['pending_payment'];

/** newest-first by createdAt, with a deterministic id tie-breaker. */
function byRecency(a: RegistrationRecord, b: RegistrationRecord): number {
  return (b.createdAt || '').localeCompare(a.createdAt || '') || b.id.localeCompare(a.id);
}

/**
 * Pick the single canonical registration for one person inside one event.
 *
 *   1. `paid`  — if several (unexpected today: 0 MULTI_PAID in Production), the
 *      most recently settled wins: paidAt desc, then createdAt desc, then id.
 *      Every attempt is still preserved in `history`.
 *   2. an active attempt (`pending_payment`) — most recent.
 *   3. the newest historical attempt (`expired` / `cancelled` / `payment_failed`
 *      / `refunded`) — no invented "abandoned" status.
 *
 * Deterministic for any input ordering.
 */
export function pickCanonicalRegistration(rows: readonly RegistrationRecord[]): RegistrationRecord {
  const paid = rows.filter((row) => row.status === 'paid');
  if (paid.length > 0) {
    return [...paid].sort((a, b) =>
      (b.paidAt || b.createdAt || '').localeCompare(a.paidAt || a.createdAt || '')
      || (b.createdAt || '').localeCompare(a.createdAt || '')
      || b.id.localeCompare(a.id))[0];
  }
  const active = rows.filter((row) => ACTIVE_STATUSES.includes(row.status));
  if (active.length > 0) return [...active].sort(byRecency)[0];
  return [...rows].sort(byRecency)[0];
}

export type ParticipantConsolidation = {
  /** cpf_hash of the person — INTERNAL grouping key, never sent to the client. */
  personKey: string;
  /** the registration row shown as the person's main row for this event. */
  canonical: RegistrationRecord;
  /** every registration row for this person/event, newest first (incl. canonical). */
  history: RegistrationRecord[];
};

/**
 * Group an event's registrations by person and select each person's canonical
 * row. Input MUST already be scoped to one event. A row without a cpf_hash is
 * never blindly merged — it stands alone keyed by its own id.
 */
export function consolidateParticipants(
  registrations: readonly RegistrationRecord[],
): ParticipantConsolidation[] {
  const byPerson = new Map<string, RegistrationRecord[]>();
  for (const registration of registrations) {
    const key = registration.cpfHash ? `cpf:${registration.cpfHash}` : `id:${registration.id}`;
    const bucket = byPerson.get(key);
    if (bucket) bucket.push(registration);
    else byPerson.set(key, [registration]);
  }

  const participants: ParticipantConsolidation[] = [];
  for (const [key, rows] of byPerson) {
    participants.push({
      personKey: key,
      canonical: pickCanonicalRegistration(rows),
      history: [...rows].sort(byRecency),
    });
  }
  return participants;
}

export type RegistrationHistoryItem = {
  id: string;
  status: RegistrationStatus;
  createdAt: string;
  amountCents: number;
  paidAt: string | null;
  isCanonical: boolean;
};

/** Minimal, PII-free history projection for the person drawer. */
export function toRegistrationHistory(
  consolidation: ParticipantConsolidation,
): RegistrationHistoryItem[] {
  const canonicalId = consolidation.canonical.id;
  return consolidation.history.map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    amountCents: row.amountCents,
    paidAt: row.paidAt || null,
    isCanonical: row.id === canonicalId,
  }));
}
