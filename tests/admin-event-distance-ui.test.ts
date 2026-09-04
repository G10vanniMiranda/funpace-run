import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 3A — event/distance config save UX gap-closure on
// top of the pre-existing ADMIN-UX-HOTFIX-001 useAdminMutation wiring
// (locked by tests/admin-event-config-mutation.test.ts): dirty-fields-only
// diff for event, *_UNCHANGED distinct informational feedback, ambiguous-
// commit READ-ONLY verification (never an automatic resend), and a distinct
// committed-but-refresh-failed state. Lot is explicitly out of this wave's
// scope and its own contract stays locked by admin-event-config-mutation and
// admin-lot-mutation tests.

const adminTsx = readFileSync('src/pages/Admin.tsx', 'utf8');

function panel(): string {
  const start = adminTsx.indexOf('function EventManagementPanel(');
  assert.ok(start >= 0, 'EventManagementPanel located');
  const end = adminTsx.indexOf('\nfunction MetricBox(', start);
  return adminTsx.slice(start, end >= 0 ? end : undefined);
}

function helpers(): string {
  const start = adminTsx.indexOf('const EVENT_CONFIG_FIELDS');
  const end = adminTsx.indexOf('function EventManagementPanel(');
  assert.ok(start >= 0 && end > start, 'diff/verification helpers located');
  return adminTsx.slice(start, end);
}

function modal(): string {
  const start = adminTsx.indexOf('function ConfigSaveModal(');
  const end = adminTsx.indexOf('\nfunction ActionModal(');
  assert.ok(start >= 0 && end > start, 'ConfigSaveModal located');
  return adminTsx.slice(start, end);
}

test('event config diffs against the pristine snapshot, never sends the whole live-edited object', () => {
  const body = panel();
  assert.match(body, /const \[originalConfig, setOriginalConfig\] = useState<AdminEventConfig \| null>\(null\);/);
  assert.match(body, /const load = \(\) => getAdminEventConfig\(adminKey\)\.then\(\(data\) => \{ setConfig\(data\); setOriginalConfig\(data\); \}\)/);
  assert.match(body, /const changes = diffEventConfigChanges\(originalConfig\?\.event \?\? null, config\.event\);/);
  assert.match(body, /await updateAdminEventConfig\(adminKey, changes, reason\);/);
  // regression: no longer the raw whole-object send this wave replaced
  assert.doesNotMatch(body, /await updateAdminEventConfig\(adminKey, config\.event, reason\)/, 'no longer sends the whole live-edited event object');

  const h = helpers();
  assert.match(h, /function diffEventConfigChanges\(/);
  assert.match(h, /if \(!original \|\| value !== original\[field\]\) changes\[field\] = value;/, 'only genuinely-differing fields enter the diff');
});

test('distance keeps sending both fields together (no partial-field concept invented on the client either)', () => {
  const body = panel();
  assert.match(body, /await updateAdminDistance\(adminKey, distance\.id, \{ capacity: distance\.capacity, status: distance\.status, reason \}\);/);
});

test('the *_UNCHANGED outcome is distinguished from a real write in the success message (informational, not an error)', () => {
  const body = panel();
  const occurrences = (body.match(/Nenhuma alteração foi necessária — os valores já estavam salvos\./g) || []).length;
  assert.equal(occurrences, 2, 'both event and distance branches carry the distinct no-op message');
  assert.match(body, /unchanged: response\.outcome === 'EVENT_CONFIG_UNCHANGED',/);
  assert.match(body, /unchanged: response\.outcome === 'DISTANCE_CONFIG_UNCHANGED',/);

  const m = modal();
  // rendered with role="status" (informational), never role="alert" (error)
  assert.match(m, /const unchanged = Boolean\(state\.result\?\.unchanged\);/);
  assert.match(m, /\$\{unchanged \? 'border-white\/15 bg-white\/5 text-zinc-200' : 'border-emerald-400\/30 bg-emerald-400\/10 text-emerald-100'\}/);
});

test('committed-but-refresh-failed is a distinct, durable state — never a mutation failure, never triggers a resubmit', () => {
  const body = panel();
  assert.match(
    body,
    /if \(ok\) \{\s*try \{\s*await load\(\);\s*\} catch \{[\s\S]*?setConfigContext\(\(current\) => \(current \? \{ \.\.\.current, refreshFailed: true \} : current\)\);/,
    'a post-success refetch failure sets refreshFailed, distinct from mutation failure',
  );

  const m = modal();
  assert.match(m, /context\?\.refreshFailed && \(/);
  assert.match(m, /Alteração salva, mas não foi possível atualizar os dados exibidos\. Atualize antes de tentar novamente — não reenvie\./);
});

test('ambiguous (timeout/network) failure runs a READ-ONLY verification and never auto-resends', () => {
  const body = panel();
  assert.match(
    body,
    /const ambiguous = caught instanceof TypeError\s*\n\s*\|\| \(caught instanceof ApiError && \(caught\.code === 'timeout' \|\| caught\.code === 'network_error'\)\);/,
    'ambiguity is classified from the raw caught error (network/timeout only)',
  );
  assert.match(body, /const fresh = await getAdminEventConfig\(adminKey\);/, 'verification is a read, not a write');
  assert.doesNotMatch(
    body.slice(body.indexOf('if (!ambiguous) return;'), body.indexOf('if (!ambiguous) return;') + 1200),
    /updateAdminEventConfig\(adminKey, changes, reason\)|updateAdminDistance\(adminKey, distance\.id/,
    'the verification branch never re-issues the mutation call',
  );

  const h = helpers();
  assert.match(h, /function classifyConfigVerification\(/);
  assert.match(h, /if \(keys\.every\(\(key\) => canonical\[key\] === requestedChanges\[key\]\)\) return 'confirmed';/);
  assert.match(h, /if \(original && keys\.every\(\(key\) => canonical\[key\] === original\[key\]\)\) return 'not-applied';/);
  assert.match(h, /return 'unknown';/);
});

test('the modal renders all four verification outcomes distinctly and never offers a plain resend once verification is conclusive', () => {
  const m = modal();
  assert.match(m, /verification === 'confirmed' && \(/);
  assert.match(m, /A conexão falhou, mas a verificação confirmou que a alteração foi aplicada\. Não reenvie\./);
  assert.match(m, /verification === 'not-applied' && \(/);
  assert.match(m, /verification === 'unknown' && \(/);
  assert.match(m, /verification === 'unreachable' && \(/);
  // form is hidden once verification is conclusive (confirmed/unknown/unreachable) — only not-applied allows a retry
  assert.match(
    m,
    /const showReasonField = !succeeded && !sessionExpired\s*\n\s*&& verification !== 'confirmed' && verification !== 'unknown' && verification !== 'unreachable';/,
  );
  assert.match(m, /const concludeOnly = succeeded \|\| verification === 'confirmed';/);
  assert.match(m, /const reviewOnly = verification === 'unknown' \|\| verification === 'unreachable';/);
});

test('double-submit is prevented (inherited from useAdminMutation) and the modal cannot be dismissed mid-flight', () => {
  const m = modal();
  assert.match(m, /const submitting = state\.phase === 'submitting';/);
  assert.match(m, /disabled=\{submitting \|\| !reasonValid\}/);
  assert.match(m, /onClick=\{submitting \? undefined : onClose\}/);
});

test('lot is untouched by this wave: context is set to null for the lot kind, and its save call is unchanged', () => {
  const body = panel();
  assert.match(body, /if \(draft\.kind === 'event' \|\| draft\.kind === 'distance'\) \{\s*setConfigContext\(\{ kind: draft\.kind, refreshFailed: false, verification: null \}\);\s*\} else \{\s*setConfigContext\(null\);\s*\}/);
  assert.match(body, /await updateAdminLot\(adminKey, \(lot as \{ id: string \}\)\.id, built\.payload\);/);
  assert.equal((body.match(/await updateAdminLot\(/g) || []).length, 1, 'lot save still issues exactly one updateAdminLot call');
});
