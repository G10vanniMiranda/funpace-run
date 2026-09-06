import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// PARTICIPANT-OPS-003 Stage 2 — RBAC for the administrative distance correction.
// Dedicated endpoint (NOT profile-edit): administrator-only. Repo convention:
// static-source-locking, mirroring admin-dashboard-rbac / admin-kit-handler-rbac.

const server = readFileSync('server/index.ts', 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function block(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `located ${start}`);
  return src.slice(a, b);
}

const handler = block(server, 'async function handleAdminRegistrationDistance(', '\nasync function handleAdminRegistrations(');

test('distance correction is administrator-only — server-enforced, no operation, no finance', () => {
  assert.match(handler, /requireAdmin\(req, res, \['administrator'\]\)/);
  assert.doesNotMatch(code(handler), /'operation'|'finance'/, 'no other role is granted anywhere in this handler');
});

test('requireAdmin fails closed for a wrong role (403) and for no session (401)', () => {
  assert.match(server, /if \(session && \(!roles \|\| roles\.includes\(session\.role\)\)\) \{\s*return session;\s*\}/);
  assert.match(server, /if \(session && roles\) \{ json\(res, 403, \{ message: 'Seu perfil nao possui permissao para esta acao\.' \}\); return null; \}/);
  assert.match(server, /json\(res, 401, \{ message: 'Acesso administrativo nao autorizado\.' \}\);\s*return null;/);
});

test('a denied caller never reaches the primitive — auth is the first gate, before body read / delegation', () => {
  const authAt = handler.indexOf("requireAdmin(req, res, ['administrator'])");
  const guardReturnAt = handler.search(/if \(!adminSession \|\| !requireAdminDatabase\(res\) \|\| !requireJson\(req, res\)\) return;/);
  const bodyReadAt = handler.indexOf('await readBody(req)');
  const primitiveAt = handler.indexOf('await correctRegistrationDistanceInPostgres({');
  assert.ok(authAt >= 0 && guardReturnAt > authAt, 'auth call is first, its guard-return follows immediately');
  assert.ok(guardReturnAt < bodyReadAt && bodyReadAt < primitiveAt, 'body read and the mutation both sit strictly after the auth guard');
});

test('Postgres-mode gate + JSON gate + event scoping are enforced', () => {
  assert.match(handler, /requireAdminDatabase\(res\)/, '503 when not in Postgres mode — no JSON fallback');
  assert.match(handler, /requireJson\(req, res\)/);
  assert.match(handler, /ensureRegistrationEventScope\(res, url, registrationId\)/, 'event scoping preserved (matches bib/check-in/kit)');
});

test('the client may supply ONLY targetDistanceId + reason — no price / lot / payment / bib / snapshot input is read', () => {
  const parsed = handler.slice(handler.indexOf('parseJsonBody'), handler.indexOf('const outcome ='));
  assert.match(parsed, /parseJsonBody<\{ targetDistanceId\?: string; reason\?: string \}>/, 'body type is exactly { targetDistanceId?, reason? }');
  for (const forbidden of ['amountCents', 'amount_cents', 'lotId', 'lot_id', 'bibNumber', 'bib_number', 'originalPrice', 'finalPrice', 'discount', 'partnerId', 'coupon', 'paymentStatus', 'distanceLabel']) {
    assert.ok(!parsed.includes(forbidden), `handler must not read '${forbidden}' from the client body`);
  }
});

test('reason is mandatory and length-guarded before the mutation runs', () => {
  assert.match(handler, /const reason = body\?\.reason\?\.trim\(\) \|\| '';/);
  assert.match(handler, /if \(!targetDistanceId \|\| reason\.length < 5\) \{\s*json\(res, 400,/, 'missing target or reason < 5 → 400, before delegation');
  const guardAt = handler.search(/if \(!targetDistanceId \|\| reason\.length < 5\)/);
  const primitiveAt = handler.indexOf('await correctRegistrationDistanceInPostgres({');
  assert.ok(guardAt >= 0 && guardAt < primitiveAt, 'the reason/target guard precedes the primitive call');
  // the reason is forwarded into the audit envelope
  assert.match(handler, /reason,\s*\n\s*audit: \{/, 'reason is passed to the primitive (auditable)');
});
