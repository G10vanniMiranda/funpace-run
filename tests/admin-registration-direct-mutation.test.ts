import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-HOTFIX-003 — PATCH /api/admin/registrations/:id must run as a narrow,
// single-row PostgreSQL transaction (run-registrations one row + run-audit-logs
// one row), NOT the generic full-database blob mechanism.
//
// Production evidence (PARTICIPANT-OPS-001 Case A): two real human email-edit
// attempts on registration a47a4dc8-… produced 0 registration.updated audit
// rows and 0 commits — the previous path was
//   requireAdmin -> transaction()
//     -> pg_advisory_xact_lock('funpace-run-write')   (global write lock)
//     -> readPostgresDatabase(scope='all')
//     -> mutate in-memory database
//     -> savePostgresDatabase(full database, ~6100 serialized upserts)
//     -> commit
// which exceeded the 15s Admin client timeout without committing. Same defect
// class as EVENT-OPS-001 Stage 2B (lot config), never fixed for registrations.
//
// Repo convention: no jsdom / no live PG in unit tests; the transactional
// behaviour is proven against real PostgreSQL in homolog separately, and the
// wiring / scope is locked here against source.

const serverIndex = readFileSync('server/index.ts', 'utf8');
const serverDatabase = readFileSync('server/database.ts', 'utf8');

function registrationHandler(): string {
  const start = serverIndex.indexOf('async function handleAdminRegistrationUpdate(');
  const end = serverIndex.indexOf('\nasync function handleAdminRegistrationDetails(');
  assert.ok(start >= 0 && end > start, 'handleAdminRegistrationUpdate located');
  return serverIndex.slice(start, end);
}

function directMutation(): string {
  const start = serverDatabase.indexOf('export async function updateRegistrationFieldsInPostgres(');
  const end = serverDatabase.indexOf('export async function pingDatabase()');
  assert.ok(start >= 0 && end > start, 'updateRegistrationFieldsInPostgres located');
  return serverDatabase.slice(start, end);
}

// strip // and /* */ comments so assertions test executable code, not prose
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('performance regression guard: registration updates no longer touch the full-database blob path', () => {
  const handler = code(registrationHandler());
  assert.doesNotMatch(handler, /\btransaction\s*</, 'handler does not call the generic mutating transaction<...>()');
  assert.doesNotMatch(handler, /savePostgresDatabase/, 'handler does not rewrite the whole database');
  assert.doesNotMatch(handler, /pg_advisory_xact_lock/, 'handler does not take the global application write lock');
  assert.match(handler, /await updateRegistrationFieldsInPostgres\(\{/, 'handler delegates to the narrow mutation');
  // the ONLY transaction() call left is the read-only, unlocked scoped refresh
  const txCalls = [...handler.matchAll(/transaction\(/g)].length;
  assert.equal(txCalls, 1, 'exactly one transaction() call remains — the response refresh');
  assert.match(handler, /transaction\(\(current\) => current, \{ persist: false, scope: 'admin-registrations' \}\)/, 'response refresh is persist:false (no advisory lock) and scoped, not scope=all');

  const fn = code(directMutation());
  assert.doesNotMatch(fn, /readPostgresDatabase/, 'narrow mutation never reads the full database');
  assert.doesNotMatch(fn, /savePostgresDatabase/, 'narrow mutation never rewrites the full database');
  assert.doesNotMatch(fn, /hashtext\('funpace-run-write'\)/, 'narrow mutation does not take the global application write lock');
  assert.doesNotMatch(fn, /pg_advisory_xact_lock/, 'narrow mutation takes no advisory lock at all — different registrations are fully parallel');
});

test('the narrow mutation touches ONLY run-registrations (one row) and run-audit-logs (one row)', () => {
  const fn = directMutation();

  const tableRefs = [...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]);
  const distinct = [...new Set(tableRefs)].sort();
  assert.deepEqual(distinct, ['auditLogs', 'registrations'], `unexpected tables touched: ${distinct.join(', ')}`);

  const updates = [...fn.matchAll(/update \$\{table\.registrations\}/g)];
  assert.equal(updates.length, 1, 'exactly one UPDATE run-registrations');
  assert.match(fn, /update \$\{table\.registrations\} set payload = \$2::jsonb, updated_at = \$3 where id = \$1/, 'UPDATE writes only payload + updated_at, scoped to where id = $1');

  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ['auditLogs'], 'the only INSERT is the audit row');
  assert.match(fn, /'registration\.updated', 'registration', \$4/, 'audit action/entity are registration.updated / registration');

  // FOR UPDATE row lock on the exact target
  assert.match(fn, /select id, payload, updated_at from \$\{table\.registrations\} where id = \$1 for update/, 'locks exactly the target registration row');
});

test('no financial recalculation: narrow mutation never references price/discount/coupon/lot/partner columns', () => {
  const fn = code(directMutation());
  for (const forbidden of ['final_price', 'original_price', 'discount_percentage', 'discount_amount', 'amount_cents', 'coupon_code', 'lot_id', 'partner_id', 'partner_type', 'confirmation_email']) {
    assert.doesNotMatch(fn, new RegExp(forbidden), `narrow mutation must not touch ${forbidden}`);
  }
});

test('no side-effect email send: neither the handler nor the narrow mutation resends confirmation', () => {
  const handler = code(registrationHandler());
  const fn = code(directMutation());
  for (const forbidden of [/processRegistrationEmail/, /sendRegistrationConfirmationEmail/, /enqueueConfirmationEmailObligation/, /run-email-outbox/, /run-email-deliveries/]) {
    assert.doesNotMatch(handler, forbidden, 'handler triggers no email send');
    assert.doesNotMatch(fn, forbidden, 'narrow mutation triggers no email send');
  }
});

test('transaction envelope: begin, bounded timeouts, commit, rollback on every early return and on throw', () => {
  const fn = directMutation();
  assert.match(fn, /await client\.query\('begin'\)/, 'opens a transaction');
  assert.match(fn, /set local lock_timeout = '5s'/, 'bounded lock wait (< 15s client timeout)');
  assert.match(fn, /set local statement_timeout = '10s'/, 'bounded statement time (< 15s client timeout)');
  assert.match(fn, /await client\.query\('commit'\)/, 'commits the successful path');

  // rollback on: 404, no-op ("Nenhuma alteracao"), validation error, and the catch
  const rollbacks = [...fn.matchAll(/await client\.query\('rollback'\)/g)].length;
  assert.ok(rollbacks >= 4, `expected a rollback on every early exit, found ${rollbacks}`);
  assert.match(fn, /catch \(error\) \{\s*await client\.query\('rollback'\)[\s\S]*?throw error;/, 'rollback + rethrow on unexpected error');
  assert.match(fn, /finally \{\s*client\.release\(\);/, 'always releases the client');
});

test('audit atomicity: the audit INSERT is inside the same transaction as the UPDATE, before COMMIT', () => {
  const fn = directMutation();
  const updateAt = fn.search(/update \$\{table\.registrations\} set /);
  const auditAt = fn.indexOf('insert into ${table.auditLogs}');
  const commitAt = fn.indexOf("await client.query('commit')");
  assert.ok(updateAt >= 0 && auditAt > updateAt && commitAt > auditAt, 'order is UPDATE -> INSERT audit -> COMMIT');
  assert.equal(fn.slice(updateAt, auditAt).includes("client.query('commit')"), false, 'no commit between registration UPDATE and audit INSERT');
});

test('no-op contract preserved: value already equal → 400 "Nenhuma alteracao foi informada.", no write', () => {
  const fn = directMutation();
  assert.match(fn, /if \(value === currentPayload\[field\]\) continue;/, 'unchanged fields are skipped');
  assert.match(fn, /if \(!Object\.keys\(after\)\.length\) \{\s*await client\.query\('rollback'\);\s*return \{ statusCode: 400, payload: \{ message: 'Nenhuma alteracao foi informada\.' \}/, 'true no-op rolls back with the existing 400 contract — no misleading audit row');
  // the no-op rollback happens BEFORE the UPDATE / audit INSERT
  const noopAt = fn.indexOf("if (!Object.keys(after).length)");
  const updateAt = fn.search(/update \$\{table\.registrations\} set /);
  assert.ok(noopAt >= 0 && updateAt > noopAt, 'no-op check precedes the write');
});

test('business rules preserved: allowed fields, normalisation, reason gate, per-changed-field validation', () => {
  const handler = registrationHandler();
  assert.match(handler, /requireAdmin\(req, res, \['administrator'\]\)/, 'administrator only');
  assert.match(handler, /requireAdminDatabase\(res\)/);
  assert.match(handler, /ensureRegistrationEventScope\(res, url, registrationId\)/, 'event scoping preserved');
  assert.match(handler, /reason\.length < 5/);
  assert.match(handler, /Informe um motivo com pelo menos 5 caracteres\./);
  assert.match(handler, /\['fullName', 'email', 'phone', 'birthDate', 'gender', 'shirtSize', 'emergencyContactName', 'emergencyContactPhone', 'city', 'state', 'team'\]/, 'allowed fields unchanged');
  assert.match(handler, /compactText\(value, field === 'state' \? 2 : 180\)/, 'string normalisation unchanged');
  assert.match(handler, /if \(field === 'email'\) value = String\(value\)\.toLowerCase\(\)/, 'email lowercased');
  assert.match(handler, /if \(field === 'state'\) value = String\(value\)\.toUpperCase\(\)/, 'state uppercased');
  // ADMIN-UX-HOTFIX-004: null (and undefined) are skipped, not stringified to "null"
  assert.match(handler, /if \(changes\[field\] === undefined \|\| changes\[field\] === null\) continue;/, 'null/undefined incoming values are skipped (not turned into "NULL")');
  // validation messages: faithful port, now applied per changed field
  assert.match(handler, /Nome e email valido sao obrigatorios\./);
  assert.match(handler, /\/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$\//, 'same email regex');
  assert.match(handler, /'P', 'M', 'G', 'GG'/, 'same shirt size enum');
  assert.match(handler, /Sexo ou tamanho de camisa invalido\./);
  assert.match(handler, /Telefones devem conter DDD e numero validos\./);
  assert.match(handler, /UF invalida\./);
  assert.match(handler, /Data de nascimento invalida\./);
  assert.match(handler, /validateChangedField/, 'validation is delegated per changed field');
  // the narrow mutation validates ONLY the actually-changed fields
  const fn = directMutation();
  assert.match(fn, /for \(const field of Object\.keys\(after\)\) \{\s*const validationError = input\.validateChangedField\(field, merged/, 'per-changed-field validation loop over `after`');
  assert.doesNotMatch(fn, /validateMergedPayload/, 'the holistic merged-payload validator is gone');
});

test('no UNIQUE(email) / shared-email policy intact: no email-uniqueness check anywhere in the path', () => {
  const handler = code(registrationHandler());
  const fn = code(directMutation());
  assert.doesNotMatch(handler + fn, /unique.*email|email.*already|e-mail j[aá] (est|cadastr)|duplicate.*email/i, 'no second-registration blocking on email');
  // the only email handling is format normalisation + the regex format check
  assert.doesNotMatch(fn, /email/i, 'narrow mutation is field-agnostic — it does not special-case email at all');
});

test('response contract: 200 → { registration } via lean scoped read; non-200 → { message } passthrough', () => {
  const handler = registrationHandler();
  assert.match(handler, /if \(result\.statusCode !== 200\) \{ json\(res, result\.statusCode, result\.payload\); return; \}/, 'non-200 passthrough');
  assert.match(handler, /json\(res, 200, \{ registration: toAdminRow\(database, registration\) \}\)/, '200 returns the rebuilt admin row');

  const fn = directMutation();
  assert.match(fn, /return \{ statusCode: 404, payload: \{ message: 'Inscricao nao encontrada\.' \}, changed: false \}/);
  assert.match(fn, /return \{ statusCode: 200, payload: \{ registrationId: input\.registrationId, updatedAt: now \}, changed: true \}/);
});

test('routing unchanged: PATCH /api/admin/registrations/:id still served by the explicit forwarder', () => {
  assert.match(serverIndex, /url\.pathname\.match\(\/\^\\\/api\\\/admin\\\/registrations\\\/\(\[\^\/\]\+\)\$\/\)/, 'route regex intact');
  assert.match(serverIndex, /req\.method === 'PATCH' && adminRegistrationUpdate\) \{ await handleAdminRegistrationUpdate\(/, 'PATCH dispatch intact');
});
