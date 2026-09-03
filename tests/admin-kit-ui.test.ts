import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 2C — structural guards on the Admin kit delivery /
// undo-kit UX. Repo convention (admin-check-in-ui / admin-bib-ui): no jsdom;
// slice component source from src/pages/Admin.tsx and assert.

const admin = readFileSync('src/pages/Admin.tsx', 'utf8');
const api = readFileSync('src/lib/api.ts', 'utf8');
const types = readFileSync('src/types/registration.ts', 'utf8');

function slice(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `located ${start}`);
  return src.slice(a, b);
}

const modal = slice(admin, 'function KitModal({', '\n// ADMIN-UX-HOTFIX-001 — event / distance / lot config save modal');
const parentSubmit = slice(admin, 'const submitKit = async () => {', '\n  const acknowledgeKit =');
const openers = slice(admin, 'const openKitDeliver = (registration: AdminRegistration) => {', '\n  const canSubmitKit =');
const drawer = slice(admin, 'function AthleteDrawer({', '\nfunction Detail({');

// ---- §23 — kit / undo-kit run on useAdminMutation --------------------
test('§23: kit delivery uses useAdminMutation<AdminKitResponse>, not ad-hoc actionLoading', () => {
  assert.match(admin, /const kitMutation = useAdminMutation<AdminKitResponse>\(/);
  assert.doesNotMatch(parentSubmit, /setActionLoading\('kit'\)/);
  assert.match(openers, /kitMutation\.open\(\)/);
  assert.match(admin, /const openKitDeliver = \(registration: AdminRegistration\) => \{[\s\S]*?mode: 'deliver'/);
  assert.match(admin, /const openUndoKit = \(registration: AdminRegistration\) => \{[\s\S]*?mode: 'undo'/);
});

// ---- §23 / §24 — canonical current state always shown ----------------
test('§23/§24: the modal always shows the canonical current kit state and a distinct title', () => {
  assert.match(modal, /Kit atual: <span className="text-white">\{kitLabel\}<\/span>/);
  assert.match(modal, /reg\.kitStatus === 'delivered'/);
  assert.match(modal, /isUndo \? 'Desfazer entrega do kit' : 'Registrar entrega do kit'/);
});

// ---- §23 — PG-1: an active check-in is required to deliver ----------
test('§23: PG-1 — deliver disabled when not checked in; drawer explains it; server 409 surfaced', () => {
  // canSubmitKit gates deliver on checkInStatus
  assert.match(admin, /const canSubmitKit = \(draft: \{ mode: 'deliver' \| 'undo'; reason: string; registration: AdminRegistration \}\) =>/);
  assert.match(admin, /draft\.mode === 'deliver'\s*\?\s*draft\.registration\.checkInStatus === 'checked_in'\s*:\s*draft\.reason\.trim\(\)\.length >= 5/);
  // drawer kit button disabled + explanatory title when not checked in
  assert.match(drawer, /disabled=\{!canHandleOperation \|\| !canOperate \|\| registration\.kitStatus === 'delivered' \|\| registration\.checkInStatus !== 'checked_in' \|\| actionLoading !== ''\}/);
  assert.match(drawer, /O kit só pode ser entregue após o check-in\./);
  // modal: checkInRequired derivation + block panel + server businessCode
  assert.match(modal, /const isCheckInRequired = failed && businessCode === 'CHECK_IN_REQUIRED_FOR_KIT_DELIVERY'/);
  assert.match(modal, /const checkInRequired = \(!isUndo && !checkedIn\) \|\| isCheckInRequired \|\| verification === 'check-in-required'/);
  assert.match(modal, /\{checkInRequired && \(/);
});

// ---- undo-kit reason policy preserved ---------------------------
test('§23: undo-kit requires a reason (>=5); deliver takes only optional notes; nothing new mandated', () => {
  assert.match(modal, /aria-required="true"/);
  assert.match(modal, /Observações <span className="font-normal text-zinc-500">\(opcional\)<\/span>/);
  assert.match(drawer, /onClick=\{\(\) => onUndoKit\(registration\)\}/);
});

// ---- §25 — one in-flight, submit disabled while submitting ----------
test('§25: submitting is visible, submit disabled in-flight / when invalid, double-submit guarded', () => {
  assert.match(modal, /const submitting = state\.phase === 'submitting'/);
  assert.match(modal, /disabled=\{submitting \|\| !canSubmit\}/);
  assert.match(modal, /submitting\s*\?\s*'Salvando\.\.\.'/);
  assert.match(parentSubmit, /const ok = await kitMutation\.submit\(async \(\) => \{/);
});

// ---- §26 — authoritative refresh before acknowledge ---------------
test('§26: on a successful transition the parent refetches the canonical record', () => {
  assert.match(parentSubmit, /if \(ok && response\) \{/);
  assert.match(parentSubmit, /updateRegistration\(response\.registration\)/);
  assert.match(parentSubmit, /setRegistrationDetails\(await getAdminRegistrationDetails\(adminKey, before\.id\)\)/);
  assert.match(parentSubmit, /await loadAdminData\(\)/);
});

// ---- §27 / §28 — ambiguous transport -> READ-ONLY verification ----
test('§27/§28: a timeout / bare network failure triggers a read-only verification, never an auto-resend', () => {
  assert.match(parentSubmit, /const ambiguous = caught instanceof TypeError\s*\|\|\s*\(caught instanceof ApiError && \(caught\.code === 'timeout' \|\| caught\.code === 'network_error'\)\)/);
  assert.match(parentSubmit, /if \(!ambiguous\) return;/);
  assert.match(parentSubmit, /const details = await getAdminRegistrationDetails\(adminKey, before\.id\)/);
  assert.match(parentSubmit, /const delivered = details\.registration\.kitStatus === 'delivered'/);
  assert.match(parentSubmit, /const checkedIn = details\.registration\.checkInStatus === 'checked_in'/);
  // deliver verdicts incl. check-in-required
  assert.match(parentSubmit, /verification = delivered \? 'confirmed' : \(checkedIn \? 'not-applied' : 'check-in-required'\)/);
  // undo verdicts
  assert.match(parentSubmit, /verification = !delivered \? 'confirmed' : 'not-applied'/);
  // never re-sent after the failure
  const after = parentSubmit.slice(parentSubmit.indexOf('if (!ambiguous) return;'));
  assert.doesNotMatch(after, /deliverAdminKit|undoAdminRegistrationKitDelivery|kitMutation\.submit/);
});

test('§27: each verification verdict has its own message; only "not applied" offers retry', () => {
  assert.match(modal, /verification === 'confirmed'/);
  assert.match(modal, /a verificação confirmou que a entrega do kit foi \{isUndo \? 'desfeita' : 'registrada'\}/);
  assert.match(modal, /verification === 'not-applied'/);
  assert.match(modal, /a ação NÃO foi aplicada/);
  assert.match(modal, /verification === 'check-in-required'/); // referenced in the checkInRequired derivation
  assert.match(modal, /verification === 'unknown'/);
  assert.match(modal, /verification === 'unreachable'/);
  assert.match(modal, /const concludeOnly = succeeded \|\| verification === 'confirmed';/);
  assert.match(modal, /const reviewOnly = checkInRequired \|\| verification === 'unknown' \|\| verification === 'unreachable';/);
});

// ---- §29 — committed-but-refresh-failed is its own state ----------
test('§29: a refetch failure after a committed transition is distinct and never re-runs the mutation', () => {
  assert.match(parentSubmit, /\} catch \{[\s\S]*?setKitContext\(\(current\) => \(current \? \{ \.\.\.current, refreshFailed: true \} : current\)\)/);
  const firstCatch = parentSubmit.slice(parentSubmit.indexOf('} catch {'));
  const upToReturn = firstCatch.slice(0, firstCatch.indexOf('return;'));
  assert.doesNotMatch(upToReturn, /deliverAdminKit|undoAdminRegistrationKitDelivery|kitMutation\.submit/);
  assert.match(modal, /context\?\.refreshFailed && \(/);
  assert.match(modal, /Operação salva, mas não foi possível atualizar os dados exibidos\. Atualize antes de tentar novamente/);
});

// ---- §25 — 401 session expiry ---------------------------------
test('§25: a 401 is a described session-expiry with its own button', () => {
  assert.match(modal, /const sessionExpired = failed && Boolean\(state\.error\?\.sessionExpired\)/);
  assert.match(modal, /onClick=\{onSessionExpired\}/);
  assert.match(modal, /Entrar novamente/);
});

// ---- informational ALREADY_* is not an error ------------------
test('§24: KIT_ALREADY_DELIVERED / KIT_ALREADY_NOT_DELIVERED render as status, never as alert', () => {
  const alreadyBlock = slice(modal, "outcome === 'KIT_ALREADY_DELIVERED' || outcome === 'KIT_ALREADY_NOT_DELIVERED'", 'failed && !sessionExpired');
  assert.match(alreadyBlock, /role="status"/);
  assert.doesNotMatch(alreadyBlock, /role="alert"/);
});

// ---- transport: no auto-retry -------------------------------
test('§25: kit / undo-kit clients are retry:false and typed to the machine-outcome response', () => {
  const d = slice(api, 'export function deliverAdminKit(', '\n}');
  const u = slice(api, 'export function undoAdminRegistrationKitDelivery(', '\n}');
  assert.match(d, /adminFetch<AdminKitResponse>/);
  assert.match(d, /\/kit\$\{toQueryString\(\{ event: currentEventParam\(\) \}\)\}/);
  assert.match(d, /retry: false/);
  assert.match(u, /adminFetch<AdminKitResponse>/);
  assert.match(u, /\/undo-kit\$\{toQueryString\(\{ event: currentEventParam\(\) \}\)\}/);
  assert.match(u, /retry: false/);
});

test('§21: AdminKitResponse enumerates the machine outcomes; success decodes only the four 200 shapes', () => {
  assert.match(types, /export type AdminKitOutcome =\s*\|\s*'KIT_DELIVERED'\s*\|\s*'KIT_ALREADY_DELIVERED'\s*\|\s*'KIT_DELIVERY_REVERTED'\s*\|\s*'KIT_ALREADY_NOT_DELIVERED'\s*\|\s*'CHECK_IN_REQUIRED_FOR_KIT_DELIVERY'\s*\|\s*'NOT_ELIGIBLE'\s*\|\s*'NOT_FOUND';/);
  assert.match(types, /outcome: Extract<\s*AdminKitOutcome,\s*'KIT_DELIVERED' \| 'KIT_ALREADY_DELIVERED' \| 'KIT_DELIVERY_REVERTED' \| 'KIT_ALREADY_NOT_DELIVERED'\s*>;/);
});

// ---- §41 / §42 / §43 — Wave 2B / 2A / 1 non-regression in the drawer -
test('§41/§42/§43: the drawer still mounts check-in (Wave 2B), bib (2A) and profile edit (1)', () => {
  assert.match(drawer, /onClick=\{\(\) => onUndoCheckIn\(registration\)\}/);
  assert.match(drawer, /<Detail label="Tamanho da camisa" value=\{registration\.shirtSize \|\| 'Não informado'\} \/>/);
  assert.match(drawer, /<RegistrationEditForm/);
  assert.match(admin, /assignAdminBibNumber/);
  assert.match(admin, /const checkInMutation = useAdminMutation<AdminCheckInResponse>\(/);
});
