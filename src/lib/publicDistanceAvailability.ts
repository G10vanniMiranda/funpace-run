import type { AvailabilityResponse, RaceDistance } from '../types/registration';

// EVENT-OPS — 10K registration closure (5K stays open). The public distance
// selector must reflect the canonical run-distances.status from
// /api/availability (server-enforced by createPendingRegistrationInPostgres,
// which only resolves a distance whose status is 'active'). This never
// invents a new source of truth — it only surfaces the same field the lot
// selector already surfaces for pricing (see publicActiveLot.ts).
//
//   - fetch not resolved / distance not present in the response -> 'unknown'
//     (fail open: never disable a selectable option just because the network
//     call hasn't settled yet or is momentarily unavailable — the server is
//     the real gate regardless, see createPendingRegistrationInPostgres)
//   - distance.status === 'active'   -> 'open'
//   - any other status (e.g. 'inactive') -> 'closed'
export type DistanceAvailabilityState = 'unknown' | 'open' | 'closed';

export function selectDistanceAvailability(
  availability: AvailabilityResponse | null,
  distance: RaceDistance,
): DistanceAvailabilityState {
  if (!availability) return 'unknown';
  const match = availability.distances.find((item) => item.name === distance);
  if (!match) return 'unknown';
  return match.status === 'active' ? 'open' : 'closed';
}

export function isDistanceSelectable(state: DistanceAvailabilityState): boolean {
  return state !== 'closed';
}

export const DISTANCE_CLOSED_LABEL = 'Inscrições encerradas';
