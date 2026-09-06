import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { VOLTA10_REMARKETING_CAMPAIGN, VOLTA10_REMARKETING_SOURCE } from '../server/remarketing-campaign.js';

// ADMIN-UX-RELIABILITY Wave 4C Stage 2 — POST
// /api/admin/remarketing/campaigns/whatsapp_remarketing_volta10/events must
// persist through a narrow, DB-idempotent batched INSERT
// (recordRemarketingCampaignEventsInPostgres), NOT the generic full-database
// blob mechanism. The partial unique index
// run-audit-logs_remarketing_campaign_stage_idx is the concurrency authority.
// Repo convention: no jsdom / no live PG in unit tests; concurrency + ON CONFLICT
// behaviour are proven against real PostgreSQL in homolog separately.

const serverIndex = readFileSync('server/index.ts', 'utf8');
const serverDatabase = readFileSync('server/database.ts', 'utf8');
const migration = readFileSync('server/migrations/20260906_remarketing_campaign_stage_unique_index.sql', 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function handlerBlock(): string {
  const a = serverIndex.indexOf('async function handleAdminRemarketingCampaignEvent(');
  const b = serverIndex.indexOf('\nasync function handleAdminGoogleSheetsCheck(', a);
  assert.ok(a >= 0 && b > a, 'handleAdminRemarketingCampaignEvent located');
  return serverIndex.slice(a, b);
}

function primitiveBlock(): string {
  const a = serverDatabase.indexOf("const REMARKETING_VOLTA10_CAMPAIGN = 'whatsapp_remarketing_volta10';");
  const b = serverDatabase.indexOf('export type AuditLogAppendInput = {', a);
  assert.ok(a >= 0 && b > a, 'recordRemarketingCampaignEventsInPostgres block located');
  return serverDatabase.slice(a, b);
}

// ---------------------------------------------------------------------------
// the FULL_BLOB writer is gone from the campaign-event path
// ---------------------------------------------------------------------------
test('the handler no longer reaches a persisting transaction()/savePostgresDatabase/global lock', () => {
  const h = code(handlerBlock());
  assert.doesNotMatch(h, /savePostgresDatabase/, 'never rewrites the whole database');
  assert.doesNotMatch(h, /pg_advisory_xact_lock|funpace-run-write/, 'never takes the global write lock');
  assert.doesNotMatch(h, /ensureConfiguredLots|ensurePostgresReady/, 'no runtime auto-migrate side effect');
  assert.doesNotMatch(h, /database\.auditLogs\.push|createAuditLog\(/, 'no in-memory blob mutation / no per-row createAuditLog left in the handler');
  assert.match(h, /await recordRemarketingCampaignEventsInPostgres\(\{/, 'delegates to the narrow primitive');
  // the only transaction() calls left are persist:false scoped READS
  const txCalls = [...h.matchAll(/transaction\(/g)].length;
  assert.equal(txCalls, 2, 'exactly two transaction() calls remain — the projection read and the metrics read');
  assert.match(h, /const projectionDatabase = await transaction\(\(current\) => current, \{ persist: false, scope: 'admin-registrations' \}\)/);
  assert.match(h, /const metricsDatabase = await transaction\(\(current\) => current, \{ persist: false, scope: 'admin-registrations' \}\)/);
  assert.doesNotMatch(h, /transaction\([^)]*\)\s*;?\s*$/m, 'no persisting transaction() (all remaining ones are persist:false)');
});

test('the narrow primitive never reads/writes the full blob, never auto-migrates, takes NO advisory lock', () => {
  const fn = code(primitiveBlock());
  assert.doesNotMatch(fn, /readPostgresDatabase/, 'never reads the full database');
  assert.doesNotMatch(fn, /savePostgresDatabase/, 'never rewrites the full database');
  assert.doesNotMatch(fn, /\btransaction\s*[<(]/, 'does not delegate back to the generic transaction()');
  assert.doesNotMatch(fn, /ensurePostgresReady|ensureConfiguredLots|assertRuntimeAutoMigrateAllowed/, 'no auto-migrate trigger');
  assert.doesNotMatch(fn, /pg_advisory_xact_lock/, 'takes NO advisory lock — the unique index is the concurrency authority');
  assert.doesNotMatch(fn, /client\.query\('begin'\)|client\.query\('commit'\)|for update/, 'no transaction envelope / no row lock for one atomic INSERT');
});

// ---------------------------------------------------------------------------
// exact write set: run-audit-logs (0..N rows) — nothing else
// ---------------------------------------------------------------------------
test('write set is exactly one batched INSERT into run-audit-logs — no other table', () => {
  const fn = primitiveBlock();
  const tableRefs = [...fn.matchAll(/\$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tableRefs)].sort(), ['auditLogs'], `unexpected tables referenced: ${[...new Set(tableRefs)].join(', ')}`);
  const inserts = [...fn.matchAll(/insert into \$\{table\.(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ['auditLogs'], 'exactly one INSERT, into run-audit-logs');
  assert.doesNotMatch(fn, /\bupdate \$\{table|delete from \$\{table/i, 'INSERT only — no UPDATE / DELETE');
  for (const forbidden of [/\$\{table\.registrations\}/, /\$\{table\.payments\}/, /\$\{table\.lots\}/, /\$\{table\.emailDeliveries\}/, /\$\{table\.partnershipLeads\}/, /\$\{table\.googleSheetSyncs\}/]) {
    assert.doesNotMatch(fn, forbidden, `primitive must not touch ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// DB-backed idempotency: ON CONFLICT target restates the PARTIAL unique index
// ---------------------------------------------------------------------------
test('single batched INSERT ... ON CONFLICT ... WHERE ... DO NOTHING RETURNING action', () => {
  const fn = primitiveBlock();
  assert.match(fn, /await requirePool\(\)\.query\(\s*\n\s*`insert into \$\{table\.auditLogs\}/, 'one pooled batched INSERT');
  assert.match(fn, /values \$\{tuples\.join\(', '\)\}/, 'multi-row VALUES built from the entry × stage list');
  assert.match(
    fn,
    /on conflict \(action, \(payload->>'campaign'\), \(payload->>'personKey'\)\)\s*\n\s*where action in \('remarketing\.eligible', 'remarketing\.message_sent'\)\s*\n\s*do nothing\s*\n\s*returning action/,
    'ON CONFLICT arbiter restates the partial index columns AND predicate exactly, DO NOTHING, RETURNING action',
  );
});

test('the ON CONFLICT arbiter is byte-identical to the migration index definition', () => {
  // migration: (action, (payload->>'campaign'), (payload->>'personKey')) where action in ('remarketing.eligible', 'remarketing.message_sent')
  assert.match(migration, /create unique index concurrently if not exists "run-audit-logs_remarketing_campaign_stage_idx"/);
  assert.match(migration, /on "run-audit-logs" \(action, \(payload->>'campaign'\), \(payload->>'personKey'\)\)/);
  assert.match(migration, /where action in \('remarketing\.eligible', 'remarketing\.message_sent'\);/);
  // DDL block bootstrap mirror
  assert.match(serverDatabase, /create unique index if not exists "run-audit-logs_remarketing_campaign_stage_idx" on \$\{table\.auditLogs\} \(action, \(payload->>'campaign'\), \(payload->>'personKey'\)\) where action in \('remarketing\.eligible', 'remarketing\.message_sent'\);/);
});

test('migration file is a single CONCURRENTLY statement (no transaction block), with precondition + rollback documented', () => {
  const statements = migration.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
  assert.equal(statements.length, 1, 'exactly one SQL statement so apply-migrations.mjs runs it outside a transaction block');
  assert.match(statements[0], /^create unique index concurrently if not exists/i);
  assert.match(migration, /Precondition[\s\S]*group by 1,2,3 having count\(\*\) > 1/i, 'precondition duplicate query documented');
  assert.match(migration, /Rollback:[\s\S]*drop index concurrently if exists "run-audit-logs_remarketing_campaign_stage_idx"/i, 'rollback documented');
});

// ---------------------------------------------------------------------------
// input authority: constrained to the two funnel-stage actions
// ---------------------------------------------------------------------------
test('primitive is NOT a generic audit inserter — event is a 2-value union, action is derived, campaign/source are the Volta10 constants', () => {
  const fn = primitiveBlock();
  assert.match(fn, /event: 'eligible' \| 'message_sent';/, 'event is a two-value union, not a free-form action');
  assert.match(fn, /input\.event === 'message_sent' \? \['eligible', 'message_sent'\] : \['eligible'\]/, 'message_sent also backfills the eligible stage');
  assert.match(fn, /`remarketing\.\$\{stage\}`/, 'action is derived internally as remarketing.<stage>');
  assert.match(fn, /const REMARKETING_VOLTA10_CAMPAIGN = 'whatsapp_remarketing_volta10';/);
  assert.match(fn, /const REMARKETING_VOLTA10_SOURCE = 'whatsapp';/);
  assert.doesNotMatch(fn, /input\.action|input\.campaign|input\.entityType/, 'no caller-supplied action / campaign / entityType');
});

test('the pinned Volta10 constants match server/remarketing-campaign.ts', () => {
  assert.equal(VOLTA10_REMARKETING_CAMPAIGN, 'whatsapp_remarketing_volta10');
  assert.equal(VOLTA10_REMARKETING_SOURCE, 'whatsapp');
});

// ---------------------------------------------------------------------------
// faithful payload shape + audit envelope
// ---------------------------------------------------------------------------
test('each row carries the historical payload { campaign, source, personKey, registrationIdReference } and the full audit envelope', () => {
  const fn = primitiveBlock();
  assert.match(fn, /campaign: REMARKETING_VOLTA10_CAMPAIGN,\s*\n\s*source: REMARKETING_VOLTA10_SOURCE,\s*\n\s*personKey: entry\.personKey,\s*\n\s*registrationIdReference: entry\.registrationIdReference,/);
  assert.match(fn, /\(id, actor, actor_role, action, entity_type, entity_id, payload, session_id, ip_address, user_agent, created_at\)/, 'full audit column list');
  assert.match(fn, /randomUUID\(\),\s*\n\s*input\.audit\.actor,\s*\n\s*input\.audit\.actorRole,/, 'id + actor + role from the caller');
  assert.match(fn, /'registration'/, "entity_type is 'registration' (hardcoded in the VALUES row)");
});

// ---------------------------------------------------------------------------
// recorded count semantics
// ---------------------------------------------------------------------------
test('recordedByAction counts ONLY rows actually inserted (RETURNING), keyed by action', () => {
  const fn = primitiveBlock();
  assert.match(fn, /for \(const row of result\.rows\) \{\s*\n\s*if \(row\.action === 'remarketing\.eligible' \|\| row\.action === 'remarketing\.message_sent'\) \{\s*\n\s*recordedByAction\[row\.action\] \+= 1;/);
  assert.match(fn, /if \(!tuples\.length\) \{\s*\n\s*return \{ recordedByAction \};/, 'empty entry list -> zeroed result, no query');
});

test('handler response shape is unchanged and `recorded` = new rows for the requested event', () => {
  const h = handlerBlock();
  assert.match(h, /const result = \{\s*\n\s*requested: registrationIds\.length \|\| projections\.length,\s*\n\s*accepted: projections\.length,\s*\n\s*rejected: Math\.max\(\(registrationIds\.length \|\| projections\.length\) - projections\.length, 0\),\s*\n\s*recorded: recordedByAction\[`remarketing\.\$\{event\}` as 'remarketing\.eligible' \| 'remarketing\.message_sent'\],\s*\n\s*metrics: summarizeVolta10RemarketingCampaign\(metricsDatabase\),\s*\n\s*\};/);
  assert.match(h, /json\(res, 200, result\);/);
});

// ---------------------------------------------------------------------------
// RBAC + validation preserved
// ---------------------------------------------------------------------------
test('RBAC and the 422 validations are unchanged (administrator + operation; batch <= 500; message_sent needs >= 1)', () => {
  const h = handlerBlock();
  assert.match(h, /const session = await requireAdmin\(req, res, \['administrator', 'operation'\]\);/);
  assert.match(h, /!requireAdminDatabase\(res\) \|\| !requireJson\(req, res\)/);
  assert.doesNotMatch(code(h), /'finance'/, 'finance is not granted');
  assert.match(h, /if \(!REMARKETING_CAMPAIGN_EVENTS\.includes\(event as RemarketingCampaignManualEvent\)\) \{\s*\n\s*json\(res, 422,/);
  assert.match(h, /if \(registrationIds\.length > 500 \|\| \(event === 'message_sent' && registrationIds\.length === 0\)\) \{\s*\n\s*json\(res, 422,/);
  const authAt = h.indexOf("requireAdmin(req, res, ['administrator', 'operation'])");
  const primitiveAt = h.indexOf('await recordRemarketingCampaignEventsInPostgres({');
  assert.ok(authAt >= 0 && authAt < primitiveAt, 'auth precedes the primitive');
});

// ---------------------------------------------------------------------------
// read model preserved
// ---------------------------------------------------------------------------
test('read model: persist:false scoped read for selectCampaignProjections, then the primitive, then persist:false scoped read for the metrics', () => {
  const h = handlerBlock();
  const projAt = h.indexOf('const projections = selectCampaignProjections(projectionDatabase');
  const primitiveAt = h.indexOf('await recordRemarketingCampaignEventsInPostgres({');
  const metricsReadAt = h.indexOf('const metricsDatabase = await transaction');
  const summarizeAt = h.indexOf('summarizeVolta10RemarketingCampaign(metricsDatabase)');
  assert.ok(projAt >= 0 && projAt < primitiveAt && primitiveAt < metricsReadAt && metricsReadAt < summarizeAt,
    'order: projection read -> primitive -> metrics read -> summarize');
});

// ---------------------------------------------------------------------------
// remarketing.checkout_returned is NOT governed by this index / predicate
// ---------------------------------------------------------------------------
test("remarketing.checkout_returned is excluded from the partial unique index and untouched by this wave", () => {
  const migrationSql = migration.replace(/--.*$/gm, '');   // strip comments
  assert.doesNotMatch(migrationSql, /checkout_returned/, 'the index predicate covers only eligible + message_sent');
  assert.match(migrationSql, /where action in \('remarketing\.eligible', 'remarketing\.message_sent'\);/);
  assert.doesNotMatch(code(primitiveBlock()), /checkout_returned/, 'the primitive never emits checkout_returned');
  // its separate writer still exists and is unchanged
  assert.match(serverIndex, /action: 'remarketing\.checkout_returned',/);
});
