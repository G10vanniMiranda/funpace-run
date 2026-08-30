import type { Database, EventRecord } from './database.js';

/**
 * ADMIN-002 Stage 4A/4B — EVENT SCOPE AUTHORITY.
 *
 * FUNPACE is a multi-event platform. The Executive Dashboard represents ONE
 * event. This module is the single place that decides WHICH event a dashboard
 * request is about, and narrows the in-memory database to that event before any
 * metric is computed.
 *
 * Resolution contract (no silent fallbacks — never events[0] / latest /
 * hardcoded slug / frontend static config):
 *   - explicit eventId  -> must exist, else EVENT_NOT_FOUND
 *   - no eventId + exactly 1 published event -> that event
 *   - no eventId + 0 published events        -> NO_PUBLISHED_EVENT
 *   - no eventId + >= 2 published events      -> EVENT_SCOPE_AMBIGUOUS
 *
 * NOT in scope here: an "all events" aggregate, historical snapshots,
 * event_id columns on payments/alerts/reconciliation (derivation by join only).
 */

export type EventScopeErrorCode = 'EVENT_NOT_FOUND' | 'NO_PUBLISHED_EVENT' | 'EVENT_SCOPE_AMBIGUOUS';

export type EventScopeResolution =
  | { ok: true; event: EventRecord }
  | { ok: false; code: EventScopeErrorCode; publishedCount: number };

/** Public, non-sensitive event context for the dashboard response + selector. */
export type EventContext = {
  id: string;
  slug: string;
  name: string;
  status: EventRecord['status'];
  date: string;
};

export function eventContext(event: EventRecord): EventContext {
  return { id: event.id, slug: event.slug, name: event.name, status: event.status, date: event.date };
}

export function resolveEventScope(
  events: EventRecord[],
  selector?: { eventId?: string | null; eventSlug?: string | null } | string | null,
): EventScopeResolution {
  const published = events.filter((event) => event.status === 'published');
  const byId = (typeof selector === 'string' ? selector : selector?.eventId || '').trim();
  const bySlug = (typeof selector === 'string' ? selector : selector?.eventSlug || '').trim();

  if (byId || bySlug) {
    const event = events.find((candidate) =>
      (byId && candidate.id === byId) || (bySlug && candidate.slug === bySlug));
    if (!event) return { ok: false, code: 'EVENT_NOT_FOUND', publishedCount: published.length };
    return { ok: true, event };
  }

  if (published.length === 1) return { ok: true, event: published[0] };
  if (published.length === 0) return { ok: false, code: 'NO_PUBLISHED_EVENT', publishedCount: 0 };
  return { ok: false, code: 'EVENT_SCOPE_AMBIGUOUS', publishedCount: published.length };
}

/**
 * Narrow an in-memory Database to a single event. Idempotent. `run-payments`,
 * `run-payment-events`, check-ins, kit deliveries and email deliveries have no
 * event_id column, so they are derived through the event's registration ids.
 * Tables the dashboard metrics do not read (audit logs, sheet syncs, admin
 * sessions/users, partners, partnership leads) are passed through untouched.
 */
export function scopeDatabaseToEvent(database: Database, eventId: string): Database {
  const registrations = database.registrations.filter((registration) => registration.eventId === eventId);
  const registrationIds = new Set(registrations.map((registration) => registration.id));
  const payments = database.payments.filter((payment) => registrationIds.has(payment.registrationId));
  const paymentIds = new Set(payments.map((payment) => payment.id));

  return {
    ...database,
    events: database.events.filter((event) => event.id === eventId),
    distances: database.distances.filter((distance) => distance.eventId === eventId),
    lots: database.lots.filter((lot) => lot.eventId === eventId),
    registrations,
    payments,
    paymentEvents: database.paymentEvents.filter((event) => paymentIds.has(event.paymentId)),
    emailDeliveries: (database.emailDeliveries || []).filter((delivery) => registrationIds.has(delivery.registrationId)),
    checkIns: database.checkIns.filter((checkIn) => registrationIds.has(checkIn.registrationId)),
    kitDeliveries: database.kitDeliveries.filter((delivery) => registrationIds.has(delivery.registrationId)),
  };
}
