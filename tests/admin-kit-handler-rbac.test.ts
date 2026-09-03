import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 2C — handler delegation, RBAC and outcome mapping
// for kit delivery / undo-kit. Static source guards (repo convention).

const server = readFileSync('server/index.ts', 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
function block(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `located ${start}`);
  return src.slice(a, b);
}
const kitHandler = block(server, 'async function handleAdminKitDelivery(', '\nasync function handleAdminRegistrationMaintenance(');
const maintenance = block(server, 'async function handleAdminRegistrationMaintenance(', '\n// PARTICIPANT-OPS-001 CASE A / Stage A2 — deliberate, single-shot recovery');

// ---- §22 RBAC ----------------------------------------------------------
test('§22: kit delivery — administrator + operation only, server-enforced; no finance; no IAM', () => {
  assert.match(kitHandler, /requireAdmin\(req, res, \['administrator', 'operation'\]\)/);
  assert.match(kitHandler, /requireAdminDatabase\(res\)/, 'Postgres-mode gate (503 otherwise) — no JSON fallback');
  assert.match(kitHandler, /requireJson\(req, res\)/);
  assert.match(kitHandler, /ensureRegistrationEventScope\(res, url, registrationId\)/);
  assert.doesNotMatch(kitHandler, /'finance'/);
});
test('§22: undo-kit inherits the maintenance role gate (administrator + operation) and the reason requirement', () => {
  assert.match(maintenance, /action === 'send-email' \? \['administrator', 'finance'\] : action === 'cancel' \? \['administrator'\] : \['administrator', 'operation'\]/);
  assert.match(maintenance, /\['cancel', 'undo-check-in', 'undo-kit'\]\.includes\(action\) && reason\.length < 5/, 'undo-kit still requires reason >= 5');
});

// ---- §19 delegation --------------------------------------------------
test('§19: handleAdminKitDelivery delegates to deliverRegistrationKitInPostgres and drops the generic writer', () => {
  const h = code(kitHandler);
  assert.match(h, /await deliverRegistrationKitInPostgres\(\{/);
  assert.match(h, /audit: \{[\s\S]*?actor: adminSession\.actor,[\s\S]*?actorRole: adminSession\.role,[\s\S]*?sessionId: adminSession\.id,[\s\S]*?ipAddress: getClientIp\(req\),[\s\S]*?userAgent: getUserAgent\(req\),[\s\S]*?createdAt: new Date\(\)\.toISOString\(\),/);
  assert.doesNotMatch(h, /\btransaction\s*<|savePostgresDatabase|database\.kitDeliveries\.push/);
});
test('§19: undo-kit Postgres branch delegates; the generic transaction() line stays for the cancel JSON fallback', () => {
  const m = code(maintenance);
  assert.match(m, /if \(action === 'undo-kit' && usesPostgresDatabase\(\)\) \{[\s\S]*?await undoRegistrationKitDeliveryInPostgres\(\{/);
  const branchAt = m.indexOf("if (action === 'undo-kit' && usesPostgresDatabase())");
  const genericAt = m.indexOf('const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {');
  assert.ok(branchAt >= 0 && genericAt > branchAt, 'narrow undo-kit branch precedes the generic block');
  // undo-check-in narrow branch (Wave 2B) untouched
  assert.match(m, /if \(action === 'undo-check-in' && usesPostgresDatabase\(\)\) \{[\s\S]*?await undoRegistrationCheckInInPostgres\(\{/);
  // cancel's own narrow Postgres branch untouched
  assert.match(m, /if \(action === 'cancel' && usesPostgresDatabase\(\)\) \{[\s\S]*?cancelRegistrationInPostgres/);
  // the generic block still carries the cancel branch (JSON fallback)
  assert.match(m, /action === 'cancel'[\s\S]*?releaseRegistrationCapacity\(database, registration\)/);
});

// ---- §21 outcome -> HTTP mapping ----------------------------------
test('§21: kit delivery outcome mapping incl. PG-1 409', () => {
  assert.match(kitHandler, /if \(outcome\.status === 'not_found'\) \{ json\(res, 404,/);
  assert.match(kitHandler, /if \(outcome\.status === 'not_eligible'\) \{ json\(res, 409, \{ message: outcome\.message, code: 'NOT_ELIGIBLE' \}\)/);
  assert.match(kitHandler, /if \(outcome\.status === 'check_in_required'\) \{/);
  assert.match(kitHandler, /message: 'O kit só pode ser entregue após o check-in\.', code: 'CHECK_IN_REQUIRED_FOR_KIT_DELIVERY'/);
  assert.match(kitHandler, /outcome: 'KIT_ALREADY_DELIVERED' as const/);
  assert.match(kitHandler, /outcome: 'KIT_DELIVERED' as const,\s+message: 'Entrega de kit registrada\.'/);
  // KIT_ALREADY_DELIVERED is HTTP 200 (idempotent), NOT the legacy 409
  assert.match(kitHandler, /json\(res, 200, withRegistrationView\(\{\s+ok: true,\s+outcome: 'KIT_ALREADY_DELIVERED'/);
  // google sheet sync only on the real state change
  const acceptedIdx = kitHandler.indexOf("outcome: 'KIT_DELIVERED'");
  const alreadyIdx = kitHandler.indexOf("outcome: 'KIT_ALREADY_DELIVERED'");
  assert.ok(kitHandler.indexOf('queueCheckInGoogleSheetSync') > alreadyIdx && kitHandler.indexOf('queueCheckInGoogleSheetSync') < acceptedIdx, 'sheet sync queued on the delivered path only');
});
test('§21: undo-kit outcome mapping', () => {
  assert.match(maintenance, /if \(undoKitOutcome\.status === 'not_found'\) \{ json\(res, 404,/);
  assert.match(maintenance, /outcome: 'KIT_ALREADY_NOT_DELIVERED' as const/);
  assert.match(maintenance, /outcome: 'KIT_DELIVERY_REVERTED' as const,\s+message: 'Entrega de kit desfeita\.'/);
});

// ---- no raw SQL leak --------------------------------------------
test('no raw SQL / driver error is exposed by either handler path', () => {
  assert.doesNotMatch(code(kitHandler) + code(maintenance), /error\.detail|23505|error\.constraint|error\.message.*sql/i);
});
