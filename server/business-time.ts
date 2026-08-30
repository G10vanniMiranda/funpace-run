/**
 * ADMIN-002 Stage 2 — BUSINESS TIME AUTHORITY.
 *
 * One place that knows how the FUNPACE operation reads a calendar: "today",
 * "this week", "which hour", "which chart day" are all interpreted in
 * America/Porto_Velho, regardless of the process timezone or where a viewer's
 * browser is. UTC stays correct for storage / transport / ISO timestamps and
 * is never reinterpreted here.
 *
 * No dashboard metric may do timezone arithmetic on its own — it calls these
 * primitives. The rule is expressed as an IANA zone, never as a fixed "-4h"
 * offset (Porto Velho is UTC-4 today and has no DST, but the offset is derived,
 * not assumed).
 *
 * Determinism: every function resolves the zone through Intl with an explicit
 * `timeZone`, so results are identical under TZ=UTC, TZ=America/Sao_Paulo, etc.
 */

/** Official business timezone (ratified by the ADMIN-002 Human Business Gate). */
export const BUSINESS_TIMEZONE = 'America/Porto_Velho';

const WALL_CLOCK_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

type BusinessWallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  isoWeekday: number; // Mon=1 .. Sun=7
};

function toInstant(value: string | number | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  return date;
}

/** The business-local wall clock for an instant. */
export function businessWallClock(value: string | number | Date): BusinessWallClock {
  const date = toInstant(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`businessWallClock: invalid instant ${String(value)}`);
  }
  const parts = Object.fromEntries(
    WALL_CLOCK_FORMAT.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    isoWeekday: WEEKDAY_TO_ISO[parts.weekday] ?? 1,
  };
}

/** 'YYYY-MM-DD' calendar date of an instant, in the business timezone. */
export function businessDateKey(value: string | number | Date): string {
  const clock = businessWallClock(value);
  const mm = String(clock.month).padStart(2, '0');
  const dd = String(clock.day).padStart(2, '0');
  return `${clock.year}-${mm}-${dd}`;
}

/** Hour bucket 0..23 of an instant, in the business timezone. */
export function businessHour(value: string | number | Date): number {
  return businessWallClock(value).hour;
}

/** Today's 'YYYY-MM-DD' in the business timezone. */
export function businessTodayKey(now: Date = new Date()): string {
  return businessDateKey(now);
}

/**
 * Convert a business-local wall-clock (y, m 1-12, d, h, mi, s) to the UTC
 * instant it denotes. Derives the zone offset at that wall time via Intl —
 * no hardcoded offset. One correction pass is exact for a DST-free zone and
 * still correct here because the business zone has no DST.
 */
export function businessWallClockToInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const clock = businessWallClock(new Date(asIfUtc));
  const roundTrip = Date.UTC(
    clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second,
  );
  const offset = roundTrip - asIfUtc; // ms the zone is ahead of UTC at this wall time
  return new Date(asIfUtc - offset);
}

/** Instant of 00:00:00.000 business-local on the day that contains `now`. */
export function businessDayStart(now: Date = new Date()): Date {
  const clock = businessWallClock(now);
  return businessWallClockToInstant(clock.year, clock.month, clock.day, 0, 0, 0);
}

/**
 * Instant of Monday 00:00:00.000 business-local of the calendar week that
 * contains `now` (week starts Monday). Range is [businessWeekStart(now), now].
 */
export function businessWeekStart(now: Date = new Date()): Date {
  const clock = businessWallClock(now);
  const daysSinceMonday = clock.isoWeekday - 1; // Mon=0 .. Sun=6
  const noonAnchor = Date.UTC(clock.year, clock.month - 1, clock.day - daysSinceMonday, 12, 0, 0);
  const mondayClock = businessWallClock(new Date(noonAnchor));
  return businessWallClockToInstant(mondayClock.year, mondayClock.month, mondayClock.day, 0, 0, 0);
}

/**
 * `count` business-local 'YYYY-MM-DD' keys ending on today's business date,
 * oldest first. Used to lay out the daily revenue chart deterministically.
 */
export function businessDateKeysEndingToday(now: Date = new Date(), count: number): string[] {
  const clock = businessWallClock(now);
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    // noon anchor keeps us on the intended local date for any sane zone offset
    const anchor = Date.UTC(clock.year, clock.month - 1, clock.day - offset, 12, 0, 0);
    keys.push(businessDateKey(new Date(anchor)));
  }
  return keys;
}
