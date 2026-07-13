import type { Database, LotRecord, RegistrationRecord } from './database';

export type LotCapacityState = {
  capacityTotal: number;
  confirmed: number;
  temporaryReservations: number;
  occupied: number;
  available: number;
};

export type LotAvailabilityCandidate<T> = T & {
  capacity: number;
  confirmed: number;
  temporaryReservations: number;
  orderIndex: number;
  startsAt: string;
};

export function selectAvailableLotCandidate<T>(candidates: Array<LotAvailabilityCandidate<T>>) {
  return [...candidates]
    .sort((left, right) => left.orderIndex - right.orderIndex || left.startsAt.localeCompare(right.startsAt))
    .find((lot) => lot.confirmed + lot.temporaryReservations < lot.capacity) || null;
}

export function isActiveReservation(
  registration: Pick<RegistrationRecord, 'status' | 'expiresAt' | 'createdAt'>,
  now = new Date(),
) {
  if (registration.status !== 'pending_payment') return false;
  if (!registration.expiresAt) return true;
  return new Date(registration.expiresAt).getTime() > now.getTime();
}

export function calculateLotCapacity(
  lot: Pick<LotRecord, 'id' | 'capacity'>,
  registrations: RegistrationRecord[],
  now = new Date(),
): LotCapacityState {
  const related = registrations.filter((registration) => registration.lotId === lot.id);
  const confirmed = related.filter((registration) => registration.status === 'paid').length;
  const temporaryReservations = related.filter((registration) => isActiveReservation(registration, now)).length;
  const occupied = confirmed + temporaryReservations;

  return {
    capacityTotal: Math.max(0, lot.capacity),
    confirmed,
    temporaryReservations,
    occupied,
    available: Math.max(lot.capacity - occupied, 0),
  };
}

export function selectLotWithAvailability(
  lots: LotRecord[],
  registrations: RegistrationRecord[],
  eventId: string,
  now = new Date(),
) {
  return lots
    .filter((lot) => lot.eventId === eventId && ['active', 'sold_out'].includes(lot.status))
    .sort((left, right) => left.orderIndex - right.orderIndex || left.startsAt.localeCompare(right.startsAt))
    .find((lot) => calculateLotCapacity(lot, registrations, now).available > 0) || null;
}

/**
 * Keeps the legacy soldCount field as a projection of confirmed sales only.
 * Capacity decisions must always use calculateLotCapacity, which also includes
 * active temporary reservations.
 */
export function synchronizeLotProjections(database: Pick<Database, 'lots' | 'registrations'>, now = new Date()) {
  for (const lot of database.lots) {
    const capacity = calculateLotCapacity(lot, database.registrations, now);
    lot.soldCount = capacity.confirmed;
    if (['active', 'sold_out'].includes(lot.status)) {
      lot.status = capacity.available === 0 ? 'sold_out' : 'active';
    }
  }
}
