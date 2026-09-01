import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';

import {
  RESEND_WEBHOOK_DEFAULT_TOLERANCE_SECONDS,
  readResendWebhookHeaders,
  verifyResendWebhookSignature,
} from '../server/resend-webhook-auth';

// EMAIL-OPS-003 Stage 2 §8/§20 — Resend (Svix) webhook signature verification.
// The scheme: key = base64-decode(secret without `whsec_`);
// signature = base64(HMAC_SHA256(key, `${svixId}.${svixTimestamp}.${rawBody}`));
// header `svix-signature` = space-delimited `v1,<sig>` tokens.

const SECRET_BYTES = randomBytes(24);
const SECRET = `whsec_${SECRET_BYTES.toString('base64')}`;

function sign(rawBody: string, opts: { id?: string; timestamp?: number; secretBytes?: Buffer } = {}) {
  const id = opts.id ?? `msg_${randomBytes(8).toString('hex')}`;
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', opts.secretBytes ?? SECRET_BYTES)
    .update(`${id}.${timestamp}.${rawBody}`, 'utf8')
    .digest('base64');
  return {
    id,
    timestamp,
    headers: { svixId: id, svixTimestamp: timestamp, svixSignature: `v1,${signature}` },
  };
}

const BODY = JSON.stringify({ type: 'email.delivered', created_at: '2026-09-01T00:00:00Z', data: { email_id: 'abc' } });

test('valid signature passes', () => {
  const { headers } = sign(BODY);
  assert.deepEqual(verifyResendWebhookSignature({ rawBody: BODY, headers, secret: SECRET }), { ok: true });
});

test('missing secret -> missing_secret (fail closed, 503 at the handler)', () => {
  const { headers } = sign(BODY);
  assert.deepEqual(verifyResendWebhookSignature({ rawBody: BODY, headers, secret: '' }), { ok: false, reason: 'missing_secret' });
  assert.deepEqual(verifyResendWebhookSignature({ rawBody: BODY, headers, secret: undefined }), { ok: false, reason: 'missing_secret' });
});

test('missing any svix header -> missing_headers', () => {
  const { headers } = sign(BODY);
  for (const drop of ['svixId', 'svixTimestamp', 'svixSignature'] as const) {
    const partial = { ...headers, [drop]: null };
    assert.deepEqual(
      verifyResendWebhookSignature({ rawBody: BODY, headers: partial, secret: SECRET }),
      { ok: false, reason: 'missing_headers' },
      `dropping ${drop}`,
    );
  }
});

test('invalid signature -> invalid_signature', () => {
  const { headers } = sign(BODY);
  const tampered = { ...headers, svixSignature: 'v1,' + Buffer.from('not-the-real-signature').toString('base64') };
  assert.deepEqual(verifyResendWebhookSignature({ rawBody: BODY, headers: tampered, secret: SECRET }), { ok: false, reason: 'invalid_signature' });
});

test('signature made with a different secret -> invalid_signature', () => {
  const { headers } = sign(BODY, { secretBytes: randomBytes(24) });
  assert.deepEqual(verifyResendWebhookSignature({ rawBody: BODY, headers, secret: SECRET }), { ok: false, reason: 'invalid_signature' });
});

test('raw-body mutation after signing -> invalid_signature (proves RAW body is verified)', () => {
  const { headers } = sign(BODY);
  const reserialized = JSON.stringify(JSON.parse(BODY)); // same value, different bytes are possible; here also append a space
  const mutated = `${reserialized} `;
  assert.deepEqual(verifyResendWebhookSignature({ rawBody: mutated, headers, secret: SECRET }), { ok: false, reason: 'invalid_signature' });
});

test('stale timestamp (older than tolerance) -> stale_timestamp', () => {
  const nowMs = 1_800_000_000_000;
  const { headers } = sign(BODY, { timestamp: Math.floor(nowMs / 1000) - RESEND_WEBHOOK_DEFAULT_TOLERANCE_SECONDS - 5 });
  assert.deepEqual(verifyResendWebhookSignature({ rawBody: BODY, headers, secret: SECRET, nowMs }), { ok: false, reason: 'stale_timestamp' });
});

test('future timestamp beyond tolerance -> stale_timestamp (replay / clock attack)', () => {
  const nowMs = 1_800_000_000_000;
  const { headers } = sign(BODY, { timestamp: Math.floor(nowMs / 1000) + RESEND_WEBHOOK_DEFAULT_TOLERANCE_SECONDS + 5 });
  assert.deepEqual(verifyResendWebhookSignature({ rawBody: BODY, headers, secret: SECRET, nowMs }), { ok: false, reason: 'stale_timestamp' });
});

test('timestamp within tolerance passes', () => {
  const nowMs = 1_800_000_000_000;
  const { headers } = sign(BODY, { timestamp: Math.floor(nowMs / 1000) - RESEND_WEBHOOK_DEFAULT_TOLERANCE_SECONDS + 5 });
  assert.deepEqual(verifyResendWebhookSignature({ rawBody: BODY, headers, secret: SECRET, nowMs }), { ok: true });
});

test('non-numeric timestamp -> stale_timestamp', () => {
  const { headers } = sign(BODY);
  assert.deepEqual(
    verifyResendWebhookSignature({ rawBody: BODY, headers: { ...headers, svixTimestamp: 'not-a-number' }, secret: SECRET }),
    { ok: false, reason: 'stale_timestamp' },
  );
});

test('multiple signatures (secret rotation): a match on ANY v1 token passes', () => {
  const { id, timestamp } = sign(BODY);
  const wrong = Buffer.from('old-key-signature').toString('base64');
  const right = createHmac('sha256', SECRET_BYTES).update(`${id}.${timestamp}.${BODY}`, 'utf8').digest('base64');
  const headers = { svixId: id, svixTimestamp: timestamp, svixSignature: `v1,${wrong} v1,${right}` };
  assert.deepEqual(verifyResendWebhookSignature({ rawBody: BODY, headers, secret: SECRET }), { ok: true });
});

test('signature header with no v1 token -> invalid_signature', () => {
  const { headers } = sign(BODY);
  assert.deepEqual(
    verifyResendWebhookSignature({ rawBody: BODY, headers: { ...headers, svixSignature: 'v2,abc v3,def' }, secret: SECRET }),
    { ok: false, reason: 'invalid_signature' },
  );
});

test('secret without the whsec_ prefix is accepted (raw base64 key)', () => {
  const { headers } = sign(BODY);
  assert.deepEqual(verifyResendWebhookSignature({ rawBody: BODY, headers, secret: SECRET_BYTES.toString('base64') }), { ok: true });
});

test('readResendWebhookHeaders is case-insensitive and unwraps arrays', () => {
  const parsed = readResendWebhookHeaders({
    'Svix-Id': 'msg_1',
    'svix-timestamp': ['111', '222'],
    'SVIX-SIGNATURE': 'v1,x',
  });
  assert.deepEqual(parsed, { svixId: 'msg_1', svixTimestamp: '111', svixSignature: 'v1,x' });
});

test('empty header object -> all null -> missing_headers', () => {
  assert.deepEqual(
    verifyResendWebhookSignature({ rawBody: BODY, headers: readResendWebhookHeaders({}), secret: SECRET }),
    { ok: false, reason: 'missing_headers' },
  );
});
