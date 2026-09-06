import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 4A — server RBAC + delegation for the
// partnership-status mutation. Stage 2A (live in Production) made it
// administrator-only; Stage 2B replaced the generic full-blob persistence with
// the narrow updatePartnershipStatusInPostgres primitive WITHOUT touching that
// RBAC policy. Repo convention: static-source-locking, mirroring
// admin-dashboard-rbac / admin-kit-handler-rbac.

const server = readFileSync('server/index.ts', 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function block(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `located ${start}`);
  return src.slice(a, b);
}

const handler = block(
  server,
  'async function handleAdminPartnershipStatus(',
  '\n// ADMIN-003 Stage 1 - CSV Formula Injection hardening.',
);

// ---- server authorization boundary (Stage 2A — MUST remain intact) -----

test('handleAdminPartnershipStatus: administrator-only — server-enforced, no finance, no operation', () => {
  assert.match(handler, /requireAdmin\(req, res, \['administrator'\]\)/);
  assert.doesNotMatch(code(handler), /'finance'|'operation'/, 'no other role is granted anywhere in this handler');
});

test('requireAdmin fails closed for an authenticated session outside the allowed roles (403) and for no session at all (401)', () => {
  assert.match(server, /if \(session && \(!roles \|\| roles\.includes\(session\.role\)\)\) \{\s*return session;\s*\}/);
  assert.match(server, /if \(session && roles\) \{ json\(res, 403, \{ message: 'Seu perfil nao possui permissao para esta acao\.' \}\); return null; \}/);
  assert.match(server, /json\(res, 401, \{ message: 'Acesso administrativo nao autorizado\.' \}\);\s*return null;/);
});

test('a denied caller never reaches the primitive — auth is the first statement, before body read / delegation', () => {
  const requireAdminAt = handler.indexOf("requireAdmin(req, res, ['administrator'])");
  const earlyReturnAt = handler.search(/if \(!adminSession\) \{\s*return;\s*\}/);
  const requireAdminDatabaseAt = handler.indexOf('requireAdminDatabase(res)');
  const bodyReadAt = handler.indexOf('await readBody(req)');
  const primitiveAt = handler.indexOf('await updatePartnershipStatusInPostgres({');
  assert.ok(requireAdminAt >= 0 && earlyReturnAt > requireAdminAt, 'role check is the first statement');
  assert.ok(earlyReturnAt < requireAdminDatabaseAt && requireAdminDatabaseAt < bodyReadAt && bodyReadAt < primitiveAt,
    'DB gate, body read and the mutation all sit strictly after the role check\'s early return');
});

test('Stage 2B did not weaken RBAC: no roles array other than [\'administrator\'] anywhere in the handler', () => {
  const roleArrays = [...handler.matchAll(/requireAdmin\(req, res, (\[[^\]]*\])\)/g)].map((m) => m[1]);
  assert.deepEqual(roleArrays, ["['administrator']"], `handler role arrays = ${JSON.stringify(roleArrays)}`);
});

// ---- non-regression: business semantics preserved ----------------------

test('non-regression: allowed status enum, 422 wording and 404 wording are unchanged', () => {
  assert.match(handler, /const allowedStatuses: PartnershipLeadStatus\[\] = \['new', 'contacted', 'negotiating', 'approved', 'rejected'\];/);
  assert.match(handler, /if \(!nextStatus \|\| !allowedStatuses\.includes\(nextStatus\)\) \{\s*json\(res, 422, \{ message: 'Status de parceria invalido\.' \}\);/);
  assert.match(handler, /if \(outcome\.status === 'not_found'\) \{\s*json\(res, 404, \{ message: 'Proposta de parceria nao encontrada\.' \}\);/);
});

test('non-regression: the enum check still runs BEFORE the mutation (422 without any write)', () => {
  const enumAt = handler.search(/if \(!nextStatus \|\| !allowedStatuses\.includes\(nextStatus\)\)/);
  const primitiveAt = handler.indexOf('await updatePartnershipStatusInPostgres({');
  assert.ok(enumAt >= 0 && enumAt < primitiveAt, 'invalid status is rejected before the primitive is called');
});

test('non-regression: HTTP 200 response body is still { partnership: toAdminPartnershipLead(...) }', () => {
  assert.match(handler, /json\(res, 200, \{ partnership: toAdminPartnershipLead\(outcome\.lead\) \}\);/);
});

test('non-regression: audit action name unchanged, and the Sheet re-sync runs only on a real transition', () => {
  const db = readFileSync('server/database.ts', 'utf8');
  assert.match(db, /'partnership\.status_updated', 'partnership', \$4/, 'audit action / entity_type unchanged');
  assert.match(handler, /if \(outcome\.status === 'updated'\) \{\s*const task = await queuePartnershipGoogleSheetSync\(partnershipId\);/,
    'Google Sheet re-sync is gated on outcome === updated (no re-sync for a no-op)');
});
