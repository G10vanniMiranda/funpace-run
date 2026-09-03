import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 2B — handler delegation, RBAC, and outcome mapping
// for check-in / undo-check-in. Static source guards (repo convention: no jsdom /
// no live PG in unit tests).

const server = readFileSync('server/index.ts', 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
function block(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `located ${start}`);
  return src.slice(a, b);
}
const checkInHandler = block(server, 'async function handleAdminCheckIn(', '\nasync function handleAdminKitDelivery(');
const maintenance = block(server, 'async function handleAdminRegistrationMaintenance(', '\n// PARTICIPANT-OPS-001 CASE A / Stage A2 — deliberate, single-shot recovery');

// ---- §20 RBAC ------------------------------------------------------------
test('§20: check-in — administrator + operation only, server-enforced; no finance; no IAM', () => {
  assert.match(checkInHandler, /requireAdmin\(req, res, \['administrator', 'operation'\]\)/);
  assert.match(checkInHandler, /requireAdminDatabase\(res\)/, 'Postgres-mode gate (503 otherwise) — no JSON fallback');
  assert.match(checkInHandler, /requireJson\(req, res\)/);
  assert.match(checkInHandler, /ensureRegistrationEventScope\(res, url, registrationId\)/);
  assert.doesNotMatch(checkInHandler, /'finance'/);
});
test('§20: undo-check-in inherits the maintenance role gate (administrator + operation, not finance)', () => {
  // roles: send-email -> [administrator, finance]; cancel -> [administrator]; else -> [administrator, operation]
  assert.match(maintenance, /action === 'send-email' \? \['administrator', 'finance'\] : action === 'cancel' \? \['administrator'\] : \['administrator', 'operation'\]/);
  assert.match(maintenance, /\['cancel', 'undo-check-in', 'undo-kit'\]\.includes\(action\) && reason\.length < 5/, 'undo-check-in still requires reason >= 5');
});

// ---- §17 / §18 delegation ---------------------------------------------
test('§17: handleAdminCheckIn delegates to checkInRegistrationInPostgres and drops the generic writer', () => {
  const h = code(checkInHandler);
  assert.match(h, /await checkInRegistrationInPostgres\(\{/);
  assert.match(h, /audit: \{[\s\S]*?actor: adminSession\.actor,[\s\S]*?actorRole: adminSession\.role,[\s\S]*?sessionId: adminSession\.id,[\s\S]*?ipAddress: getClientIp\(req\),[\s\S]*?userAgent: getUserAgent\(req\),[\s\S]*?createdAt: new Date\(\)\.toISOString\(\),/);
  assert.doesNotMatch(h, /\btransaction\s*<|savePostgresDatabase|database\.checkIns\.push/);
});
test('§18: undo-check-in Postgres branch delegates; the generic transaction() line stays for undo-kit + cancel JSON', () => {
  const m = code(maintenance);
  assert.match(m, /if \(action === 'undo-check-in' && usesPostgresDatabase\(\)\) \{[\s\S]*?await undoRegistrationCheckInInPostgres\(\{/);
  // the undo-check-in narrow branch RETURNS before the generic block
  const branchAt = m.indexOf("if (action === 'undo-check-in' && usesPostgresDatabase())");
  const genericAt = m.indexOf('const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {');
  assert.ok(branchAt >= 0 && genericAt > branchAt, 'narrow branch precedes the generic block');
  // undo-kit untouched inside the generic block
  assert.match(m, /action === 'undo-kit'[\s\S]*?canUndoKit\(database\.kitDeliveries\.some/);
  // cancel's own narrow Postgres branch is untouched
  assert.match(m, /if \(action === 'cancel' && usesPostgresDatabase\(\)\) \{[\s\S]*?cancelRegistrationInPostgres/);
});

// ---- §19 outcome -> HTTP mapping -------------------------------------
test('§19: check-in outcome mapping', () => {
  assert.match(checkInHandler, /if \(outcome\.status === 'not_found'\) \{ json\(res, 404,/);
  assert.match(checkInHandler, /if \(outcome\.status === 'not_eligible'\) \{ json\(res, 409, \{ message: outcome\.message, code: 'NOT_ELIGIBLE' \}\)/);
  assert.match(checkInHandler, /outcome: 'ALREADY_CHECKED_IN' as const/);
  assert.match(checkInHandler, /outcome: 'CHECK_IN_ACCEPTED' as const,\s+message: 'Check-in registrado\.'/);
  // ALREADY_CHECKED_IN is HTTP 200 (idempotent), NOT the legacy 409
  assert.match(checkInHandler, /json\(res, 200, withRegistrationView\(\{\s+ok: true,\s+outcome: 'ALREADY_CHECKED_IN'/);
  // google sheet sync only on the real state change
  const acceptedIdx = checkInHandler.indexOf("outcome: 'CHECK_IN_ACCEPTED'");
  const alreadyIdx = checkInHandler.indexOf("outcome: 'ALREADY_CHECKED_IN'");
  assert.ok(checkInHandler.indexOf('queueCheckInGoogleSheetSync') > alreadyIdx && checkInHandler.indexOf('queueCheckInGoogleSheetSync') < acceptedIdx, 'sheet sync queued on the accepted path only (after the already-checked-in early return)');
});
test('§19: undo-check-in outcome mapping incl. PG-2 409', () => {
  assert.match(maintenance, /if \(undoOutcome\.status === 'not_found'\) \{ json\(res, 404,/);
  assert.match(maintenance, /if \(undoOutcome\.status === 'kit_delivery_blocks_undo'\) \{/);
  assert.match(maintenance, /message: 'O check-in não pode ser desfeito enquanto a entrega do kit estiver registrada\. Desfaça primeiro a entrega do kit\.',/);
  assert.match(maintenance, /code: 'KIT_DELIVERY_BLOCKS_CHECK_IN_UNDO',/);
  assert.match(maintenance, /outcome: 'ALREADY_NOT_CHECKED_IN' as const/);
  assert.match(maintenance, /outcome: 'CHECK_IN_REVERTED' as const,\s+message: 'Check-in desfeito\.'/);
});

// ---- no raw SQL leak ----------------------------------------------
test('no raw SQL / driver error is exposed by either handler path', () => {
  assert.doesNotMatch(code(checkInHandler) + code(maintenance), /error\.detail|23505|error\.constraint|error\.message.*sql/i);
});
