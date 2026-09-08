import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStartList,
  normalizeStartListSort,
  startListCsvCells,
  START_LIST_CSV_HEADERS,
  SEM_DORSAL,
  SHIRT_FALLBACK,
  type StartListSourceRow,
} from '../server/start-list.js';

// EVENT-DAY-OFFLINE-FALLBACK & START-LIST — the projection is pure, row-centric
// over effective status 'paid', deterministic, never drops a paid athlete, and
// its contentHash is independent of generatedAt / sort / live marks.

let seq = 0;
function src(overrides: Partial<StartListSourceRow> = {}): StartListSourceRow {
  seq += 1;
  const id = overrides.id ?? `reg-${String(seq).padStart(4, '0')}`;
  return {
    id,
    name: overrides.name ?? `Atleta ${seq}`,
    cpfMasked: overrides.cpfMasked ?? '123.***.***-45',
    bibNumber: overrides.bibNumber ?? null,
    distance: overrides.distance ?? '5K',
    distanceId: overrides.distanceId ?? 'distance-5k',
    shirtSize: 'shirtSize' in overrides ? overrides.shirtSize : 'M',
    status: overrides.status ?? 'paid',
    checkInRecorded: overrides.checkInRecorded ?? false,
    checkInAt: overrides.checkInAt ?? null,
    kitRecorded: overrides.kitRecorded ?? false,
    kitAt: overrides.kitAt ?? null,
    personKey: overrides.personKey ?? `cpf:${id}`,
  };
}

test('cohort: row-centric, effective status paid only', () => {
  const rows = [
    src({ status: 'paid', bibNumber: '0001' }),
    src({ status: 'cancelled', bibNumber: '0002' }),
    src({ status: 'expired' }),
    src({ status: 'pending_payment' }),
    src({ status: 'paid', bibNumber: '0003' }),
  ];
  const list = buildStartList(rows, { sort: 'bib' });
  assert.equal(list.rows.length, 2);
  assert.deepEqual(list.rows.map((r) => r.bib), ['0001', '0003']);
  assert.equal(list.integrity.totalPaid, 2);
});

test('event isolation is the caller\'s job — the module only sees the rows it is given', () => {
  // the handler passes already-event-scoped rows; the module never filters by event
  const list = buildStartList([src({ status: 'paid', bibNumber: '0009' })], { sort: 'bib' });
  assert.equal(list.rows.length, 1);
});

test('a second paid registration for the same person is NEVER hidden (no consolidation)', () => {
  const rows = [
    src({ status: 'paid', bibNumber: '0010', personKey: 'cpf:same', name: 'Ana' }),
    src({ status: 'paid', bibNumber: '0011', personKey: 'cpf:same', name: 'Ana' }),
  ];
  const list = buildStartList(rows, { sort: 'bib' });
  assert.equal(list.rows.length, 2);
  assert.equal(list.integrity.paidIdentityReviewCount, 1);
  assert.ok(list.outcome.warnings.includes('DUPLICATE_PAID_IDENTITY'));
  assert.equal(list.outcome.status, 'provisional'); // warn, still generate
  assert.equal(list.outcome.releasable, true);
});

test('missing bib is included as SEM DORSAL and flagged provisional', () => {
  const rows = [src({ status: 'paid', bibNumber: null }), src({ status: 'paid', bibNumber: '0020' })];
  const list = buildStartList(rows, { sort: 'bib' });
  assert.equal(list.rows.length, 2);
  const semDorsal = list.rows.filter((r) => !r.hasBib);
  assert.equal(semDorsal.length, 1);
  assert.equal(semDorsal[0].bib, SEM_DORSAL);
  assert.equal(list.integrity.paidWithoutBib, 1);
  assert.ok(list.outcome.warnings.includes('PAID_WITHOUT_BIB'));
  assert.equal(list.outcome.status, 'provisional');
});

test('a paid athlete is never dropped for missing shirt / imperfect distance', () => {
  const rows = [
    src({ status: 'paid', bibNumber: '0030', shirtSize: '' }),
    src({ status: 'paid', bibNumber: '0031', shirtSize: undefined }),
    src({ status: 'paid', bibNumber: '0032', distance: 'distance-5k', distanceId: 'distance-5k' }),
  ];
  const list = buildStartList(rows, { sort: 'bib' });
  assert.equal(list.rows.length, 3);
  assert.equal(list.rows[0].shirtSize, SHIRT_FALLBACK);
  assert.equal(list.rows[1].shirtSize, SHIRT_FALLBACK);
  const unknownDistance = list.rows.find((r) => r.registrationId === rows[2].id);
  assert.equal(unknownDistance?.distanceKnown, false);
  assert.ok(list.outcome.warnings.includes('INVALID_DISTANCE'));
});

test('deterministic bib sort: SEM DORSAL block first (by name,id), then numeric bib then id', () => {
  const rows = [
    src({ status: 'paid', bibNumber: '0100', name: 'Zeca' }),
    src({ status: 'paid', bibNumber: '0009', name: 'Bruno' }),
    src({ status: 'paid', bibNumber: null, name: 'Carla' }),
    src({ status: 'paid', bibNumber: null, name: 'Ana' }),
  ];
  const list = buildStartList(rows, { sort: 'bib' });
  assert.deepEqual(list.rows.map((r) => r.name), ['Ana', 'Carla', 'Bruno', 'Zeca']);
  assert.deepEqual(list.rows.map((r) => r.bib), [SEM_DORSAL, SEM_DORSAL, '0009', '0100']);
});

test('bib sort is stable — id breaks ties on equal numeric bib', () => {
  const rows = [
    src({ id: 'reg-b', status: 'paid', bibNumber: '0007' }),
    src({ id: 'reg-a', status: 'paid', bibNumber: '7' }),
  ];
  const list = buildStartList(rows, { sort: 'bib' });
  assert.deepEqual(list.rows.map((r) => r.registrationId), ['reg-a', 'reg-b']);
});

test('deterministic name sort: pt-BR collation, id tie-break', () => {
  const rows = [
    src({ id: 'reg-2', status: 'paid', bibNumber: '0201', name: 'ana' }),
    src({ id: 'reg-1', status: 'paid', bibNumber: '0202', name: 'Ana' }),
    src({ status: 'paid', bibNumber: '0203', name: 'Ário' }),
    src({ status: 'paid', bibNumber: '0204', name: 'Ábel' }),
  ];
  const list = buildStartList(rows, { sort: 'name' });
  // 'ana' and 'Ana' compare equal under sensitivity:'base' → id breaks the tie
  // (reg-1='Ana', reg-2='ana').
  assert.deepEqual(list.rows.map((r) => r.name), ['Ábel', 'Ana', 'ana', 'Ário']);
  assert.deepEqual(list.rows.slice(1, 3).map((r) => r.registrationId), ['reg-1', 'reg-2']);
});

test('CPF masking: only the upstream cpfMasked appears; no 11-digit CPF anywhere', () => {
  const rows = [src({ status: 'paid', bibNumber: '0300', cpfMasked: '987.***.***-21', name: 'Contains 12345678901 digits' })];
  const list = buildStartList(rows, { sort: 'bib' });
  const blob = JSON.stringify(list.rows);
  assert.match(list.rows[0].cpfMasked, /^\d{3}\.\*{3}\.\*{3}-(\d{2}|\*{2})$/);
  // the row projection carries no field that could hold a raw CPF
  assert.doesNotMatch(JSON.stringify(list.rows[0].cpfMasked), /\d{11}/);
  // name is passed through verbatim (the 11-digit run there is the fixture's, not a CPF field)
  assert.equal(list.rows[0].name, 'Contains 12345678901 digits');
  assert.ok(blob.length > 0);
});

test('PII allowlist: a StartListRow has exactly the 11 permitted keys', () => {
  const list = buildStartList([src({ status: 'paid', bibNumber: '0400' })], { sort: 'bib' });
  assert.deepEqual(
    Object.keys(list.rows[0]).sort(),
    ['bib', 'checkIn', 'cpfMasked', 'distance', 'distanceKnown', 'hasBib', 'kit', 'name', 'paid', 'registrationId', 'shirtSize'].sort(),
  );
  for (const forbidden of ['email', 'phone', 'cpf', 'birthDate', 'city', 'state', 'team', 'amountCents', 'gatewayTransactionId', 'providerPaymentId', 'couponCode', 'partnerId', 'personKey', 'payload']) {
    assert.equal(forbidden in list.rows[0], false, `${forbidden} must not be on a StartListRow`);
  }
});

test('duplicate bib among paid rows FAILS CLOSED', () => {
  const rows = [
    src({ status: 'paid', bibNumber: '0500' }),
    src({ status: 'paid', bibNumber: '0500' }),
    src({ status: 'paid', bibNumber: '0501' }),
  ];
  const list = buildStartList(rows, { sort: 'bib' });
  assert.equal(list.integrity.duplicateBibCount, 2);
  assert.ok(list.outcome.failures.includes('DUPLICATE_BIB'));
  assert.equal(list.outcome.status, 'blocked');
  assert.equal(list.outcome.releasable, false);
});

test('KIT_DELIVERED + NOT_CHECKED_IN FAILS CLOSED', () => {
  const rows = [
    src({ status: 'paid', bibNumber: '0600', kitRecorded: true, checkInRecorded: false }),
    src({ status: 'paid', bibNumber: '0601', kitRecorded: true, checkInRecorded: true }),
  ];
  const list = buildStartList(rows, { sort: 'bib' });
  assert.equal(list.integrity.forbiddenKitWithoutCheckInCount, 1);
  assert.ok(list.outcome.failures.includes('KIT_WITHOUT_CHECK_IN'));
  assert.equal(list.outcome.status, 'blocked');
});

test('identity-review is a WARNING, not a block', () => {
  const rows = [
    src({ status: 'paid', bibNumber: '0700', personKey: 'cpf:x' }),
    src({ status: 'paid', bibNumber: '0701', personKey: 'cpf:x' }),
  ];
  const list = buildStartList(rows, { sort: 'bib' });
  assert.equal(list.outcome.status, 'provisional');
  assert.equal(list.outcome.failures.length, 0);
});

test('final status only with zero failures AND zero warnings', () => {
  const rows = [
    src({ status: 'paid', bibNumber: '0800', distance: '5K', distanceId: 'distance-5k', personKey: 'cpf:a' }),
    src({ status: 'paid', bibNumber: '0801', distance: '10K', distanceId: 'distance-10k', personKey: 'cpf:b' }),
  ];
  const list = buildStartList(rows, { sort: 'bib' });
  assert.equal(list.outcome.status, 'final');
  assert.equal(list.outcome.releasable, true);
  assert.deepEqual(list.outcome.warnings, []);
});

test('contentHash: independent of sort and of live check-in / kit marks', () => {
  const base = [
    src({ id: 'r1', status: 'paid', bibNumber: '0900', name: 'Bruno', distance: '5K', distanceId: 'distance-5k', personKey: 'cpf:a' }),
    src({ id: 'r2', status: 'paid', bibNumber: '0901', name: 'Ana', distance: '10K', distanceId: 'distance-10k', personKey: 'cpf:b' }),
  ];
  const byBib = buildStartList(base, { sort: 'bib' });
  const byName = buildStartList(base, { sort: 'name' });
  assert.equal(byBib.contentHash, byName.contentHash, 'same roster, different sort → same hash');

  const withMarks = base.map((r, i) => (i === 0 ? { ...r, checkInRecorded: true, checkInAt: '2026-09-20T06:40:00Z', kitRecorded: true, kitAt: '2026-09-20T06:41:00Z' } : r));
  assert.equal(buildStartList(withMarks, { sort: 'bib' }).contentHash, byBib.contentHash, 'live marks do not change the roster hash');
});

test('contentHash: a bib / distance / shirt / cohort change DOES change it', () => {
  const base = [
    src({ id: 'r1', status: 'paid', bibNumber: '1000', name: 'A', distance: '5K', distanceId: 'distance-5k', shirtSize: 'M', personKey: 'cpf:a' }),
    src({ id: 'r2', status: 'paid', bibNumber: '1001', name: 'B', distance: '5K', distanceId: 'distance-5k', shirtSize: 'G', personKey: 'cpf:b' }),
  ];
  const h0 = buildStartList(base, { sort: 'bib' }).contentHash;

  const bibChanged = base.map((r, i) => (i === 0 ? { ...r, bibNumber: '1099' } : r));
  assert.notEqual(buildStartList(bibChanged, { sort: 'bib' }).contentHash, h0);

  const distanceChanged = base.map((r, i) => (i === 0 ? { ...r, distance: '10K', distanceId: 'distance-10k' } : r));
  assert.notEqual(buildStartList(distanceChanged, { sort: 'bib' }).contentHash, h0);

  const shirtChanged = base.map((r, i) => (i === 0 ? { ...r, shirtSize: 'GG' } : r));
  assert.notEqual(buildStartList(shirtChanged, { sort: 'bib' }).contentHash, h0);

  const cohortChanged = [...base, src({ id: 'r3', status: 'paid', bibNumber: '1002', personKey: 'cpf:c' })];
  assert.notEqual(buildStartList(cohortChanged, { sort: 'bib' }).contentHash, h0);

  // a fresh generation of the identical roster is stable
  assert.equal(buildStartList(base, { sort: 'bib' }).contentHash, h0);
});

test('normalizeStartListSort: bib | name | empty→bib | anything else→null', () => {
  assert.equal(normalizeStartListSort('bib'), 'bib');
  assert.equal(normalizeStartListSort('name'), 'name');
  assert.equal(normalizeStartListSort(''), 'bib');
  assert.equal(normalizeStartListSort(null), 'bib');
  assert.equal(normalizeStartListSort(undefined), 'bib');
  assert.equal(normalizeStartListSort('BIB'), null);
  assert.equal(normalizeStartListSort('date'), null);
});

test('CSV cell grid: fixed header, paper columns blank when pending, "OK hh:mm" when recorded', () => {
  const rows = [
    src({ status: 'paid', bibNumber: '1100', name: 'Ana', cpfMasked: '111.***.***-11', distance: '5K', shirtSize: 'M' }),
    src({ status: 'paid', bibNumber: '1101', name: 'Bruno', checkInRecorded: true, checkInAt: '2026-09-20T06:42:00Z', kitRecorded: true, kitAt: '2026-09-20T06:43:00Z' }),
  ];
  const grid = startListCsvCells(buildStartList(rows, { sort: 'bib' }));
  assert.deepEqual(grid[0], [...START_LIST_CSV_HEADERS]);
  assert.equal(grid[0].length, 9);
  const ana = grid[1];
  assert.deepEqual(ana, ['1100', 'Ana', '111.***.***-11', '5K', 'M', 'SIM', '', '', rows[0].id]);
  const bruno = grid[2];
  assert.equal(bruno[6], 'OK 06:42');
  assert.equal(bruno[7], 'OK 06:43');
});

test('CSV cell grid: unresolved distance is marked with "(?)"', () => {
  const grid = startListCsvCells(buildStartList([src({ status: 'paid', bibNumber: '1200', distance: 'distance-5k', distanceId: 'distance-5k' })], { sort: 'bib' }));
  assert.equal(grid[1][3], 'distance-5k (?)');
});

test('input is never mutated', () => {
  const rows = [src({ status: 'paid', bibNumber: '1300' }), src({ status: 'expired' })];
  const snapshot = JSON.stringify(rows);
  buildStartList(rows, { sort: 'bib' });
  buildStartList(rows, { sort: 'name' });
  assert.equal(JSON.stringify(rows), snapshot);
});
