import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 4B Stage 2 — the PUBLIC POST /api/partnerships lead
// intake must persist through a narrow single-INSERT primitive
// (createPartnershipLeadInPostgres), NOT the generic full-database blob
// mechanism. Repo convention: no jsdom / no live PG in unit tests; concurrency
// and cross-domain isolation are proven against real PostgreSQL in homolog
// separately (.tmp/p4b-leadcreate-homolog-proof.mts).

const serverIndex = readFileSync('server/index.ts', 'utf8');
const serverDatabase = readFileSync('server/database.ts', 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function handlerBlock(): string {
  const a = serverIndex.indexOf('async function handleCreatePartnership(');
  const b = serverIndex.indexOf('\n// EMAIL-OPS-003 Stage 2 — Resend delivery-lifecycle webhook ingestion.', a);
  assert.ok(a >= 0 && b > a, 'handleCreatePartnership located');
  return serverIndex.slice(a, b);
}

function primitiveBlock(): string {
  const a = serverDatabase.indexOf('export type PartnershipLeadCreateInput = {');
  const b = serverDatabase.indexOf('export type AuditLogAppendInput = {', a);
  assert.ok(a >= 0 && b > a, 'createPartnershipLeadInPostgres block located');
  return serverDatabase.slice(a, b);
}

// ---------------------------------------------------------------------------
// the FULL_BLOB writer is gone from the public lead-create path
// ---------------------------------------------------------------------------
test('the handler no longer reaches transaction()/savePostgresDatabase/global lock/auto-migrate', () => {
  const h = code(handlerBlock());
  assert.doesNotMatch(h, /\btransaction\s*</, 'no generic mutating transaction<...>()');
  assert.doesNotMatch(h, /savePostgresDatabase/, 'never rewrites the whole database');
  assert.doesNotMatch(h, /pg_advisory_xact_lock|funpace-run-write/, 'never takes the global write lock');
  assert.doesNotMatch(h, /ensureConfiguredLots|ensurePostgresReady/, 'no runtime auto-migrate side effect');
  assert.doesNotMatch(h, /database\.partnershipLeads\.push|database\.auditLogs\.push/, 'no in-memory blob mutation remains');
  assert.match(h, /await createPartnershipLeadInPostgres\(\{/, 'delegates to the narrow primitive');
  assert.equal([...h.matchAll(/transaction\(/g)].length, 0, 'zero transaction() calls remain in the handler');
});

test('the narrow primitive never reads/writes the full blob, never auto-migrates, takes NO advisory lock', () => {
  const fn = code(primitiveBlock());
  assert.doesNotMatch(fn, /readPostgresDatabase/, 'never reads the full database');
  assert.doesNotMatch(fn, /savePostgresDatabase/, 'never rewrites the full database');
  assert.doesNotMatch(fn, /\btransaction\s*[<(]/, 'does not delegate back to the generic transaction()');
  assert.doesNotMatch(fn, /ensurePostgresReady|ensureConfiguredLots|assertRuntimeAutoMigrateAllowed/, 'no auto-migrate trigger');
  assert.doesNotMatch(fn, /pg_advisory_xact_lock/, 'takes NO advisory lock');
});

// ---------------------------------------------------------------------------
// minimal-form justification: single parameterized INSERT, no tx envelope
// ---------------------------------------------------------------------------
test('minimal form: one requirePool().query INSERT, no begin/commit/for-update/lock_timeout', () => {
  const fn = primitiveBlock();
  assert.match(fn, /const configurationIssue = getDatabaseConfigurationIssue\(\);/, 'config guard first (matches appendAuditLogInPostgres)');
  assert.match(fn, /await requirePool\(\)\.query\(\s*\n\s*`insert into \$\{table\.partnershipLeads\}/, 'a single pooled INSERT');
  assert.doesNotMatch(code(fn), /client\.query\('begin'\)|client\.query\('commit'\)|client\.query\('rollback'\)/, 'no transaction envelope for one atomic INSERT');
  assert.doesNotMatch(code(fn), /for update|lock_timeout|statement_timeout/, 'no row lock / no local timeouts — append-only, fresh UUID PK, nothing to contend');
  assert.doesNotMatch(code(fn), /requirePool\(\)\.connect\(\)/, 'no dedicated client checkout');
});

// ---------------------------------------------------------------------------
// exact write set: run-partnership-leads (one INSERT) — nothing else
// ---------------------------------------------------------------------------
test('write set is exactly one INSERT into run-partnership-leads — no audit, no other table', () => {
  const fn = primitiveBlock();
  const tableRefs = [...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tableRefs)].sort(), ['partnershipLeads'], `unexpected tables referenced: ${[...new Set(tableRefs)].join(', ')}`);
  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ['partnershipLeads'], 'exactly one INSERT, into run-partnership-leads');
  assert.doesNotMatch(fn, /\$\{table\.auditLogs\}|run-audit-logs/, 'NO audit row — the current no-audit contract is preserved (follow-up: PARTNERSHIP-LEAD-AUDIT-GAP)');
  for (const forbidden of [/\$\{table\.registrations\}/, /\$\{table\.payments\}/, /\$\{table\.lots\}/, /\$\{table\.partners\}/, /\$\{table\.coupons\}/, /\$\{table\.emailDeliveries\}/, /\$\{table\.googleSheetSyncs\}/, /\$\{table\.auditLogs\}/]) {
    assert.doesNotMatch(fn, forbidden, `primitive must not touch ${forbidden}`);
  }
  assert.doesNotMatch(fn, /\bupdate \$\{table|delete from \$\{table/i, 'INSERT only — no UPDATE / DELETE');
});

// ---------------------------------------------------------------------------
// faithful port of the previous in-memory record shape
// ---------------------------------------------------------------------------
test('faithful port: fresh randomUUID id, status "new", source "site", createdAt == updatedAt', () => {
  const fn = primitiveBlock();
  assert.match(fn, /const id = randomUUID\(\);/, 'fresh UUID per call — matches the old handler');
  assert.match(fn, /const now = new Date\(\)\.toISOString\(\);/);
  assert.match(fn, /values \(\$1, \$2, \$3, \$4, \$5, \$6, 'new', 'site', \$7, \$7\)/,
    "status defaults to 'new', source to 'site', createdAt and updatedAt are the SAME $7 timestamp");
  assert.match(fn, /returning \$\{PARTNERSHIP_LEAD_COLUMNS\}/, 'returns the inserted row');
  assert.match(fn, /return mapPartnershipLeadRow\(result\.rows\[0\]\);/, 'maps the row to a PartnershipLeadRecord (shape unchanged)');
  // parameter order carries the handler-sanitised values verbatim
  assert.match(fn, /\[id, input\.companyName, input\.contactName, input\.contactRole, input\.corporateEmail, input\.involvementMessage, now\]/);
});

// ---------------------------------------------------------------------------
// public-endpoint contract preserved in the handler
// ---------------------------------------------------------------------------
test('public contract preserved: no auth added, validation / honeypot / rate limit / 201 wording unchanged', () => {
  const h = handlerBlock();
  assert.doesNotMatch(h, /requireAdmin|requireAdminDatabase/, 'still PUBLIC — no authentication added');
  assert.match(h, /if \(!requireJson\(req, res\)\) \{/, 'requireJson gate unchanged');
  assert.match(h, /if \(isPartnershipRateLimited\(req\)\) \{\s*\n\s*json\(res, 429, \{ message: 'Muitas tentativas\. Aguarde alguns minutos e tente novamente\.' \}\);/, 'in-memory rate-limit gate + 429 wording unchanged');
  assert.match(h, /const payload = sanitizePartnershipLead\(parsedBody\);/, 'sanitize unchanged');
  assert.match(h, /if \(payload\.website\) \{[\s\S]*?json\(res, 201, \{\s*\n\s*id: '',/, 'honeypot short-circuit (fake 201) unchanged');
  assert.match(h, /const errors = validatePartnershipLead\(payload\);[\s\S]*?json\(res, 422, \{ message: 'Dados da proposta invalidos\.', errors \}\);/, 'validation + 422 wording unchanged');
  assert.match(h, /json\(res, 201, \{\s*\n\s*id: lead\.id,\s*\n\s*message: 'Proposta enviada com sucesso\. Nossa equipe entrara em contato em breve\.',/, '201 success body + wording unchanged');
  assert.match(h, /await notifyPartnershipTeam\(lead\);/, 'outbound webhook side effect unchanged');
  assert.match(h, /const partnershipSync = await queuePartnershipGoogleSheetSync\(lead\.id\);/, 'Google Sheet sync enqueue unchanged');
  assert.match(h, /logRequest\(req, 201, 'partnership_lead_created'\);/, 'request log line unchanged');
});

test('no dedupe / uniqueness / idempotency introduced (current no-dedupe contract preserved)', () => {
  const fn = code(primitiveBlock());
  const h = code(handlerBlock());
  assert.doesNotMatch(fn + h, /on conflict|where not exists|idempotenc|dedup|unique/i, 'no dedupe/uniqueness/idempotency added (follow-up: PARTNERSHIP-LEAD-DEDUP-HARDENING)');
});

// ---------------------------------------------------------------------------
// error mapping: DB failure propagates to the existing generic 500, no leak
// ---------------------------------------------------------------------------
test('error mapping: the handler adds no new try/catch — a DB failure propagates to the existing generic 500', () => {
  const h = handlerBlock();
  const createToEnd = h.slice(h.indexOf('await createPartnershipLeadInPostgres({'));
  assert.doesNotMatch(createToEnd, /catch\s*\(/, 'no bespoke catch around the primitive — same as the old transaction() call');
  // the canonical outer catch (unchanged) returns a generic message, no SQL
  assert.match(serverIndex, /\} catch \(error\) \{\s*\n\s*const errorId = logServerError\(req, error\);\s*\n\s*json\(res, 500, \{\s*\n\s*message: `Erro interno\./, 'outer handleApiRequest catch is the generic-500 sink (no SQL / constraint / stack exposed)');
  assert.doesNotMatch(code(primitiveBlock()), /error\.detail|error\.constraint|23505|\.stack/, 'primitive never surfaces raw driver error fields');
});
