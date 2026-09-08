/**
 * EVENT-DAY-OFFLINE-FALLBACK & START-LIST — pure start-list projection.
 *
 * FUNPACE runs check-in / kit hand-out on the event floor from the Admin system.
 * If venue connectivity degrades, a PRINTED start list becomes the temporary
 * operational record and is later reconciled through the existing narrow
 * primitives. This module builds that list.
 *
 * Contract (proven by tests/start-list-domain.test.ts):
 *   - INPUT is an already-built, already-event-scoped array of admin rows
 *     (the caller maps `toAdminRow` over the scoped registrations). This module
 *     never touches a DB, a request, React, or `payload.cpf`; `cpfMasked` is
 *     produced upstream by the canonical `maskCpf`.
 *   - COHORT is ROW-CENTRIC over effective status `paid` — one line per paid
 *     registration. No person consolidation: a second paid registration for the
 *     same person is a second race entry with its own bib and is NEVER hidden.
 *   - A paid row is never dropped because its bib / shirt size / distance
 *     metadata is missing or imperfect. Missing bib renders `SEM DORSAL`.
 *   - OUTPUT is a hand-built allowlist: bib, name, cpfMasked, distance,
 *     shirtSize, a paid indicator, paper check-in / kit markers, and the
 *     registration id as a discreet technical reference. Nothing else — no
 *     email / phone / full CPF / birth date / city / team / emergency contact /
 *     amount / gateway ids / coupon / partner / raw payload / audit metadata.
 *   - INTEGRITY GATE: FAIL CLOSED (`status: 'blocked'`) on duplicate bib or a
 *     KIT_DELIVERED + NOT_CHECKED_IN row; WARN but still generate
 *     (`status: 'provisional'`) on paid-without-bib, duplicate paid identity, or
 *     unresolved distance. `status: 'final'` only when there are zero failures
 *     AND zero warnings.
 *   - `contentHash` is a deterministic digest of the ROSTER (bib, id, name,
 *     masked CPF, distance, shirt) canonicalised by registration id. It does
 *     NOT depend on `generatedAt`, on the requested sort, or on live
 *     check-in / kit marks — two generations of the same roster compare equal;
 *     a bib / distance / shirt / cohort change flips it.
 */

import { createHash } from 'node:crypto';

export type StartListSort = 'bib' | 'name';
export const START_LIST_SORTS = ['bib', 'name'] as const satisfies readonly StartListSort[];
export const SEM_DORSAL = 'SEM DORSAL';
export const SHIRT_FALLBACK = '—'; // em dash

/** Structural subset of `toAdminRow(...)` output that this module consumes. */
export type StartListSourceRow = {
  id: string;
  name: string;
  /** already masked upstream by the canonical `maskCpf` (e.g. 123.***.***-45). */
  cpfMasked: string;
  bibNumber: string | null;
  /** `toAdminRow.distance` = distances.name || distanceId. */
  distance: string;
  distanceId: string;
  shirtSize: string | null | undefined;
  /** `toAdminRow.status` — the EFFECTIVE status. */
  status: string;
  checkInRecorded: boolean;
  checkInAt: string | null;
  kitRecorded: boolean;
  kitAt: string | null;
  /**
   * Opaque person grouping key (`cpf:<hash>` | `id:<id>`), derived upstream from
   * `cpf_hash`. Used ONLY for the duplicate-paid-identity count — it is never
   * placed on a `StartListRow` and never serialised.
   */
  personKey: string;
};

export type StartListRow = {
  bib: string;
  hasBib: boolean;
  name: string;
  cpfMasked: string;
  distance: string;
  distanceKnown: boolean;
  shirtSize: string;
  paid: 'SIM';
  checkIn: { recorded: boolean; at: string | null };
  kit: { recorded: boolean; at: string | null };
  registrationId: string;
};

export type StartListIntegrity = {
  totalPaid: number;
  paidWithBib: number;
  paidWithoutBib: number;
  duplicateBibCount: number;
  forbiddenKitWithoutCheckInCount: number;
  paidIdentityReviewCount: number;
  invalidDistanceCount: number;
};

export type StartListStatus = 'final' | 'provisional' | 'blocked';

export type StartListOutcome = {
  status: StartListStatus;
  releasable: boolean;
  failures: string[];
  warnings: string[];
};

export type StartList = {
  sort: StartListSort;
  rows: StartListRow[];
  integrity: StartListIntegrity;
  outcome: StartListOutcome;
  contentHash: string;
  contentRef: string;
};

export function normalizeStartListSort(input: unknown): StartListSort | null {
  if (input === 'bib' || input === 'name') return input;
  if (input === null || input === undefined || input === '') return 'bib';
  return null;
}

function normalizedName(a: StartListRow, b: StartListRow): number {
  return (
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) ||
    a.registrationId.localeCompare(b.registrationId)
  );
}

function bibNumericValue(row: StartListRow): number {
  const digits = row.bib.replace(/\D/g, '');
  if (!digits) return Number.POSITIVE_INFINITY;
  const value = Number(digits);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function buildStartList(
  sourceRows: readonly StartListSourceRow[],
  options: { sort: StartListSort },
): StartList {
  const sort: StartListSort = options.sort === 'name' ? 'name' : 'bib';
  const paid = sourceRows.filter((row) => row.status === 'paid');

  const rows: StartListRow[] = paid.map((source) => {
    const bibRaw = (source.bibNumber ?? '').trim();
    const hasBib = bibRaw.length > 0;
    const distanceLabel = (source.distance ?? '').trim();
    const distanceKnown =
      distanceLabel.length > 0 &&
      distanceLabel !== source.distanceId &&
      !/^distance-/i.test(distanceLabel);
    const shirt = (source.shirtSize == null ? '' : String(source.shirtSize)).trim();
    return {
      bib: hasBib ? bibRaw : SEM_DORSAL,
      hasBib,
      name: source.name,
      cpfMasked: source.cpfMasked,
      distance: distanceKnown ? distanceLabel : distanceLabel || source.distanceId,
      distanceKnown,
      shirtSize: shirt || SHIRT_FALLBACK,
      paid: 'SIM',
      checkIn: { recorded: Boolean(source.checkInRecorded), at: source.checkInAt ?? null },
      kit: { recorded: Boolean(source.kitRecorded), at: source.kitAt ?? null },
      registrationId: source.id,
    };
  });

  // Deterministic order. `sort=bib`: the SEM DORSAL block first (by name, id),
  // then bibbed rows by numeric bib then id. `sort=name`: by name then id.
  if (sort === 'name') {
    rows.sort(normalizedName);
  } else {
    rows.sort((a, b) => {
      if (a.hasBib !== b.hasBib) return a.hasBib ? 1 : -1;
      if (!a.hasBib) return normalizedName(a, b);
      return bibNumericValue(a) - bibNumericValue(b) || a.registrationId.localeCompare(b.registrationId);
    });
  }

  const paidWithBib = rows.filter((row) => row.hasBib).length;

  const bibCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.hasBib) bibCounts.set(row.bib, (bibCounts.get(row.bib) ?? 0) + 1);
  }
  const duplicateBibCount = [...bibCounts.values()]
    .filter((count) => count > 1)
    .reduce((sum, count) => sum + count, 0);

  const forbiddenKitWithoutCheckInCount = rows.filter(
    (row) => row.kit.recorded && !row.checkIn.recorded,
  ).length;

  const personCounts = new Map<string, number>();
  for (const source of paid) {
    personCounts.set(source.personKey, (personCounts.get(source.personKey) ?? 0) + 1);
  }
  const paidIdentityReviewCount = [...personCounts.values()].filter((count) => count > 1).length;

  const invalidDistanceCount = rows.filter((row) => !row.distanceKnown).length;

  const integrity: StartListIntegrity = {
    totalPaid: rows.length,
    paidWithBib,
    paidWithoutBib: rows.length - paidWithBib,
    duplicateBibCount,
    forbiddenKitWithoutCheckInCount,
    paidIdentityReviewCount,
    invalidDistanceCount,
  };

  const failures: string[] = [];
  if (duplicateBibCount > 0) failures.push('DUPLICATE_BIB');
  if (forbiddenKitWithoutCheckInCount > 0) failures.push('KIT_WITHOUT_CHECK_IN');

  const warnings: string[] = [];
  if (integrity.paidWithoutBib > 0) warnings.push('PAID_WITHOUT_BIB');
  if (paidIdentityReviewCount > 0) warnings.push('DUPLICATE_PAID_IDENTITY');
  if (invalidDistanceCount > 0) warnings.push('INVALID_DISTANCE');

  const status: StartListStatus =
    failures.length > 0 ? 'blocked' : warnings.length > 0 ? 'provisional' : 'final';
  const outcome: StartListOutcome = { status, releasable: status !== 'blocked', failures, warnings };

  // contentHash: roster only, canonicalised by registration id — independent of
  // generatedAt, of the requested sort, and of live check-in / kit marks.
  const canonicalRoster = rows
    .map((row) => [row.bib, row.registrationId, row.name, row.cpfMasked, row.distance, row.shirtSize])
    .sort((a, b) => a[1].localeCompare(b[1]));
  const contentHash = createHash('sha256')
    .update(JSON.stringify({ v: 1, rows: canonicalRoster }))
    .digest('hex');

  return { sort, rows, integrity, outcome, contentHash, contentRef: contentHash.slice(0, 12) };
}

// ---------------------------------------------------------------------------
// CSV cell projection. Returns the RAW 2D cell grid (header + rows). The caller
// pipes every cell through the canonical `escapeCsv` (formula-injection guard +
// RFC-4180 quoting) and joins with CRLF behind a UTF-8 BOM — exactly like every
// other Admin CSV export. This module deliberately does not import `escapeCsv`
// (that would couple it to server/index.ts); the paper marker columns are left
// blank for pending rows so the sheet can be marked by hand.
// ---------------------------------------------------------------------------

export const START_LIST_CSV_HEADERS = [
  'DORSAL',
  'NOME',
  'CPF',
  'PROVA',
  'CAMISA',
  'PAGO',
  'CHECK-IN',
  'KIT',
  'ID INSCRICAO',
] as const;

function paperMark(recorded: boolean, at: string | null): string {
  if (!recorded) return '';
  const time = at ? at.slice(11, 16) : '';
  return time ? `OK ${time}` : 'OK';
}

export function startListCsvCells(list: StartList): string[][] {
  const header = [...START_LIST_CSV_HEADERS];
  const body = list.rows.map((row) => [
    row.bib,
    row.name,
    row.cpfMasked,
    row.distanceKnown ? row.distance : `${row.distance} (?)`,
    row.shirtSize,
    row.paid,
    paperMark(row.checkIn.recorded, row.checkIn.at),
    paperMark(row.kit.recorded, row.kit.at),
    row.registrationId,
  ]);
  return [header, ...body];
}
