import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 2B — structural guards on the Admin check-in /
// undo-check-in UX. Repo convention (admin-bib-ui / admin-registration-edit-ui):
// no jsdom; slice component source from src/pages/Admin.tsx and assert.

const admin = readFileSync('src/pages/Admin.tsx', 'utf8');
const api = readFileSync('src/lib/api.ts', 'utf8');
const types = readFileSync('src/types/registration.ts', 'utf8');

function slice(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `located ${start}`);
  return src.slice(a, b);
}

const modal = slice(admin, 'function CheckInModal({', '\n// ADMIN-UX-HOTFIX-001 — event / distance / lot config save modal');
const parentSubmit = slice(admin, 'const submitCheckIn = async () => {', '\n  const acknowledgeCheckIn =');
const openers = slice(admin, 'const openCheckIn = (registration: AdminRegistration) => {', '\n  const canSubmitCheckIn =');
const drawer = slice(admin, 'function AthleteDrawer({', '\nfunction Detail({');

// ---- §21 — check-in / undo-check-in run on useAdminMutation ------------
test('§21: check-in uses useAdminMutation<AdminCheckInResponse>, not ad-hoc actionLoading', () => {
  assert.match(admin, /const checkInMutation = useAdminMutation<AdminCheckInResponse>\(/);
  assert.doesNotMatch(parentSubmit, /setActionLoading\('check-in'\)/);
  assert.match(openers, /checkInMutation\.open\(\)/);
  // both openers set the mode
  assert.match(admin, /const openCheckIn = \(registration: AdminRegistration\) => \{[\s\S]*?mode: 'check-in'/);
  assert.match(admin, /const openUndoCheckIn = \(registration: AdminRegistration\) => \{[\s\S]*?mode: 'undo'/);
});

// ---- §21 / §24 — canonical current state always shown -----------------
test('§21: the modal always shows the canonical current check-in state', () => {
  assert.match(modal, /Check-in atual: <span className="text-white">\{checkedInLabel\}<\/span>/);
  assert.match(modal, /reg\.checkInStatus === 'checked_in'/);
  assert.match(modal, /isUndo \? 'Desfazer check-in' : 'Registrar check-in'/);
});

// ---- §23 — reason policy: undo mandatory >=5, check-in optional notes --
test('§23: undo requires a reason (>=5); check-in takes only optional notes; nothing new mandated', () => {
  assert.match(admin, /const canSubmitCheckIn = \(draft: \{ mode: 'check-in' \| 'undo'; reason: string; registration: AdminRegistration \}\) =>/);
  assert.match(admin, /draft\.mode === 'check-in'\s*\?\s*true\s*:\s*draft\.reason\.trim\(\)\.length >= 5 && draft\.registration\.kitStatus !== 'delivered'/);
  assert.match(modal, /aria-required="true"/);
  assert.match(modal, /Observações <span className="font-normal text-zinc-500">\(opcional\)<\/span>/);
});

// ---- §24 — one in-flight, submit disabled while submitting -----------
test('§24: submitting is visible, submit disabled in-flight / when invalid, double-submit guarded', () => {
  assert.match(modal, /const submitting = state\.phase === 'submitting'/);
  assert.match(modal, /disabled=\{submitting \|\| !canSubmit\}/);
  assert.match(modal, /submitting\s*\?\s*'Salvando\.\.\.'/);
  assert.match(parentSubmit, /const ok = await checkInMutation\.submit\(async \(\) => \{/);
});

// ---- §25 — authoritative refresh before acknowledge -----------------
test('§25: on a successful transition the parent refetches the canonical record', () => {
  assert.match(parentSubmit, /if \(ok && response\) \{/);
  assert.match(parentSubmit, /updateRegistration\(response\.registration\)/);
  assert.match(parentSubmit, /setRegistrationDetails\(await getAdminRegistrationDetails\(adminKey, before\.id\)\)/);
  assert.match(parentSubmit, /await loadAdminData\(\)/);
});

// ---- §26 / §27 — ambiguous transport -> READ-ONLY verification ------
test('§26/§27: a timeout / bare network failure triggers a read-only verification, never an auto-resend', () => {
  assert.match(parentSubmit, /const ambiguous = caught instanceof TypeError\s*\|\|\s*\(caught instanceof ApiError && \(caught\.code === 'timeout' \|\| caught\.code === 'network_error'\)\)/);
  assert.match(parentSubmit, /if \(!ambiguous\) return;/);
  assert.match(parentSubmit, /const details = await getAdminRegistrationDetails\(adminKey, before\.id\)/);
  assert.match(parentSubmit, /const checkedIn = details\.registration\.checkInStatus === 'checked_in'/);
  assert.match(parentSubmit, /const kitDelivered = details\.registration\.kitStatus === 'delivered'/);
  // check-in verdicts
  assert.match(parentSubmit, /verification = checkedIn \? 'confirmed' : 'not-applied'/);
  // undo verdicts incl. blocked-by-kit
  assert.match(parentSubmit, /\} else if \(!checkedIn\) \{\s*verification = 'confirmed';\s*\} else if \(kitDelivered\) \{\s*verification = 'blocked-by-kit';\s*\} else \{\s*verification = 'not-applied';/);
  // never re-sent after the failure
  const after = parentSubmit.slice(parentSubmit.indexOf('if (!ambiguous) return;'));
  assert.doesNotMatch(after, /checkInAdminRegistration|undoAdminRegistrationCheckIn|checkInMutation\.submit/);
});

test('§26: each verification verdict has its own message; only "not applied" offers retry', () => {
  assert.match(modal, /verification === 'confirmed'/);
  assert.match(modal, /a verificação confirmou que o check-in foi \{isUndo \? 'desfeito' : 'registrado'\}/);
  assert.match(modal, /verification === 'not-applied'/);
  assert.match(modal, /a ação NÃO foi aplicada/);
  assert.match(modal, /verification === 'blocked-by-kit'/); // referenced in the kitBlocked derivation
  assert.match(modal, /verification === 'unknown'/);
  assert.match(modal, /verification === 'unreachable'/);
  assert.match(modal, /const concludeOnly = succeeded \|\| verification === 'confirmed';/);
  assert.match(modal, /const reviewOnly = kitBlocked \|\| verification === 'unknown' \|\| verification === 'unreachable';/);
});

// ---- §28 — committed-but-refresh-failed is its own state ------------
test('§28: a refetch failure after a committed transition is distinct and never re-runs the mutation', () => {
  assert.match(parentSubmit, /\} catch \{[\s\S]*?setCheckInContext\(\(current\) => \(current \? \{ \.\.\.current, refreshFailed: true \} : current\)\)/);
  const firstCatch = parentSubmit.slice(parentSubmit.indexOf('} catch {'));
  const upToReturn = firstCatch.slice(0, firstCatch.indexOf('return;'));
  assert.doesNotMatch(upToReturn, /checkInAdminRegistration|undoAdminRegistrationCheckIn|checkInMutation\.submit/);
  assert.match(modal, /context\?\.refreshFailed && \(/);
  assert.match(modal, /Operação salva, mas não foi possível atualizar os dados exibidos\. Atualize antes de tentar novamente/);
});

// ---- §22 / §29 — PG-2 supplemental UI block -----------------------
test('§22/§29: an active kit delivery blocks undo in the UI (supplemental) and surfaces the server 409', () => {
  // drawer button disabled + explanatory title when kit delivered
  assert.match(drawer, /registration\.checkInStatus === 'checked_in' && \(/);
  assert.match(drawer, /disabled=\{actionLoading !== '' \|\| registration\.kitStatus === 'delivered'\}/);
  assert.match(drawer, /O check-in não pode ser desfeito enquanto a entrega do kit estiver registrada\. Desfaça primeiro a entrega do kit\./);
  assert.match(drawer, /onClick=\{\(\) => onUndoCheckIn\(registration\)\}/);
  // modal: kitBlocked derivation + block panel + server businessCode
  assert.match(modal, /const isKitBlock = failed && businessCode === 'KIT_DELIVERY_BLOCKS_CHECK_IN_UNDO'/);
  assert.match(modal, /const kitBlocked = \(isUndo && kitDelivered\) \|\| isKitBlock \|\| verification === 'blocked-by-kit'/);
  assert.match(modal, /\{kitBlocked && \(/);
});

// ---- §22 — 401 session expiry -----------------------------------
test('§22: a 401 is a described session-expiry with its own button', () => {
  assert.match(modal, /const sessionExpired = failed && Boolean\(state\.error\?\.sessionExpired\)/);
  assert.match(modal, /onClick=\{onSessionExpired\}/);
  assert.match(modal, /Entrar novamente/);
});

// ---- §24 — informational ALREADY_* is not an error ----------------
test('§24: ALREADY_CHECKED_IN / ALREADY_NOT_CHECKED_IN render as status, never as alert', () => {
  const alreadyBlock = slice(modal, "outcome === 'ALREADY_CHECKED_IN' || outcome === 'ALREADY_NOT_CHECKED_IN'", 'failed && !sessionExpired');
  assert.match(alreadyBlock, /role="status"/);
  assert.doesNotMatch(alreadyBlock, /role="alert"/);
});

// ---- transport: no auto-retry -----------------------------------
test('§24: check-in / undo clients are retry:false and typed to the machine-outcome response', () => {
  const ci = slice(api, 'export function checkInAdminRegistration(', '\n}');
  const undo = slice(api, 'export function undoAdminRegistrationCheckIn(', '\n}');
  assert.match(ci, /adminFetch<AdminCheckInResponse>/);
  assert.match(ci, /retry: false/);
  assert.match(undo, /adminFetch<AdminCheckInResponse>/);
  assert.match(undo, /\/undo-check-in\$\{toQueryString\(\{ event: currentEventParam\(\) \}\)\}/);
  assert.match(undo, /retry: false/);
});

test('§19: AdminCheckInResponse enumerates the machine outcomes; success decodes only the four 200 shapes', () => {
  assert.match(types, /export type AdminCheckInOutcome =\s*\|\s*'CHECK_IN_ACCEPTED'\s*\|\s*'ALREADY_CHECKED_IN'\s*\|\s*'CHECK_IN_REVERTED'\s*\|\s*'ALREADY_NOT_CHECKED_IN'\s*\|\s*'KIT_DELIVERY_BLOCKS_CHECK_IN_UNDO'\s*\|\s*'NOT_ELIGIBLE'\s*\|\s*'NOT_FOUND';/);
  assert.match(types, /outcome: Extract<\s*AdminCheckInOutcome,\s*'CHECK_IN_ACCEPTED' \| 'ALREADY_CHECKED_IN' \| 'CHECK_IN_REVERTED' \| 'ALREADY_NOT_CHECKED_IN'\s*>;/);
});

// ---- §37 / §38 — Wave 2A + Wave 1 non-regression in the drawer ----
test('§37/§38: the drawer still mounts bib + profile edit + shirt-size Detail (no opportunistic refactor)', () => {
  assert.match(drawer, /<Detail label="Tamanho da camisa" value=\{registration\.shirtSize \|\| 'Não informado'\} \/>/);
  assert.match(drawer, /<RegistrationEditForm/);
  assert.match(admin, /assignAdminBibNumber/);
});
