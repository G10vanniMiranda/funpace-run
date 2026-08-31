import assert from 'node:assert/strict';
import test from 'node:test';

import type { Database, RegistrationRecord } from '../server/database.js';
import { buildParticipantsPage } from '../server/index.js';

// ADMIN-003 Stage 2 — HUMAN GATE correction: the counter semantics.
//
// "N pessoas · M registros históricos" is only coherent if N and M belong to
// the SAME universe — the full result set AFTER event scope + consolidation +
// search + filters, but BEFORE the page slice. These tests pin exactly that:
// the totals are global and identical on every page.

let seq = 0;
function payload(name: string, team = ''): RegistrationRecord['payload'] {
  return {
    fullName: name, email: `${name}@example.com`, phone: '11999999999', cpf: '00000000000',
    city: 'Porto Velho', team, gender: 'female', shirtSize: 'M', birthDate: '1990-01-01',
    emergencyContactName: 'X', emergencyContactPhone: '11988888888', state: 'RO', distance: '5km',
  } as unknown as RegistrationRecord['payload'];
}
function reg(over: Partial<RegistrationRecord> & { cpfHash: string; status: RegistrationRecord['status'] }): RegistrationRecord {
  seq += 1;
  return {
    id: over.id ?? `reg-${String(seq).padStart(4, '0')}`,
    eventId: over.eventId ?? 'evt-1',
    distanceId: over.distanceId ?? 'dist-1',
    lotId: over.lotId ?? 'lot-1',
    amountCents: over.amountCents ?? 10_000,
    createdAt: over.createdAt ?? `2026-01-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    updatedAt: over.updatedAt ?? over.createdAt ?? '2026-01-01T00:00:00.000Z',
    paidAt: over.paidAt ?? null,
    payload: over.payload ?? payload(`Pessoa ${over.cpfHash}`),
    ...over,
  } as RegistrationRecord;
}

function db(registrations: RegistrationRecord[]): Database {
  return {
    registrations,
    events: [],
    distances: [],
    lots: [],
    payments: [],
    paymentEvents: [],
    checkIns: [],
    kitDeliveries: [],
    googleSheetSyncs: [],
    emailDeliveries: [],
    auditLogs: [],
  } as unknown as Database;
}

function url(query: Record<string, string>): URL {
  const u = new URL('https://admin.local/api/admin/registrations');
  u.searchParams.set('view', 'people');
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u;
}

test('§ mandated: 5 people, pageSize 2 — page 1/2/3 keep the exact same global totals', () => {
  // 5 people; attempts distributed 1..4 → 1+2+3+4+2 = 12 registration rows.
  const registrations: RegistrationRecord[] = [];
  const attemptsByPerson = [1, 2, 3, 4, 2];
  attemptsByPerson.forEach((attempts, personIndex) => {
    for (let a = 0; a < attempts; a += 1) {
      registrations.push(reg({
        cpfHash: `p${personIndex}`,
        id: `p${personIndex}-a${a}`,
        status: a === attempts - 1 ? 'pending_payment' : 'expired',
        createdAt: `2026-0${personIndex + 1}-0${a + 1}T00:00:00.000Z`,
      }));
    }
  });
  const totalRegistrations = registrations.length; // 12
  const database = db(registrations);

  const page1 = buildParticipantsPage(url({ page: '1', pageSize: '2' }), database);
  assert.equal(page1.registrations.length, 2);
  assert.equal(page1.pagination.total, 5);
  assert.equal(page1.pagination.people, 5);
  assert.equal(page1.pagination.historicalRegistrations, totalRegistrations);
  assert.equal(page1.pagination.totalPages, 3);

  const page2 = buildParticipantsPage(url({ page: '2', pageSize: '2' }), database);
  assert.equal(page2.registrations.length, 2);
  assert.equal(page2.pagination.total, 5);
  assert.equal(page2.pagination.people, 5);
  assert.equal(page2.pagination.historicalRegistrations, totalRegistrations);

  const page3 = buildParticipantsPage(url({ page: '3', pageSize: '2' }), database);
  assert.equal(page3.registrations.length, 1); // 5 people → last page has 1
  assert.equal(page3.pagination.total, 5);
  assert.equal(page3.pagination.people, 5);
  assert.equal(page3.pagination.historicalRegistrations, totalRegistrations);

  // every person appears exactly once across the three pages
  const ids = [...page1.registrations, ...page2.registrations, ...page3.registrations].map((r) => r.id).sort();
  assert.equal(new Set(ids).size, 5);
});

test('§ mandated: with a filter — global 5 people / 12 attempts → filtered 3 people / 8 attempts on every page', () => {
  const registrations: RegistrationRecord[] = [];
  // 5 people, 12 attempts total. 3 of them are in team "ALFA" holding 8 attempts
  // (3 + 3 + 2); the other 2 people (team "BETA") hold 4 attempts (2 + 2).
  const spec = [
    { team: 'ALFA', attempts: 3 },
    { team: 'ALFA', attempts: 3 },
    { team: 'ALFA', attempts: 2 },
    { team: 'BETA', attempts: 2 },
    { team: 'BETA', attempts: 2 },
  ];
  spec.forEach((person, personIndex) => {
    for (let a = 0; a < person.attempts; a += 1) {
      registrations.push(reg({
        cpfHash: `q${personIndex}`,
        id: `q${personIndex}-a${a}`,
        status: a === person.attempts - 1 ? 'pending_payment' : 'cancelled',
        createdAt: `2026-0${personIndex + 1}-0${a + 1}T00:00:00.000Z`,
        payload: payload(`Pessoa q${personIndex}`, person.team),
      }));
    }
  });
  assert.equal(registrations.length, 12);
  const database = db(registrations);

  // sanity: unfiltered universe
  const all = buildParticipantsPage(url({ pageSize: '2' }), database);
  assert.equal(all.pagination.people, 5);
  assert.equal(all.pagination.historicalRegistrations, 12);

  // filtered to team ALFA — 3 people, 8 attempts — on EVERY page of that filter
  for (const page of ['1', '2']) {
    const filtered = buildParticipantsPage(url({ team: 'ALFA', page, pageSize: '2' }), database);
    assert.equal(filtered.pagination.people, 3, `page ${page}: people`);
    assert.equal(filtered.pagination.total, 3, `page ${page}: total`);
    assert.equal(filtered.pagination.historicalRegistrations, 8, `page ${page}: historicalRegistrations`);
  }
  const filteredP1 = buildParticipantsPage(url({ team: 'ALFA', page: '1', pageSize: '2' }), database);
  const filteredP2 = buildParticipantsPage(url({ team: 'ALFA', page: '2', pageSize: '2' }), database);
  assert.equal(filteredP1.registrations.length, 2);
  assert.equal(filteredP2.registrations.length, 1);
});

test('historicalRegistrations equals the sum of the visible+hidden people attemptsCount', () => {
  const registrations = [
    reg({ cpfHash: 'a', status: 'expired', createdAt: '2026-01-01T00:00:00.000Z' }),
    reg({ cpfHash: 'a', status: 'pending_payment', createdAt: '2026-01-02T00:00:00.000Z' }),
    reg({ cpfHash: 'b', status: 'paid', paidAt: '2026-01-03T00:00:00.000Z', createdAt: '2026-01-03T00:00:00.000Z' }),
  ];
  const page = buildParticipantsPage(url({ pageSize: '1', page: '1' }), db(registrations));
  assert.equal(page.registrations.length, 1);        // only 1 person on the page
  assert.equal(page.pagination.people, 2);           // but 2 people total
  assert.equal(page.pagination.historicalRegistrations, 3); // 2 + 1 attempts, global
});
