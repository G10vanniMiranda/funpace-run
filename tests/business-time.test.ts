import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUSINESS_TIMEZONE,
  businessDateKey,
  businessDateKeysEndingToday,
  businessHour,
  businessTodayKey,
  businessWallClock,
  businessWallClockToInstant,
  businessWeekStart,
} from '../server/business-time';

// America/Porto_Velho is UTC-4 year round (no DST).

// -- §28 --------------------------------------------------------------------
test('BUSINESS_TIMEZONE is America/Porto_Velho', () => {
  assert.equal(BUSINESS_TIMEZONE, 'America/Porto_Velho');
});

// -- §19 midnight boundary ------------------------------------------------------
test('03:59:59Z is still the previous local day; 04:00:00Z rolls into the new local day', () => {
  assert.equal(businessDateKey('2026-08-30T03:59:59.999Z'), '2026-08-29');
  assert.equal(businessHour('2026-08-30T03:59:59.999Z'), 23);
  assert.equal(businessDateKey('2026-08-30T04:00:00.000Z'), '2026-08-30');
  assert.equal(businessHour('2026-08-30T04:00:00.000Z'), 0);
});

// -- §20 late local evening --------------------------------------------------
test('02:00Z of the next UTC day is still the previous day in Porto Velho', () => {
  assert.equal(businessDateKey('2026-08-30T02:00:00.000Z'), '2026-08-29');
  assert.equal(businessHour('2026-08-30T02:00:00.000Z'), 22);
});

// -- §24 hourly ------------------------------------------------------------------
test('an event at 05:30Z buckets to local hour 01, not 05', () => {
  assert.equal(businessHour('2026-08-30T05:30:00.000Z'), 1);
  assert.equal(businessHour('2026-08-30T09:15:00.000Z'), 5);
});

// -- §22/§23 week start (Monday 00:00 local, week-to-date) ---------------------
test('businessWeekStart is Monday 00:00 business-local of the current week, as an instant', () => {
  // now = Wednesday 2026-08-26 11:00 local (15:00Z)
  const now = new Date('2026-08-26T15:00:00.000Z');
  const weekStart = businessWeekStart(now);
  assert.equal(weekStart.toISOString(), '2026-08-24T04:00:00.000Z'); // Mon 00:00 -03? no: UTC-4 => 04:00Z
  assert.equal(businessDateKey(weekStart), '2026-08-24');
  assert.equal(businessHour(weekStart), 0);

  // Sunday 23:59:59.999 local is BEFORE the week start
  const sundayLateLocal = new Date('2026-08-24T03:59:59.999Z'); // = 2026-08-23 23:59:59.999 local
  assert.ok(sundayLateLocal < weekStart);
  // Monday 00:00:00.000 local is exactly the week start
  const mondayMidnightLocal = new Date('2026-08-24T04:00:00.000Z');
  assert.ok(mondayMidnightLocal >= weekStart);
});

test('businessWeekStart on a Monday returns that same Monday 00:00 local', () => {
  const monday = new Date('2026-08-24T18:00:00.000Z'); // Mon 14:00 local
  assert.equal(businessWeekStart(monday).toISOString(), '2026-08-24T04:00:00.000Z');
});

test('businessWeekStart on a Sunday returns the Monday six days earlier', () => {
  const sunday = new Date('2026-08-30T14:00:00.000Z'); // Sun 10:00 local
  assert.equal(businessWeekStart(sunday).toISOString(), '2026-08-24T04:00:00.000Z');
});

// -- §25 daily key list -------------------------------------------------------
test('businessDateKeysEndingToday returns local calendar dates, oldest first, ending today', () => {
  const now = new Date('2026-08-30T02:00:00.000Z'); // local 2026-08-29 22:00
  assert.deepEqual(businessDateKeysEndingToday(now, 3), ['2026-08-27', '2026-08-28', '2026-08-29']);
  assert.equal(businessTodayKey(now), '2026-08-29');
});

test('businessDateKeysEndingToday crosses a month boundary correctly', () => {
  const now = new Date('2026-09-01T10:00:00.000Z'); // local 2026-09-01 06:00
  assert.deepEqual(businessDateKeysEndingToday(now, 3), ['2026-08-30', '2026-08-31', '2026-09-01']);
});

// -- §27 host-TZ / input-shape independence ----------------------------------
test('results do not depend on how the instant is expressed', () => {
  const iso = '2026-08-30T03:00:00.000Z';
  const epoch = Date.parse(iso);
  assert.equal(businessDateKey(iso), businessDateKey(new Date(iso)));
  assert.equal(businessDateKey(iso), businessDateKey(epoch));
  assert.equal(businessHour(iso), businessHour(new Date(epoch)));
});

test('businessWallClockToInstant round-trips a business-local wall clock', () => {
  const instant = businessWallClockToInstant(2026, 8, 29, 22, 0, 0);
  assert.equal(instant.toISOString(), '2026-08-30T02:00:00.000Z');
  const clock = businessWallClock(instant);
  assert.deepEqual(
    { y: clock.year, mo: clock.month, d: clock.day, h: clock.hour, mi: clock.minute },
    { y: 2026, mo: 8, d: 29, h: 22, mi: 0 },
  );
  assert.equal(clock.isoWeekday, 6); // Saturday
});
