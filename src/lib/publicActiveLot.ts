import type { AvailabilityResponse } from '../types/registration';

export type PublicLot = AvailabilityResponse['lots'][number];

export type PublicActiveLotState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'none' }
  | { kind: 'ambiguous' }
  | { kind: 'ready'; lot: PublicLot };

// EVENT-OPS-001: the public commercial "current lot" is ALWAYS the canonical
// ACTIVE lot from /api/availability (lot.status === 'active'). It must never be
// derived from a static name/price, and never from an inactive lot that merely
// still exists in the list — otherwise every price turnover (Lote 2 -> Lote 3 ->
// Lote 4) silently breaks the landing page.
//
//   - fetch not resolved yet -> 'loading' (show a neutral placeholder, never a price)
//   - fetch failed           -> 'error'   (do NOT advertise a stale price)
//   - zero active lots       -> 'none'    (legitimate ~33s window during a two-step turnover)
//   - >1 active lot          -> 'ambiguous' (malformed API — fail safe, advertise no price;
//                                            the DB one-active-lot invariant still stands)
//   - exactly one active lot -> 'ready'
export function selectPublicActiveLot(
  availability: AvailabilityResponse | null,
  fetchFailed: boolean,
): PublicActiveLotState {
  if (fetchFailed) return { kind: 'error' };
  if (!availability) return { kind: 'loading' };
  const active = availability.lots.filter((lot) => lot.status === 'active');
  if (active.length === 0) return { kind: 'none' };
  if (active.length > 1) return { kind: 'ambiguous' };
  return { kind: 'ready', lot: active[0] };
}

export function publicActiveLotOrNull(state: PublicActiveLotState): PublicLot | null {
  return state.kind === 'ready' ? state.lot : null;
}

export function publicActiveLotPriceCents(state: PublicActiveLotState): number | null {
  return state.kind === 'ready' ? state.lot.priceCents : null;
}

// Copy for a price-bearing label when the active lot is not resolvable.
export function publicActiveLotUnavailableLabel(state: PublicActiveLotState): string {
  switch (state.kind) {
    case 'loading': return 'Carregando lote…';
    case 'none': return 'Inscrições encerradas neste lote';
    case 'ambiguous':
    case 'error': return 'Valor indisponível no momento';
    case 'ready': return '';
  }
}
