import { createHmac, timingSafeEqual } from 'node:crypto';

// EMAIL-OPS-003 Stage 2 — Resend webhook signature verification.
//
// Resend signs webhooks with the Svix scheme (svix-id / svix-timestamp /
// svix-signature headers, a per-endpoint `whsec_...` secret). This is a
// PUBLISHED, stable HMAC-SHA256 construction — not bespoke cryptography — and
// this repository already verifies HMAC signatures with node:crypto for admin
// sessions and the payment webhook token (server/payment-webhook-auth.ts).
// Adding the `svix` npm package (with its own transitive dependencies) for one
// serverless function contradicts the repo's zero-runtime-dependency stance for
// this class of check (raw fetch for the Resend send, hand-rolled HMAC for
// cookies). Decision: verify in ~40 lines of node:crypto here, and let
// EMAIL-OPS-003 Stage 3 prove it against a REAL signed event from the Resend
// webhook portal.
//
// Svix signed content:  `${svixId}.${svixTimestamp}.${rawBody}`
// Key:                   base64-decode(secret without the `whsec_` prefix)
// Signature:             base64( HMAC_SHA256(key, signedContent) )
// Header `svix-signature`: space-delimited `v1,<b64sig>` tokens (multiple
//                         during secret rotation) — a match on ANY token passes.
// Replay protection:     reject when |now - svixTimestamp| > tolerance.

export const RESEND_WEBHOOK_DEFAULT_TOLERANCE_SECONDS = 300;

export type ResendWebhookHeaders = {
  svixId?: string | null;
  svixTimestamp?: string | null;
  svixSignature?: string | null;
};

export type ResendWebhookRejectReason = 'missing_secret' | 'missing_headers' | 'stale_timestamp' | 'invalid_signature';
export type ResendWebhookVerification =
  | { ok: true; reason?: undefined }
  | { ok: false; reason: ResendWebhookRejectReason };

export function readResendWebhookHeaders(
  headers: Record<string, string | string[] | undefined>,
): ResendWebhookHeaders {
  const lowerEntries = Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value] as const);
  const pick = (name: string): string | null => {
    const match = lowerEntries.find(([key]) => key === name);
    const value = match ? match[1] : undefined;
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  };
  return {
    svixId: pick('svix-id'),
    svixTimestamp: pick('svix-timestamp'),
    svixSignature: pick('svix-signature'),
  };
}

function decodeSecret(secret: string): Buffer | null {
  const trimmed = String(secret || '').trim();
  if (!trimmed) return null;
  const base64 = trimmed.startsWith('whsec_') ? trimmed.slice('whsec_'.length) : trimmed;
  try {
    const decoded = Buffer.from(base64, 'base64');
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

// `rawBody` MUST be the exact unparsed request body string. Any re-serialization
// (JSON.parse -> JSON.stringify) changes the bytes and fails verification.
export function verifyResendWebhookSignature(input: {
  rawBody: string;
  headers: ResendWebhookHeaders;
  secret: string | null | undefined;
  toleranceSeconds?: number;
  nowMs?: number;
}): ResendWebhookVerification {
  const key = input.secret ? decodeSecret(input.secret) : null;
  if (!key) return { ok: false, reason: 'missing_secret' };

  const svixId = input.headers.svixId?.trim() || '';
  const svixTimestamp = input.headers.svixTimestamp?.trim() || '';
  const svixSignature = input.headers.svixSignature?.trim() || '';
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, reason: 'missing_headers' };
  }

  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds) || !Number.isInteger(timestampSeconds)) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  const tolerance = input.toleranceSeconds ?? RESEND_WEBHOOK_DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const signedContent = `${svixId}.${svixTimestamp}.${input.rawBody}`;
  const expected = createHmac('sha256', key).update(signedContent, 'utf8').digest('base64');

  const provided = svixSignature
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const comma = token.indexOf(',');
      return comma === -1 ? { version: '', signature: token } : { version: token.slice(0, comma), signature: token.slice(comma + 1) };
    })
    .filter((entry) => entry.version === 'v1' && entry.signature);

  if (provided.length === 0) return { ok: false, reason: 'invalid_signature' };

  const matched = provided.some((entry) => safeEqual(entry.signature, expected));
  return matched ? { ok: true } : { ok: false, reason: 'invalid_signature' };
}
