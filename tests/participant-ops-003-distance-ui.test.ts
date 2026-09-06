import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// PARTICIPANT-OPS-003 Stage 2 — structural guards on the "Alterar prova" Admin
// UX. Repo convention (admin-bib-ui): no jsdom; slice the component source from
// src/pages/Admin.tsx and assert.

const admin = readFileSync('src/pages/Admin.tsx', 'utf8');
const api = readFileSync('src/lib/api.ts', 'utf8');
const types = readFileSync('src/types/registration.ts', 'utf8');

function slice(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `located ${start}`);
  return src.slice(a, b);
}

const modal = slice(admin, 'function DistanceCorrectionModal({', '\n// ADMIN-UX-RELIABILITY Wave 2B — reliable check-in');
const parentSubmit = slice(admin, 'const submitDistanceCorrection = async () => {', '\n  const acknowledgeDistanceCorrection =');
const handleCorrect = slice(admin, 'const handleCorrectDistance = (registration: AdminRegistration) => {', '\n  const canSubmitDistance =');
const drawer = slice(admin, 'function AthleteDrawer({', '\nfunction Detail({');

// ---- runs on the reusable state machine, not ad-hoc actionLoading ------
test('distance correction uses useAdminMutation<AdminRegistrationDistanceResponse>', () => {
  assert.match(admin, /const distanceMutation = useAdminMutation<AdminRegistrationDistanceResponse>\(/);
  assert.doesNotMatch(parentSubmit, /setActionLoading\(/, 'no ad-hoc actionLoading flow');
  assert.match(handleCorrect, /distanceMutation\.open\(\)/, 'opening the action enters the confirming phase');
  assert.match(handleCorrect, /distanceMutation\.reset\(\)/, 'a fresh open resets any prior state');
});

// ---- modal shows current vs new prova, and that only the prova changes -
test('modal states "Prova atual" vs "Nova prova" and that lote + valor pago are unchanged', () => {
  assert.match(modal, /<h3 className="text-xl font-black">Alterar prova<\/h3>/);
  assert.match(modal, /Prova atual/);
  assert.match(modal, /Nova prova/);
  assert.match(modal, /altera <span className="font-black text-white">apenas a prova<\/span>/);
  assert.match(modal, /O lote \(<span className="text-white">\{draft\.registration\.lot \|\| 'não informado'\}<\/span>\) e o valor pago/);
  assert.match(modal, /nenhum valor é cobrado ou estornado/);
  assert.match(modal, /A prova será corrigida de <span className="font-black">\{currentLabel\}<\/span> para <span className="font-black">\{requestedLabel\}<\/span>/);
});

// ---- reason required (min 5), server stays authoritative --------------
test('reason is required (min 5) client-side, mirroring — not replacing — the server', () => {
  assert.match(admin, /const DISTANCE_REASON_MIN_LENGTH = 5;/);
  assert.match(admin, /draft\.reason\.trim\(\)\.length >= DISTANCE_REASON_MIN_LENGTH/);
  assert.match(modal, /aria-required="true"/);
  // cannot submit when target is empty or equals the current distance
  assert.match(admin, /Boolean\(draft\.targetDistanceId\)\s*\n\s*&& draft\.targetDistanceId !== draft\.registration\.distanceId\s*\n\s*&& draft\.reason\.trim\(\)\.length >= DISTANCE_REASON_MIN_LENGTH/);
});

// ---- double-submit guard + retry:false + never auto-resend -----------
test('submitting disables submit; retry:false at the client; ambiguous failure verifies read-only, never resends', () => {
  assert.match(modal, /const submitting = state\.phase === 'submitting';/);
  assert.match(modal, /disabled=\{submitting \|\| !canSubmit\}/, 'submit disabled while in flight or invalid');
  assert.match(modal, /\{submitting \? 'Salvando\.\.\.' :/, 'in-flight label');
  assert.match(api, /export function correctAdminRegistrationDistance\(/);
  assert.match(api, /\/distance\$\{toQueryString\(\{ event: currentEventParam\(\) \}\)\}`, adminKey, \{\s*\n\s*method: 'POST',[\s\S]*?retry: false,/, 'client sends retry:false');
  // ambiguous network/timeout → READ-ONLY verification, no re-POST
  assert.match(parentSubmit, /const ambiguous = caught instanceof TypeError\s*\n\s*\|\| \(caught instanceof ApiError && \(caught\.code === 'timeout' \|\| caught\.code === 'network_error'\)\);/);
  assert.match(parentSubmit, /const details = await getAdminRegistrationDetails\(adminKey, before\.id\);/, 'verification is a GET, not a retry POST');
  assert.doesNotMatch(parentSubmit, /await correctAdminRegistrationDistance\([\s\S]*?await correctAdminRegistrationDistance\(/, 'the mutation is issued at most once per submit');
});

// ---- authoritative refresh + committed-but-refresh-failed -------------
test('success path refetches canonical state; a refresh failure after commit is a distinct, non-resending state', () => {
  assert.match(parentSubmit, /updateRegistration\(response\.registration\);\s*\n\s*setRegistrationDetails\(await getAdminRegistrationDetails\(adminKey, before\.id\)\);\s*\n\s*await loadAdminData\(\);/, 'success → authoritative refresh');
  assert.match(parentSubmit, /setDistanceContext\(\(current\) => \(current \? \{ \.\.\.current, refreshFailed: true \} : current\)\)/, 'refresh failure is recorded, not surfaced as a mutation failure');
  assert.match(modal, /Prova corrigida, mas não foi possível atualizar os dados exibidos\. Atualize antes de tentar novamente — não reenvie\./);
});

// ---- verification classification states ------------------------------
test('modal renders confirmed / not-applied / unknown / unreachable verification states', () => {
  assert.match(modal, /verification === 'confirmed'/);
  assert.match(modal, /verification === 'not-applied'/);
  assert.match(modal, /verification === 'unknown'/);
  assert.match(modal, /verification === 'unreachable'/);
  assert.match(modal, /A conexão falhou, mas a verificação confirmou que a prova foi corrigida/);
  assert.match(modal, /a verificação mostra que a alteração NÃO foi aplicada/);
});

// ---- session expiry ------------------------------------------------
test('session-expired failure blocks retry and routes to re-login', () => {
  assert.match(modal, /const sessionExpired = failed && Boolean\(state\.error\?\.sessionExpired\);/);
  assert.match(modal, /A alteração NÃO foi executada\. Entre novamente para continuar\./);
  assert.match(modal, /onClick=\{onSessionExpired\}/);
});

// ---- drawer button gating ----------------------------------------
test('the "Alterar prova" button is administrator-only, paid-only, and needs a sibling distance', () => {
  assert.match(drawer, /canEditRegistration && registration\.status === 'paid' && distanceOptions\.some\(\(option\) => option\.id !== registration\.distanceId\)/);
  assert.match(drawer, />Alterar prova<\/button>/);
  assert.match(drawer, /const canEditRegistration = adminRole === 'administrator';/);
});

// ---- outcome type is the two success shapes only --------------------
test('AdminRegistrationDistanceResponse decodes only the two 200 outcomes', () => {
  assert.match(types, /export type AdminRegistrationDistanceOutcome =\s*\n\s*\| 'DISTANCE_UPDATED'\s*\n\s*\| 'DISTANCE_UNCHANGED'\s*\n\s*\| 'NOT_ELIGIBLE'\s*\n\s*\| 'TARGET_DISTANCE_NOT_FOUND'\s*\n\s*\| 'TARGET_DISTANCE_NOT_AVAILABLE'\s*\n\s*\| 'NOT_FOUND';/);
  assert.match(types, /outcome: Extract<AdminRegistrationDistanceOutcome, 'DISTANCE_UPDATED' \| 'DISTANCE_UNCHANGED'>;/);
});
