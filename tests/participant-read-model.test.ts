import assert from 'node:assert/strict';
import test from 'node:test';

import type { RegistrationRecord } from '../server/database.js';
import {
  consolidateParticipants,
  pickCanonicalRegistration,
  toRegistrationHistory,
} from '../server/participant-read-model.js';

// ADMIN-003 Stage 2 §45-51 — the person-centric read model is deterministic,
// provider-independent and never mutates its input. It groups by cpf_hash
// WITHIN one already-event-scoped set of registrations, picks a canonical row
// (paid > active > newest) and exposes every attempt as history.

let seq = 0;
function reg(overrides: Partial<RegistrationRecord> & { cpfHash: string; status: RegistrationRecord['status'] }): RegistrationRecord {
  seq += 1;
  return {
    id: overrides.id ?? `reg-${String(seq).padStart(4, '0')}`,
    eventId: overrides.eventId ?? 'evt-1',
    distanceId: overrides.distanceId ?? 'dist-1',
    lotId: overrides.lotId ?? 'lot-1',
    amountCents: overrides.amountCents ?? 10_000,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    paidAt: overrides.paidAt ?? null,
    payload: (overrides.payload ?? { fullName: 'X', email: 'x@x.com', phone: '11999999999', cpf: '00000000000' }) as RegistrationRecord['payload'],
    ...overrides,
  } as RegistrationRecord;
}

test('§45 one person, one attempt → one row, history of length 1', () => {
  const rows = [reg({ cpfHash: 'a', status: 'paid', paidAt: '2026-01-02T00:00:00.000Z' })];
  const [person] = consolidateParticipants(rows);
  assert.equal(consolidateParticipants(rows).length, 1);
  assert.equal(person.canonical.id, rows[0].id);
  assert.equal(person.history.length, 1);
  assert.equal(person.personKey, 'cpf:a');
});

test('§46 retries collapse to one person; every attempt kept in history', () => {
  const rows = [
    reg({ cpfHash: 'a', status: 'expired', createdAt: '2026-01-01T00:00:00.000Z' }),
    reg({ cpfHash: 'a', status: 'cancelled', createdAt: '2026-01-02T00:00:00.000Z' }),
    reg({ cpfHash: 'a', status: 'pending_payment', createdAt: '2026-01-03T00:00:00.000Z' }),
  ];
  const people = consolidateParticipants(rows);
  assert.equal(people.length, 1);
  assert.equal(people[0].history.length, 3);
  // history is newest-first
  assert.deepEqual(people[0].history.map((r) => r.status), ['pending_payment', 'cancelled', 'expired']);
});

test('§47 canonical priority: a paid attempt always wins over active / historical', () => {
  const rows = [
    reg({ cpfHash: 'a', status: 'pending_payment', createdAt: '2026-01-05T00:00:00.000Z' }),
    reg({ cpfHash: 'a', status: 'paid', createdAt: '2026-01-02T00:00:00.000Z', paidAt: '2026-01-02T12:00:00.000Z' }),
    reg({ cpfHash: 'a', status: 'expired', createdAt: '2026-01-09T00:00:00.000Z' }),
  ];
  assert.equal(pickCanonicalRegistration(rows).status, 'paid');
});

test('§48 canonical priority: active attempt wins when there is no paid one', () => {
  const rows = [
    reg({ cpfHash: 'a', status: 'expired', createdAt: '2026-01-09T00:00:00.000Z' }),
    reg({ cpfHash: 'a', status: 'pending_payment', createdAt: '2026-01-03T00:00:00.000Z' }),
    reg({ cpfHash: 'a', status: 'cancelled', createdAt: '2026-01-10T00:00:00.000Z' }),
  ];
  assert.equal(pickCanonicalRegistration(rows).status, 'pending_payment');
});

test('§49 canonical priority: newest historical attempt when nothing is paid/active', () => {
  const rows = [
    reg({ cpfHash: 'a', id: 'old', status: 'expired', createdAt: '2026-01-01T00:00:00.000Z' }),
    reg({ cpfHash: 'a', id: 'new', status: 'cancelled', createdAt: '2026-01-08T00:00:00.000Z' }),
  ];
  assert.equal(pickCanonicalRegistration(rows).id, 'new');
});

test('§50 same person in two events → one person per event (dedup is within-set only)', () => {
  // The model is always handed ONE event's rows. Called twice, the same
  // cpf_hash yields one person each time — never merged across the calls.
  const eventA = [reg({ cpfHash: 'a', eventId: 'evt-A', status: 'paid', paidAt: '2026-01-02T00:00:00.000Z' })];
  const eventB = [reg({ cpfHash: 'a', eventId: 'evt-B', status: 'pending_payment' })];
  assert.equal(consolidateParticipants(eventA).length, 1);
  assert.equal(consolidateParticipants(eventB).length, 1);
  assert.equal(consolidateParticipants([...eventA, ...eventB]).length, 1); // still one cpf_hash bucket
});

test('§51 multi-paid defence: deterministic pick (latest paidAt), all attempts preserved', () => {
  const rows = [
    reg({ cpfHash: 'a', id: 'p1', status: 'paid', createdAt: '2026-01-01T00:00:00.000Z', paidAt: '2026-01-01T10:00:00.000Z' }),
    reg({ cpfHash: 'a', id: 'p2', status: 'paid', createdAt: '2026-01-02T00:00:00.000Z', paidAt: '2026-01-05T10:00:00.000Z' }),
    reg({ cpfHash: 'a', id: 'p3', status: 'paid', createdAt: '2026-01-03T00:00:00.000Z', paidAt: '2026-01-03T10:00:00.000Z' }),
  ];
  assert.equal(pickCanonicalRegistration(rows).id, 'p2');
  assert.equal(pickCanonicalRegistration([...rows].reverse()).id, 'p2'); // order-independent
  assert.equal(consolidateParticipants(rows)[0].history.length, 3);
});

test('§51b a row without a cpf_hash stands alone, keyed by its own id', () => {
  const rows = [
    reg({ cpfHash: '', id: 'lonely', status: 'pending_payment' }),
    reg({ cpfHash: '', id: 'also-lonely', status: 'expired' }),
  ];
  const people = consolidateParticipants(rows);
  assert.equal(people.length, 2);
  assert.deepEqual(people.map((p) => p.personKey).sort(), ['id:also-lonely', 'id:lonely']);
});

test('the model never mutates its input', () => {
  const rows = [
    reg({ cpfHash: 'a', status: 'expired', createdAt: '2026-01-02T00:00:00.000Z' }),
    reg({ cpfHash: 'a', status: 'paid', createdAt: '2026-01-01T00:00:00.000Z', paidAt: '2026-01-01T00:00:00.000Z' }),
  ];
  const snapshot = JSON.stringify(rows);
  consolidateParticipants(rows);
  pickCanonicalRegistration(rows);
  assert.equal(JSON.stringify(rows), snapshot);
});

test('toRegistrationHistory is a minimal PII-free projection with the canonical flag', () => {
  const rows = [
    reg({ cpfHash: 'a', id: 'canon', status: 'paid', createdAt: '2026-01-01T00:00:00.000Z', paidAt: '2026-01-01T09:00:00.000Z', amountCents: 12_345 }),
    reg({ cpfHash: 'a', id: 'past', status: 'expired', createdAt: '2025-12-01T00:00:00.000Z' }),
  ];
  const history = toRegistrationHistory(consolidateParticipants(rows)[0]);
  assert.deepEqual(
    history.map((item) => ({ ...item })),
    [
      { id: 'canon', status: 'paid', createdAt: '2026-01-01T00:00:00.000Z', amountCents: 12_345, paidAt: '2026-01-01T09:00:00.000Z', isCanonical: true },
      { id: 'past', status: 'expired', createdAt: '2025-12-01T00:00:00.000Z', amountCents: 10_000, paidAt: null, isCanonical: false },
    ],
  );
  // no name / email / cpf / phone leaked
  for (const item of history) {
    assert.deepEqual(Object.keys(item).sort(), ['amountCents', 'createdAt', 'id', 'isCanonical', 'paidAt', 'status']);
  }
});

test('§44 10k synthetic fixture: grouping, isolation, canonical selection and runtime', () => {
  const rows: RegistrationRecord[] = [];
  const PEOPLE = 4_000;
  let paidPeople = 0;
  for (let personIndex = 0; personIndex < PEOPLE; personIndex += 1) {
    const cpfHash = `cpf-${personIndex}`;
    const attempts = 1 + (personIndex % 4); // 1..4 attempts
    let willBePaid = personIndex % 3 === 0;
    if (willBePaid) paidPeople += 1;
    for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex += 1) {
      const isLast = attemptIndex === attempts - 1;
      rows.push(reg({
        cpfHash,
        id: `r-${personIndex}-${attemptIndex}`,
        status: willBePaid && isLast ? 'paid' : attemptIndex % 2 === 0 ? 'expired' : 'cancelled',
        createdAt: `2026-01-${String(1 + attemptIndex).padStart(2, '0')}T0${personIndex % 9}:00:00.000Z`,
        paidAt: willBePaid && isLast ? `2026-02-${String(1 + attemptIndex).padStart(2, '0')}T00:00:00.000Z` : null,
      }));
    }
  }
  // shuffle to prove order-independence
  for (let i = rows.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  const started = performance.now();
  const people = consolidateParticipants(rows);
  const elapsedMs = performance.now() - started;

  assert.equal(people.length, PEOPLE, 'exactly one row per cpf_hash');
  assert.equal(
    people.reduce((sum, person) => sum + person.history.length, 0),
    rows.length,
    'every registration row appears in exactly one person history',
  );
  assert.equal(people.filter((person) => person.canonical.status === 'paid').length, paidPeople);
  // deterministic: a second pass yields the same canonical ids
  const again = consolidateParticipants([...rows].reverse());
  const keyToCanonical = new Map(people.map((person) => [person.personKey, person.canonical.id]));
  for (const person of again) {
    assert.equal(person.canonical.id, keyToCanonical.get(person.personKey));
  }
  assert.ok(elapsedMs < 750, `consolidation stayed well under budget (${elapsedMs.toFixed(1)}ms)`);
});
