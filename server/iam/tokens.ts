/**
 * ADMIN-IAM-001 Stage 1 — pure primitives for invite / password-reset tokens.
 *
 * A token is a high-entropy random bearer string. Only its SHA-256 hash is ever
 * persisted (`run-admin-auth-tokens.token_hash`). The raw token is returned once
 * to the issuer (which later builds the link) and must never be stored or logged.
 *
 * This module is pure: no DB, no HTTP, no email, no request context. The
 * transactional consume/issue flow belongs to IAM-2/3.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const AUTH_TOKEN_PURPOSES = ['invite', 'reset'] as const;
export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number];

/** Approved TTLs (Stage 0 §14). Centralised — no magic numbers elsewhere. */
export const AUTH_TOKEN_TTL_MS: Record<AuthTokenPurpose, number> = {
  invite: 72 * 60 * 60 * 1000,
  reset: 60 * 60 * 1000,
};

/** 32 bytes = 256 bits of CSPRNG entropy, url-safe. */
const TOKEN_ENTROPY_BYTES = 32;
/** SHA-256 hex — matches the DB CHECK `^[0-9a-f]{64}$`. */
const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

export function isAuthTokenPurpose(value: unknown): value is AuthTokenPurpose {
  return typeof value === 'string' && (AUTH_TOKEN_PURPOSES as readonly string[]).includes(value);
}

export function assertAuthTokenPurpose(value: unknown): AuthTokenPurpose {
  if (!isAuthTokenPurpose(value)) {
    throw new Error(`Unknown auth token purpose: ${String(value)}`);
  }
  return value;
}

/** SHA-256 hex of a raw token. Deterministic; safe to store. */
export function hashAuthToken(rawToken: string): string {
  return createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

export type GeneratedAuthToken = {
  /** raw bearer token — return to the issuer, never persist/log. */
  token: string;
  /** SHA-256 hex — persist this. */
  tokenHash: string;
};

export function generateAuthToken(): GeneratedAuthToken {
  const token = randomBytes(TOKEN_ENTROPY_BYTES).toString('base64url');
  return { token, tokenHash: hashAuthToken(token) };
}

/**
 * Constant-time check that a candidate raw token matches a stored hash.
 * Returns false (never throws) on any malformed input.
 */
export function verifyAuthToken(candidateRawToken: string, expectedTokenHash: string): boolean {
  if (typeof candidateRawToken !== 'string' || typeof expectedTokenHash !== 'string') return false;
  if (!TOKEN_HASH_PATTERN.test(expectedTokenHash)) return false;
  const candidateHash = hashAuthToken(candidateRawToken);
  const a = Buffer.from(candidateHash, 'utf8');
  const b = Buffer.from(expectedTokenHash, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** ISO expiry for a freshly issued token of `purpose`. */
export function authTokenExpiresAt(purpose: AuthTokenPurpose, from: Date = new Date()): string {
  return new Date(from.getTime() + AUTH_TOKEN_TTL_MS[assertAuthTokenPurpose(purpose)]).toISOString();
}

export type AuthTokenState = 'active' | 'expired' | 'consumed';

/** Minimal shape needed to reason about a stored token row. */
export type AuthTokenLifecycle = {
  expiresAt: string;
  consumedAt: string | null;
};

/**
 * Deterministic priority: consumed > expired > active. A consumed token is never
 * "active" even if not yet past `expiresAt`.
 */
export function classifyAuthToken(token: AuthTokenLifecycle, now: Date = new Date()): AuthTokenState {
  if (token.consumedAt) return 'consumed';
  const expiresAtMs = Date.parse(token.expiresAt);
  if (!Number.isFinite(expiresAtMs) || now.getTime() >= expiresAtMs) return 'expired';
  return 'active';
}

export function isAuthTokenActive(token: AuthTokenLifecycle, now: Date = new Date()): boolean {
  return classifyAuthToken(token, now) === 'active';
}
