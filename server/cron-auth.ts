import { timingSafeEqual } from 'node:crypto';

export function isCronAuthorizationValid(secret: string, authorization: string | undefined) {
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
