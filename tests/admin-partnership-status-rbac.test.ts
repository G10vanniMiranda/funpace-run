import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 4A Stage 2A — server RBAC hardening for the
// partnership-status mutation. Repo convention: no jsdom / no live PG in unit
// tests; real request/response semantics are proven in homolog separately.
// This mirrors the exact static-source-locking pattern used by
// admin-dashboard-rbac.test.ts / admin-kit-handler-rbac.test.ts.

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

// ---- server authorization boundary -------------------------------------

test('handleAdminPartnershipStatus: administrator-only — server-enforced, no finance, no operation', () => {
  assert.match(handler, /requireAdmin\(req, res, \['administrator'\]\)/);
  assert.doesNotMatch(code(handler), /'finance'|'operation'/, 'no other role is granted anywhere in this handler');
});

test('requireAdmin fails closed for an authenticated session outside the allowed roles (403) and for no session at all (401)', () => {
  // shared requireAdmin implementation: any authenticated session whose role
  // is not in the supplied array is denied with 403; no session -> 401.
  assert.match(server, /if \(session && \(!roles \|\| roles\.includes\(session\.role\)\)\) \{\s*return session;\s*\}/);
  assert.match(server, /if \(session && roles\) \{ json\(res, 403, \{ message: 'Seu perfil nao possui permissao para esta acao\.' \}\); return null; \}/);
  assert.match(server, /json\(res, 401, \{ message: 'Acesso administrativo nao autorizado\.' \}\);\s*return null;/);
});

test('a denied caller never reaches persistence — the role check is the handler\'s first statement, before any mutation', () => {
  const requireAdminAt = handler.indexOf("requireAdmin(req, res, ['administrator'])");
  const earlyReturnAt = handler.search(/if \(!adminSession\) \{\s*return;\s*\}/);
  const transactionAt = handler.indexOf('await transaction<{ statusCode: number; payload: unknown }>((database) => {');
  const requireAdminDatabaseAt = handler.indexOf('requireAdminDatabase(res)');
  assert.ok(requireAdminAt >= 0 && earlyReturnAt > requireAdminAt, 'role check is the first statement');
  assert.ok(earlyReturnAt < requireAdminDatabaseAt && requireAdminDatabaseAt < transactionAt, 'DB gate and the mutation both sit strictly after the role check\'s early return');
});

// ---- non-regression: everything else about this handler is untouched ----

test('non-regression: allowed status values, transition semantics, and response contract are unchanged', () => {
  assert.match(handler, /const allowedStatuses: PartnershipLeadStatus\[\] = \['new', 'contacted', 'negotiating', 'approved', 'rejected'\];/);
  assert.match(handler, /if \(!nextStatus \|\| !allowedStatuses\.includes\(nextStatus\)\) \{\s*json\(res, 422, \{ message: 'Status de parceria invalido\.' \}\);/);
  assert.match(handler, /if \(!lead\) \{\s*return \{ statusCode: 404, payload: \{ message: 'Proposta de parceria nao encontrada\.' \} \};/);
  assert.match(handler, /return \{ statusCode: 200, payload: \{ partnership: toAdminPartnershipLead\(lead\) \} \};/);
});

test('non-regression: persistence is still the generic transaction() writer — Stage 2A does not narrow it', () => {
  assert.match(code(handler), /await transaction<\{ statusCode: number; payload: unknown \}>\(\(database\) => \{/);
  assert.doesNotMatch(code(handler), /updatePartnershipStatusInPostgres/, 'Stage 2B, not this stage, introduces the narrow primitive');
});

test('non-regression: audit event name/payload and the Google Sheets sync side effect are unchanged', () => {
  assert.match(handler, /action: 'partnership\.status_updated',/);
  assert.match(handler, /entityType: 'partnership',/);
  assert.match(handler, /payload: \{ status: nextStatus \},/);
  assert.match(handler, /queuePartnershipGoogleSheetSync\(partnershipId\)/);
});
