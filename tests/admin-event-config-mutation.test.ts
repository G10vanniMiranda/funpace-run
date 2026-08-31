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
  assert.match(body, /const saveMutation = useAdminMutation<\{ message: string \}>\(\);/);
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
  const fn = serverIndex.slice(
    serverIndex.indexOf('async function handleAdminLotUpdate('),
    serverIndex.indexOf('\nasync function handleAdminSystemCheck('),
  );
  assert.match(fn, /requireAdmin\(req, res, \['administrator'\]\)/, 'administrator only');
  assert.match(fn, /reason\.length < 5/, 'reason >= 5 enforced');
  assert.match(fn, /priceCents < 0\) return \{ statusCode: 400/, 'invalid price rejected');
  assert.match(fn, /\['active', 'inactive', 'sold_out', 'scheduled', 'closed'\]\.includes/, 'status enum enforced');
  assert.match(fn, /capacity < lot\.soldCount/, 'capacity vs soldCount invariant');
  assert.match(fn, /body\?\.status === 'active' && database\.lots\.some\([\s\S]*?item\.status === 'active'\)\) return \{ statusCode: 409/, 'one-active-lot invariant');
  assert.match(fn, /action: 'lot\.updated', entityType: 'lot', entityId: lotId, payload: \{ reason, before, after: lot \}/, 'lot.updated audit with before/after + reason');
  // full-replace: still reads all six fields from the body
  for (const k of ['name', 'capacity', 'priceCents', 'status', 'startsAt', 'endsAt']) {
    assert.match(fn, new RegExp(`body\\??[.!]?\\??\\.?${k}\\b|body!\\.${k}\\b|body\\?\\.${k}\\b`), `reads body.${k}`);
  }
});
