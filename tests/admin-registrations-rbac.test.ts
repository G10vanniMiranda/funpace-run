import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-003 Stage 3 — RBAC + PII minimisation wiring. Proves the role-aware
// serializer is applied on EVERY Inscrições surface an `operation` user can
// reach (§45/§46/§47/§49), that CSV export is a backend 403 for operation
// (§29/§48), and that Stage 1 / Stage 2 contracts are untouched (§33/§34).

const server = readFileSync('server/index.ts', 'utf8');
const admin = readFileSync('src/pages/Admin.tsx', 'utf8');
const visibility = readFileSync('server/registration-visibility.ts', 'utf8');

function block(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `${startNeedle} located`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end >= 0 ? end : undefined);
}

test('§12 the serializer is a dedicated pure module — no DB, no React, no request ctx', () => {
  assert.ok(!/\btransaction\(/.test(visibility));
  assert.ok(!/IncomingMessage|ServerResponse|from 'react'/.test(visibility));
  assert.match(server, /from '\.\/registration-visibility\.js'/);
});

test('§53/§46 GET /api/admin/registrations minimises BOTH the people and the legacy path', () => {
  const handler = block(server, 'async function handleAdminRegistrations(', '\nasync function ');
  assert.match(handler, /const session = await requireAdmin\(req, res\);/);
  assert.match(handler, /const role = session\.role as RegistrationViewRole;/);
  // person-centric branch
  assert.match(handler, /serializeAdminRegistrationsForRole\(registrations, role, 'list'\)/);
  // legacy row-centric branch (§46: same policy applies)
  assert.match(handler, /serializeAdminRegistrationsForRole\(\s*rows\.slice\([\s\S]*?\), role, 'list'\)/);
});

test('§47 GET /api/admin/registrations/:id minimises the detail, history and timeline', () => {
  const handler = block(server, 'async function handleAdminRegistrationDetails(', '\nasync function handleAdminBibNumber(');
  assert.match(handler, /serializeAdminRegistrationForRole\(toAdminRow\(database, registration\), role, 'detail'\)/);
  assert.match(handler, /serializeRegistrationHistoryForRole\(personHistory, role\)/);
  assert.match(handler, /serializeRegistrationTimelineForRole\(/);
  // raw audit-log + payment-event arrays are withheld from operation entirely
  assert.match(handler, /auditLogs: isOperation \? \[\]/);
  assert.match(handler, /paymentEvents: isOperation \? \[\]/);
});

test('§45 /api/admin/operation (alternate row endpoint) also minimises for operation', () => {
  const handler = block(server, 'async function handleAdminOperation(', '\nasync function ');
  assert.match(handler, /const session = await requireAdmin\(req, res, \['administrator', 'operation'\]\)/);
  assert.match(handler, /serializeAdminRegistrationsForRole\(rows\.slice\([\s\S]*?\), session\.role as RegistrationViewRole, 'list'\)/);
});

test('§49 every drawer mutation echoes a role-minimised row', () => {
  for (const fn of ['handleAdminCheckIn', 'handleAdminKitDelivery']) {
    const body = block(server, `async function ${fn}(`, '\nasync function ');
    assert.match(body, /withRegistrationView\(result\.payload, adminSession\.role as RegistrationViewRole\)/, `${fn} minimises its response`);
  }
  const maintenance = block(server, 'async function handleAdminRegistrationMaintenance(', '\nasync function ');
  assert.match(maintenance, /withRegistrationView\(result\.payload, adminSession\.role as RegistrationViewRole\)/);
  // ADMIN-UX-RELIABILITY Wave 2A — handleAdminBibNumber was rewritten onto the
  // narrow setRegistrationBibInPostgres primitive; its 200 body is a locally
  // built { ok, outcome, message, registration } object, still passed through
  // withRegistrationView so the `registration` row is role-minimised.
  const bib = block(server, 'async function handleAdminBibNumber(', '\nasync function ');
  assert.match(bib, /withRegistrationView\(payload, adminSession\.role as RegistrationViewRole\)/, 'handleAdminBibNumber minimises its response');
});

test('§29/§48 registrations.csv is a backend 403 for operation — the button is not the control', () => {
  const handler = block(server, 'async function handleAdminRegistrationsCsv(', '\nasync function ');
  assert.match(handler, /const session = await requireAdmin\(req, res\);/);
  assert.match(handler, /if \(session\.role === 'operation'\) \{\s*\n\s*json\(res, 403,/);
  // report export was already administrator/finance only — unchanged
  const report = block(server, 'async function handleAdminReportExport(', '\nasync function ');
  assert.match(report, /requireAdmin\(req, res, \['administrator', 'finance'\]\)/);
});

test('§24 the 403 error body leaks nothing (no resource / PII / payment info)', () => {
  const handler = block(server, 'async function handleAdminRegistrationsCsv(', '\nasync function ');
  const line = handler.match(/json\(res, 403, \{[^}]*\}\)/)?.[0] ?? '';
  assert.match(line, /message: 'Exportacao de inscricoes nao disponivel para o seu perfil\.'/);
  assert.ok(!/registration|email|cpf|amount|payment/i.test(line.replace('Exportacao', '')));
});

test('§30 the frontend hides the export action for operation (backend still authoritative)', () => {
  assert.match(admin, /canExport=\{adminRole !== 'operation'\}/);
  assert.match(admin, /activeNav !== 'partners' && canExport && <button/);
  const download = block(admin, 'const downloadCsv = async () =>', '\n  };');
  assert.match(download, /if \(adminRole === 'operation'\)/);
});

test('§10 the Valor column + value sort are hidden for operation in the list', () => {
  const panel = block(admin, 'function RegistrationsPanel(', '\nfunction Panel(');
  assert.match(panel, /const showFinancialColumn = adminRole !== 'operation';/);
  assert.match(panel, /\{showFinancialColumn && <th className="p-4">Valor<\/th>\}/);
  assert.match(panel, /\{showFinancialColumn && <td className="p-4 font-mono font-bold">\{formatCentsBRL\(registration\.amountCents\)\}<\/td>\}/);
  assert.match(panel, /showFinancialColumn \? \[\{ value: 'amountCents', label: 'Ordenar por valor' \}\] : \[\]/);
});

test('§23 no new PII console.log / audit payload in the touched read paths', () => {
  for (const fn of ['handleAdminRegistrations(', 'handleAdminRegistrationDetails(', 'handleAdminOperation(', 'handleAdminRegistrationsCsv(']) {
    const body = block(server, `async function ${fn}`, '\nasync function ');
    assert.ok(!/console\.(log|info|warn|error)\(/.test(body), `${fn} adds no console logging`);
  }
});

test('§33 Stage 2 event-scope + person semantics are untouched', () => {
  assert.match(server, /if \(url\.searchParams\.get\('view'\) === 'people'\)/);
  assert.match(server, /resolveDashboardEventScope\(res, fullDatabase, url\)/);
  assert.match(server, /export function buildParticipantsPage\(/);
  assert.match(server, /function assertRegistrationInRequestedEvent\(/);
});

test('§34 Stage 1 CSV formula-injection primitive is untouched', () => {
  assert.match(server, /export function sanitizeSpreadsheetCell\(value: unknown\): string \{/);
  assert.match(server, /export function escapeCsv\(value: unknown\) \{\s*\n\s*const text = sanitizeSpreadsheetCell\(value\);/);
});
