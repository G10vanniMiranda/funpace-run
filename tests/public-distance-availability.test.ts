import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DISTANCE_CLOSED_LABEL,
  isDistanceSelectable,
  selectDistanceAvailability,
} from '../src/lib/publicDistanceAvailability';
import type { AvailabilityResponse } from '../src/types/registration';

// EVENT-OPS — 10K registration closure (5K stays open). The public distance
// selector must reflect the canonical run-distances.status from
// /api/availability, the SAME field createPendingRegistrationInPostgres uses
// server-side (`where ... name = $2 and status = $3`, [event.id, distance, 'active']).
// A future distance reopen/close must require ZERO source-code change here —
// only a data change to run-distances.status.

const distance = (over: Partial<AvailabilityResponse['distances'][number]>): AvailabilityResponse['distances'][number] => ({
  id: 'distance-x', name: '5K', capacity: 100, soldCount: 0, remaining: 100, status: 'active', ...over,
});
const avail = (distances: AvailabilityResponse['distances']): AvailabilityResponse => ({
  event: { id: 'e', name: 'E', slug: 'e', status: 'published' },
  lots: [],
  distances,
});

const FIVE_K_ACTIVE = distance({ id: 'distance-5k', name: '5K', status: 'active' });
const TEN_K_INACTIVE = distance({ id: 'distance-10k', name: '10K', status: 'inactive' });
const TEN_K_ACTIVE = distance({ id: 'distance-10k', name: '10K', status: 'active' });

test('A — 5K active + 10K inactive -> 5K open, 10K closed', () => {
  const data = avail([FIVE_K_ACTIVE, TEN_K_INACTIVE]);
  assert.equal(selectDistanceAvailability(data, '5K'), 'open');
  assert.equal(selectDistanceAvailability(data, '10K'), 'closed');
});

test('B — order does not matter', () => {
  assert.deepEqual(
    selectDistanceAvailability(avail([FIVE_K_ACTIVE, TEN_K_INACTIVE]), '10K'),
    selectDistanceAvailability(avail([TEN_K_INACTIVE, FIVE_K_ACTIVE]), '10K'),
  );
});

test('C — both active -> both open (current state before closure / after a future reopen)', () => {
  const data = avail([FIVE_K_ACTIVE, TEN_K_ACTIVE]);
  assert.equal(selectDistanceAvailability(data, '5K'), 'open');
  assert.equal(selectDistanceAvailability(data, '10K'), 'open');
});

test('D — availability not resolved yet -> unknown, never closed (fail open on the UI decoration)', () => {
  assert.equal(selectDistanceAvailability(null, '10K'), 'unknown');
});

test('E — distance absent from the response -> unknown, not closed', () => {
  assert.equal(selectDistanceAvailability(avail([FIVE_K_ACTIVE]), '10K'), 'unknown');
});

test('F — any non-active status (e.g. a defensive "sold_out") is treated as closed, not just "inactive"', () => {
  const soldOut = distance({ id: 'distance-10k', name: '10K', status: 'sold_out' });
  assert.equal(selectDistanceAvailability(avail([soldOut]), '10K'), 'closed');
});

test('isDistanceSelectable is true for open/unknown, false only for closed', () => {
  assert.equal(isDistanceSelectable('open'), true);
  assert.equal(isDistanceSelectable('unknown'), true);
  assert.equal(isDistanceSelectable('closed'), false);
});

test('selector is a pure function of its inputs (deterministic)', () => {
  const input = avail([FIVE_K_ACTIVE, TEN_K_INACTIVE]);
  assert.deepEqual(selectDistanceAvailability(input, '10K'), selectDistanceAvailability(input, '10K'));
});

// ---- source contract: the public form renders live status, not a static list ----

const forms = readFileSync('src/components/forms.tsx', 'utf8');

test('G — RegistrationSection disables a closed distance option instead of trusting a static list', () => {
  assert.match(forms, /selectDistanceAvailability\(availability, option\.value as RaceDistance\)/);
  assert.match(forms, /isDistanceSelectable\(distanceState\)/);
  assert.match(forms, /disabled=\{!selectable\}/);
  assert.match(forms, /\$\{DISTANCE_CLOSED_LABEL\}/, 'the closed-option copy is sourced from the shared constant, not duplicated inline');
  assert.equal(DISTANCE_CLOSED_LABEL, 'Inscrições encerradas');
});

test('H — the default selected distance is no longer the one being closed (10K)', () => {
  assert.match(forms, /distance:\s*'5K',/);
  assert.doesNotMatch(forms, /distance:\s*'10K',/);
});

test('I — no separate/duplicated distance-closed source of truth is introduced in config', () => {
  const eventConfig = readFileSync('src/config/event.ts', 'utf8');
  assert.doesNotMatch(eventConfig, /distanceClosed|closedDistances|tenKClosed/i);
});
