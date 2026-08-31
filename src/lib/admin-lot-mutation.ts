// ADMIN-UX-HOTFIX-001 — event-config lot mutation payload builder.
//
// Framework-agnostic + pure (unit-tested under node:test). `PATCH
// /api/admin/lots/:id` (handleAdminLotUpdate) is FULL-REPLACE: every one of
// name / capacity / priceCents / status / startsAt / endsAt is overwritten from
// the request body. The pre-hotfix client spread `{ ...lot, reason }` and,
// worse, the caller silently `return`ed when the lot was missing — so a save
// could reach neither the network nor any feedback surface.
//
// This builder produces EXACTLY the seven fields the endpoint reads (no id /
// eventId / soldCount leakage, no missing field) and refuses to build a
// partial/invalid payload, so the caller always has an explicit outcome.

export const LOT_STATUSES = ['active', 'inactive', 'sold_out', 'scheduled', 'closed'] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export type LotUpdatePayload = {
  name: string;
  capacity: number;
  priceCents: number;
  status: LotStatus;
  startsAt: string;
  endsAt: string;
  reason: string;
};

export type BuildLotUpdateResult =
  | { ok: true; payload: LotUpdatePayload }
  | { ok: false; error: string; field: 'lot' | 'name' | 'capacity' | 'priceCents' | 'status' | 'window' | 'reason' };

type LotLike = {
  name?: unknown;
  capacity?: unknown;
  priceCents?: unknown;
  status?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  soldCount?: unknown;
};

export function buildLotUpdatePayload(lot: LotLike | null | undefined, reason: unknown): BuildLotUpdateResult {
  if (!lot || typeof lot !== 'object') {
    return {
      ok: false,
      field: 'lot',
      error: 'Lote não encontrado na configuração carregada. Recarregue a página e tente novamente.',
    };
  }

  const name = typeof lot.name === 'string' ? lot.name.trim() : '';
  if (!name) return { ok: false, field: 'name', error: 'O nome do lote é obrigatório.' };

  const capacity = Number(lot.capacity);
  if (!Number.isInteger(capacity) || capacity < 0) {
    return { ok: false, field: 'capacity', error: 'Capacidade inválida.' };
  }
  const soldCount = Number(lot.soldCount ?? 0);
  if (Number.isFinite(soldCount) && capacity < soldCount) {
    return { ok: false, field: 'capacity', error: `A capacidade não pode ser menor que ${soldCount} vagas ocupadas.` };
  }

  const priceCents = Number(lot.priceCents);
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    return { ok: false, field: 'priceCents', error: 'Preço em centavos inválido.' };
  }

  const status = typeof lot.status === 'string' ? lot.status : '';
  if (!LOT_STATUSES.includes(status as LotStatus)) {
    return { ok: false, field: 'status', error: 'Status de lote inválido.' };
  }

  const startsAt = typeof lot.startsAt === 'string' ? lot.startsAt.trim() : '';
  const endsAt = typeof lot.endsAt === 'string' ? lot.endsAt.trim() : '';
  if (!startsAt || !endsAt) {
    return { ok: false, field: 'window', error: 'A janela de venda (início e fim) é obrigatória.' };
  }
  // Guard against a `datetime-local` input value (no zone) silently replacing an
  // offset-qualified ISO instant — that would move the turnover boundary.
  const OFFSET_OR_Z = /(?:Z|[+-]\d{2}:?\d{2})$/;
  if (!OFFSET_OR_Z.test(startsAt) || !OFFSET_OR_Z.test(endsAt)) {
    return {
      ok: false,
      field: 'window',
      error: 'Início/fim precisam manter o fuso horário (ex.: 2026-09-01T00:00:00-04:00). Não edite a janela de venda neste ajuste.',
    };
  }
  if (startsAt >= endsAt) {
    return { ok: false, field: 'window', error: 'O encerramento deve ser posterior ao início.' };
  }

  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (trimmedReason.length < 5) {
    return { ok: false, field: 'reason', error: 'Informe um motivo com pelo menos 5 caracteres.' };
  }

  return {
    ok: true,
    payload: { name, capacity, priceCents, status: status as LotStatus, startsAt, endsAt, reason: trimmedReason },
  };
}

/** The exact key set the endpoint consumes — used by tests to guard against
 *  accidental omission or leakage of extra fields. */
export const LOT_UPDATE_REQUIRED_KEYS = ['name', 'capacity', 'priceCents', 'status', 'startsAt', 'endsAt', 'reason'] as const;
