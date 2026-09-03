import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Stage 2 / Wave 1 — structural guards on the athlete
// profile view + edit form. Repo convention (executive-dashboard-ui.test.ts):
// no jsdom; slice the component source from src/pages/Admin.tsx and assert.

const admin = readFileSync('src/pages/Admin.tsx', 'utf8');
const api = readFileSync('src/lib/api.ts', 'utf8');
const editLib = readFileSync('src/lib/admin-registration-edit.ts', 'utf8');

function slice(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `located ${start}`);
  return src.slice(a, b);
}

const form = slice(admin, 'function RegistrationEditForm({', '\nfunction canAccessNav(');
const drawer = slice(admin, 'function AthleteDrawer({', '\nfunction Detail({');
const parentSubmit = slice(admin, 'const submitRegistrationEdit = async (', '\n  const openRegistration = async (');

// ---- Q / R — profile view shows shirt size AND lot ----------------------
test('Q: the athlete drawer renders a "Tamanho da camisa" Detail bound to registration.shirtSize', () => {
  assert.match(drawer, /<Detail label="Tamanho da camisa" value=\{registration\.shirtSize \|\| 'Não informado'\} \/>/);
});
test('R: the athlete drawer still renders a "Lote" Detail', () => {
  assert.match(drawer, /<Detail label="Lote" value=\{registration\.lot/);
});

// ---- S / T — safe fallbacks, never literal NULL/undefined -------------
test('S/T: shirt + lot use a safe fallback and never print literal NULL/undefined', () => {
  assert.match(drawer, /registration\.shirtSize \|\| 'Não informado'/);
  assert.doesNotMatch(drawer, /value=\{registration\.shirtSize\}\s*\/>/); // bare, no fallback
  // the whole drawer never renders these literals
  assert.doesNotMatch(drawer, /"NULL"|>NULL<|undefined<|>null</);
});

// ---- 23-yes — the five editable controls + reason exist --------------
test('23: the edit form renders controls for the 5 editable fields + a mandatory reason', () => {
  assert.match(form, /EditInput label="Nome" value=\{form\.fullName\}/);
  assert.match(form, /EditInput label="E-mail" type="email" value=\{form\.email\}/);
  assert.match(form, /EditInput label="Telefone" value=\{form\.phone\}/);
  assert.match(form, /Sexo\s*\n\s*<select value=\{form\.gender\}/);
  assert.match(form, /Tamanho da camisa\s*\n\s*<select value=\{form\.shirtSize\}/);
  assert.match(form, /id="registration-edit-reason"/);
  assert.match(form, /aria-required="true"/);
});

// ---- 23-no — the six legacy fields are NOT in the form --------------
test('23: the edit form has NO control for any hidden legacy field', () => {
  for (const gone of ['birthDate', 'city', 'state', 'team', 'emergencyContactName', 'emergencyContactPhone']) {
    assert.doesNotMatch(form, new RegExp(`update\\('${gone}'`), `${gone} must not be editable`);
    assert.doesNotMatch(form, new RegExp(`form\\.${gone}\\b`), `${gone} must not be bound in the form`);
  }
  assert.doesNotMatch(form, /type="date"/, 'no date input (Nascimento removed)');
  assert.doesNotMatch(form, /label="UF"/);
});

// ---- dirty-fields-only wiring ------------------------------------
test('the form sends diffProfileChanges(registration, form) — dirty fields only', () => {
  assert.match(form, /const changes = diffProfileChanges\(registration, form\)/);
  assert.match(form, /onSubmit\(registration, changes, reason\.trim\(\)\)/);
  // parent hands `changes` straight to the PATCH client
  assert.match(parentSubmit, /updateAdminRegistration\(adminKey, registration\.id, changes as AdminRegistrationEditable, reason\)/);
});

// ---- §8 — no-op submission is impossible --------------------------
test('8: submit is gated on canSubmitProfileEdit (dirty AND reason) and shows a no-op hint', () => {
  assert.match(form, /canSubmitProfileEdit\(registration, form, reason\)/);
  assert.match(form, /disabled=\{!canSubmit\}/);
  assert.match(form, /Nenhuma alteração para salvar\./);
  assert.match(form, /\{!dirty && !submitting &&/);
});

// ---- H / I — submitting state visible + double-submit guarded -----
test('H/I: submitting is visible, submit disabled in-flight, canSubmit excludes submitting', () => {
  assert.match(form, /submitting \? 'Salvando\.\.\.'/);
  assert.match(form, /const submitting = state\.phase === 'submitting'/);
  assert.match(form, /canSubmitProfileEdit\(registration, form, reason\) && !submitting/);
  assert.match(form, /disabled disabled|disabled=\{submitting\}/); // fields disabled while submitting
  assert.match(form, /disabled=\{submitting\}/);
});

// ---- J / K / L — explicit success/failure, failure does NOT close --
test('J: explicit SUCCESS via describeProfileEditSuccess in a role="status" region', () => {
  assert.match(form, /succeeded && \(/);
  assert.match(form, /describeProfileEditSuccess\(context\.before, context\.changes\)/);
  assert.match(form, /role="status"/);
  assert.match(form, /aria-live="polite"/);
});
test('K: explicit FAILURE via state.error.message in a role="alert" region', () => {
  assert.match(form, /failed && !sessionExpired && \(/);
  assert.match(form, /state\.error\?\.message \|\| 'Não foi possível atualizar a inscrição\.'/);
  assert.match(form, /role="alert"/);
});
test('L: a failure keeps the panel open (no setOpen(false) on the failure path) and the form stays editable', () => {
  // panel stays open whenever the mutation is not idle
  assert.match(form, /const panelOpen = open \|\| state\.phase !== 'idle'/);
  // the failure branch renders the form fields again (not a dead-end)
  assert.match(form, /failed \? 'Tentar novamente'/);
});

// ---- M / N — authoritative refetch on backend SUCCESS -----------
test('M/N: on backend success the parent refetches the canonical record before acknowledge', () => {
  assert.match(parentSubmit, /const ok = await editRegistrationMutation\.submit\(async \(\) => \{/);
  assert.match(parentSubmit, /if \(!ok \|\| !response\) return;/);
  assert.match(parentSubmit, /updateRegistration\(response\.registration\)/);
  assert.match(parentSubmit, /getAdminRegistrationDetails\(adminKey, registration\.id\)/);
  assert.match(parentSubmit, /await loadAdminData\(\)/);
});

// ---- O — refetch failure after commit is distinct + no resubmit --
test('O: a refetch failure after a committed mutation sets refreshFailed and never re-runs the mutation', () => {
  assert.match(parentSubmit, /\} catch \{\s*[\s\S]*refreshFailed: true/);
  // the catch block must NOT call the mutation again
  const catchBlock = parentSubmit.slice(parentSubmit.indexOf('} catch {'));
  assert.doesNotMatch(catchBlock, /updateAdminRegistration|editRegistrationMutation\.submit/);
  assert.match(form, /context\?\.refreshFailed && \(/);
  assert.match(form, /Alteração salva, mas não foi possível atualizar os dados exibidos/);
});

// ---- P — network / ambiguous failure never auto-retries -------
test('P: admin mutations never auto-retry (adminFetch default) and profile edit is no exception', () => {
  assert.match(api, /retry: init\.retry \?\? false/);
  assert.match(api, /export function updateAdminRegistration\(/);
  const fn = slice(api, 'export function updateAdminRegistration(', '\n}');
  assert.doesNotMatch(fn, /retry:\s*true/);
});

// ---- backend untouched ---------------------------------------
test('the pure edit lib performs no I/O and does not import the API client or database', () => {
  assert.doesNotMatch(editLib, /from '\.\/api'|from '\.\.\/lib\/api'|from '\.\.\/hooks|requirePool|fetch\(|process\.env/);
  assert.match(editLib, /HIDDEN_LEGACY_PROFILE_FIELDS = \[/);
  assert.match(editLib, /EDITABLE_PROFILE_FIELDS = \['fullName', 'email', 'phone', 'gender', 'shirtSize'\]/);
});
