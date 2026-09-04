import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-HOTFIX-001 — regression + contract lock for the Admin event-config
// mutation path (EventManagementPanel save → PATCH /api/admin/lots|distances|
// event-config). Production evidence: the pre-hotfix "SALVAR ALTERAÇÃO" click
// produced ZERO backend trace and no feedback (D — CLICK_DID_NOT_REACH_BACKEND).
//
// Repo convention: interaction flows are asserted against source (no jsdom / no
// new dependency); the state machine itself is unit-tested in
// tests/admin-mutation-runtime.test.ts, and the payload builder in
// tests/admin-lot-mutation.test.ts.

const adminTsx = readFileSync('src/pages/Admin.tsx', 'utf8');
const serverIndex = readFileSync('server/index.ts', 'utf8');
const serverDatabase = readFileSync('server/database.ts', 'utf8');

function panel(): string {
  const start = adminTsx.indexOf('function EventManagementPanel(');
  assert.ok(start >= 0, 'EventManagementPanel located');
  const end = adminTsx.indexOf('\nfunction MetricBox(', start);
  return adminTsx.slice(start, end >= 0 ? end : undefined);
}

test('regression: the config save no longer silently returns and no longer spreads the raw lot object', () => {
  const body = panel();
  // pre-hotfix bugs that produced D — CLICK_DID_NOT_REACH_BACKEND / no feedback:
  assert.doesNotMatch(body, /if \(!lot\) return;/, 'silent "lot not found" early-return removed');
  assert.doesNotMatch(body, /if \(!distance\) return;/, 'silent "distance not found" early-return removed');
  assert.doesNotMatch(body, /updateAdminLot\(adminKey, lot\.id, \{ \.\.\.lot, reason/, 'raw-lot spread body removed');
  assert.doesNotMatch(body, /onConfirm=\{\(\) => void submitSave\(\)\}/, 'fire-and-forget void submitSave() removed');
});

test('the save runs on the reusable mutation state machine (one confirm -> one PATCH)', () => {
  const body = panel();
  assert.match(body, /const saveMutation = useAdminMutation<\{ message: string; unchanged\?: boolean \}>\(\);/);
  assert.match(body, /saveMutation\.submit\(async \(\) => \{/);
  // exactly one PATCH per submit: the lot branch calls updateAdminLot once, with
  // the validated builder output — not a hand-spread object.
  assert.match(body, /const built = buildLotUpdatePayload\(lot, reason\);/);
  assert.match(body, /await updateAdminLot\(adminKey, \(lot as \{ id: string \}\)\.id, built\.payload\);/);
  assert.equal((body.match(/await updateAdminLot\(/g) || []).length, 1, 'lot save issues exactly one updateAdminLot call');
  // an invalid/absent lot throws (surfaced as FAILURE), never a silent drop
  assert.match(body, /throw new ApiError\(errorText, \{ code: 'validation', businessCode: 'LOT_PAYLOAD_INVALID' \}\)/);
  assert.match(body, /businessCode: 'CONFIG_ENTITY_STALE'/);
});

test('durable feedback: the modal renders submitting / success / failure and cannot silently vanish', () => {
  const body = panel();
  assert.match(body, /<ConfigSaveModal/);
  assert.match(body, /state=\{saveMutation\.state\}/);
  assert.match(body, /onSubmit=\{submitConfigSave\}/);
  assert.match(body, /onAcknowledge=\{acknowledgeConfigSave\}/);
  // success is acknowledged explicitly, then authoritative re-read
  assert.match(body, /const acknowledgeConfigSave = \(\) => \{\s*saveMutation\.acknowledge\(\);\s*setSaveDraft\(null\);\s*void load\(\);/);

  const modal = adminTsx.slice(adminTsx.indexOf('function ConfigSaveModal('), adminTsx.indexOf('\nfunction ActionModal('));
  assert.match(modal, /const submitting = state\.phase === 'submitting';/);
  assert.match(modal, /const succeeded = state\.phase === 'success';/);
  assert.match(modal, /const failed = state\.phase === 'failure';/);
  assert.match(modal, /Salvando…/);
  assert.match(modal, /role="status"/);          // durable success
  assert.match(modal, /role="alert"/);           // durable failure
  assert.match(modal, /disabled=\{submitting \|\| !reasonValid\}/); // double-submit + reason guard
  assert.match(modal, /onClick=\{submitting \? undefined : onClose\}/); // no dismiss mid-flight
});

test('§7 backend contract for PATCH /api/admin/lots/:id is intact (no business-semantics change)', () => {
  // The handler keeps auth + the reason gate, then delegates to the narrow
  // transactional mutation (EVENT-OPS-001). It must NOT reach for the
  // full-database blob path any more.
  const handler = serverIndex.slice(
    serverIndex.indexOf('async function handleAdminLotUpdate('),
    serverIndex.indexOf('\nasync function handleAdminSystemCheck('),
  );
  assert.match(handler, /requireAdmin\(req, res, \['administrator'\]\)/, 'administrator only');
  assert.match(handler, /reason\.length < 5/, 'reason >= 5 enforced in the handler');
  assert.match(handler, /await updateLotConfigurationInPostgres\(\{/, 'delegates to the narrow transaction');
  assert.doesNotMatch(handler, /await transaction[<(]/, 'no generic blob transaction() for lot updates');
  assert.doesNotMatch(handler, /database\.lots\.some\(/, 'no in-memory full-db scan');
  for (const k of ['name', 'capacity', 'priceCents', 'status', 'startsAt', 'endsAt']) {
    assert.match(handler, new RegExp(`\\b${k}: body\\?\\.${k}\\b|name: compactText\\(body\\?\\.name`), `forwards body.${k}`);
  }

  // The business semantics now live in server/database.ts — same checks, same
  // order, same status codes and messages, enforced against `for update` rows.
  const fn = serverDatabase.slice(
    serverDatabase.indexOf('export async function updateLotConfigurationInPostgres('),
    serverDatabase.indexOf('export async function snapshot()'),
  );
  assert.ok(fn.length > 0, 'updateLotConfigurationInPostgres located');
  assert.match(fn, /from \$\{table\.lots\} where id = \$1 for update/, 'target lot row is locked FOR UPDATE');
  assert.match(fn, /capacity < before\.soldCount[\s\S]*?statusCode: 409/, 'capacity vs soldCount invariant (409)');
  assert.match(fn, /priceCents < 0[\s\S]*?statusCode: 400/, 'invalid price rejected (400)');
  assert.match(fn, /\['active', 'inactive', 'sold_out', 'scheduled', 'closed'\]\.includes/, 'status enum enforced');
  assert.match(fn, /where event_id = \$1 and id <> \$2 and status = 'active'[\s\S]*?statusCode: 409/, 'one-active-lot invariant (409)');
  assert.match(fn, /input\.startsAt >= input\.endsAt[\s\S]*?statusCode: 400/, 'inverted sale window rejected (400)');
  assert.match(fn, /A capacidade nao pode ser menor que \$\{before\.soldCount\} vagas ocupadas\./);
  assert.match(fn, /Ja existe outro lote ativo\. Encerre-o antes de ativar este lote\./);
  assert.match(fn, /update \$\{table\.lots\}\s*\n\s*set name = \$2, capacity = \$3, price_cents = \$4, status = \$5, starts_at = \$6, ends_at = \$7\s*\n\s*where id = \$1/, 'single-row UPDATE of run-lots');
  assert.match(fn, /insert into \$\{table\.auditLogs\}[\s\S]*?'lot\.updated', 'lot', \$4[\s\S]*?reason: input\.reason, before, after/, 'atomic lot.updated audit with before/after + reason');
});
