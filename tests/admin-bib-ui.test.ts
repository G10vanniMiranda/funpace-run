import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 2A — structural guards on the Admin bib-number UX.
// Repo convention (executive-dashboard-ui / admin-registration-edit-ui): no
// jsdom; slice the component source from src/pages/Admin.tsx and assert.

const admin = readFileSync('src/pages/Admin.tsx', 'utf8');
const api = readFileSync('src/lib/api.ts', 'utf8');
const types = readFileSync('src/types/registration.ts', 'utf8');

function slice(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `located ${start}`);
  return src.slice(a, b);
}

const modal = slice(admin, 'function BibNumberModal({', '\n// ADMIN-UX-HOTFIX-001 — event / distance / lot config save modal');
const parentSubmit = slice(admin, 'const submitBibNumber = async () => {', '\n  const acknowledgeBibNumber =');
const handleBib = slice(admin, 'const handleBibNumber = (registration: AdminRegistration) => {', '\n  const canSubmitBibNumber =');
const drawer = slice(admin, 'function AthleteDrawer({', '\nfunction Detail({');

// ---- §19 — the bib action runs on the reusable state machine ----------
test('§19: bib assignment uses useAdminMutation<AdminBibNumberResponse> (not ad-hoc actionLoading)', () => {
  assert.match(admin, /const bibMutation = useAdminMutation<AdminBibNumberResponse>\(/);
  assert.doesNotMatch(parentSubmit, /setActionLoading\('bib'\)/, 'no ad-hoc actionLoading("bib") flow');
  assert.match(handleBib, /bibMutation\.open\(\)/, 'opening the drawer action enters the confirming phase');
});

// ---- §19 — UNASSIGNED vs ASSIGNED intent + canonical current bib -------
test('§19/§20: distinct "Atribuir" vs "Alterar" title and the current bib is always shown', () => {
  assert.match(modal, /isReplacement \? 'Alterar número de peito' : 'Atribuir número de peito'/);
  assert.match(modal, /Número atual: <span className="text-white">\{currentBib \|\| 'Não atribuído'\}<\/span>/, 'confirming step shows the canonical current bib (or "Não atribuído")');
  assert.match(modal, /Esta ação substituirá o número de peito atual/, 'replacing an existing bib is visually explicit');
  // the drawer button label switches on the canonical value
  assert.match(drawer, /registration\.bibNumber \? 'Alterar numero de peito' : 'Atribuir numero de peito'/);
});

// ---- §21 — reason mirrors the backend minimum, server stays authoritative
test('§21: reason is required (min 5) client-side, mirroring — not replacing — the server', () => {
  assert.match(admin, /const BIB_REASON_MIN_LENGTH = 5;/);
  assert.match(admin, /const isBibNumberShapeValid = \(value: string\) => BIB_NUMBER_PATTERN\.test\(normalizeBibNumber\(value\)\)/);
  assert.match(admin, /draft\.reason\.trim\(\)\.length >= BIB_REASON_MIN_LENGTH/);
  assert.match(modal, /aria-required="true"/);
});

// ---- §22 — one in-flight mutation, submit disabled while submitting ----
test('§22: submitting is visible, submit is disabled in-flight and when the draft is invalid', () => {
  assert.match(modal, /const submitting = state\.phase === 'submitting'/);
  assert.match(modal, /disabled=\{submitting \|\| !canSubmit\}/);
  assert.match(modal, /submitting \? 'Salvando\.\.\.'/);
  // the runtime itself no-ops a second submit() while submitting (double-submit guard)
  assert.match(parentSubmit, /const ok = await bibMutation\.submit\(async \(\) => \{/);
});

// ---- §23 — authoritative refetch BEFORE success is acknowledged -------
test('§23/§28: on BIB_UPDATED the parent refetches the canonical record before the operator concludes', () => {
  assert.match(parentSubmit, /if \(ok && response\) \{/);
  assert.match(parentSubmit, /updateRegistration\(response\.registration\)/);
  assert.match(parentSubmit, /setRegistrationDetails\(await getAdminRegistrationDetails\(adminKey, before\.id\)\)/);
  assert.match(parentSubmit, /await loadAdminData\(\)/);
  // success message is explicit + canonical
  assert.match(modal, /Número de peito atualizado para \$\{context\?\.requested \?\? nextBib\}/);
});

// ---- §24 — BIB_UNCHANGED is informational, not an error --------------
test('§24: BIB_UNCHANGED renders as an informational status (role="status"), never role="alert"', () => {
  assert.match(modal, /succeeded && outcome === 'BIB_UNCHANGED'/);
  const unchangedBlock = slice(modal, "outcome === 'BIB_UNCHANGED'", 'failed && !sessionExpired');
  assert.match(unchangedBlock, /role="status"/);
  assert.doesNotMatch(unchangedBlock, /role="alert"/);
  assert.match(unchangedBlock, /O número de peito já estava definido como/);
});

// ---- §25 — BIB_CONFLICT is an explicit conflict, edit stays available -
test('§25: BIB_CONFLICT is an explicit failure that keeps the edit form and never auto-retries', () => {
  assert.match(modal, /const isConflict = failed && \(businessCode === 'BIB_CONFLICT'/);
  assert.match(modal, /Este número de peito já está vinculado a outra inscrição\./);
  // conflict is a `failed` state with verification === null → showForm stays true
  assert.match(modal, /const showForm = !succeeded && !sessionExpired\s*\n\s*&& verification !== 'confirmed' && verification !== 'unknown' && verification !== 'unreachable';/);
  assert.match(modal, /\(failed \|\| verification === 'not-applied'\) \? 'Tentar novamente'/, 'retry is a manual button, not automatic');
});

// ---- §26 — ambiguous network → READ-ONLY verification, never resend ---
test('§26: a timeout / bare network failure triggers a read-only verification, never an automatic resend', () => {
  assert.match(parentSubmit, /const ambiguous = caught instanceof TypeError\s*\n\s*\|\| \(caught instanceof ApiError && \(caught\.code === 'timeout' \|\| caught\.code === 'network_error'\)\)/);
  assert.match(parentSubmit, /if \(!ambiguous\) return;/);
  assert.match(parentSubmit, /const details = await getAdminRegistrationDetails\(adminKey, before\.id\)/, 'verification is a READ');
  assert.match(parentSubmit, /const canonical = details\.registration\.bibNumber \|\| null/);
  assert.match(parentSubmit, /canonical === requested\s*\n\s*\? 'confirmed' as const/);
  assert.match(parentSubmit, /canonical === \(before\.bibNumber \|\| null\)\s*\n\s*\? 'not-applied' as const/);
  assert.match(parentSubmit, /: 'unknown' as const/);
  // the mutation is NEVER re-invoked anywhere after the failure
  const afterFailure = parentSubmit.slice(parentSubmit.indexOf('if (!ambiguous) return;'));
  assert.doesNotMatch(afterFailure, /assignAdminBibNumber|bibMutation\.submit/, 'no resend / re-submit after an ambiguous failure');
});

test('§26: each verification verdict has its own operator message and only "not applied" offers retry', () => {
  assert.match(modal, /verification === 'confirmed'/);
  assert.match(modal, /a verificação confirmou que o número de peito foi alterado/);
  assert.match(modal, /verification === 'not-applied'/);
  assert.match(modal, /a alteração NÃO foi aplicada/);
  assert.match(modal, /verification === 'unknown'/);
  assert.match(modal, /Estado indefinido/);
  assert.match(modal, /verification === 'unreachable'/);
  assert.match(modal, /Não foi possível confirmar/);
  // confirmed → conclude only (no resend); unknown/unreachable → review/close only (no resend)
  assert.match(modal, /const concludeOnly = succeeded \|\| verification === 'confirmed';/);
  assert.match(modal, /const reviewOnly = verification === 'unknown' \|\| verification === 'unreachable';/);
});

// ---- §27 — refetch failure AFTER a confirmed commit is its own state -
test('§27: a refetch failure after BIB_UPDATED is a distinct message and never re-runs the mutation', () => {
  assert.match(parentSubmit, /\} catch \{\s*\n\s*\/\/[\s\S]*?setBibContext\(\(current\) => \(current \? \{ \.\.\.current, refreshFailed: true \} : current\)\)/);
  const catchBlock = parentSubmit.slice(parentSubmit.indexOf('} catch {'));
  const firstCatch = catchBlock.slice(0, catchBlock.indexOf('return;'));
  assert.doesNotMatch(firstCatch, /assignAdminBibNumber|bibMutation\.submit/, 'the post-commit refetch catch never resubmits');
  assert.match(modal, /context\?\.refreshFailed && \(/);
  assert.match(modal, /Número de peito salvo, mas não foi possível atualizar os dados exibidos\. Atualize antes de tentar novamente/);
});

// ---- §22 — 401 is an explicit described session expiry ---------------
test('§22: a 401 is a described session-expiry with its own button, not a silent logout', () => {
  assert.match(modal, /const sessionExpired = failed && Boolean\(state\.error\?\.sessionExpired\)/);
  assert.match(modal, /onClick=\{onSessionExpired\}/);
  assert.match(modal, /Entrar novamente/);
});

// ---- §19 — no auto-retry at the transport layer either --------------
test('§19: assignAdminBibNumber is retry:false and typed to the machine-outcome response', () => {
  assert.match(api, /export function assignAdminBibNumber\(/);
  const fn = slice(api, 'export function assignAdminBibNumber(', '\n}');
  assert.match(fn, /adminFetch<AdminBibNumberResponse>/);
  assert.match(fn, /retry: false/);
  assert.doesNotMatch(fn, /retry:\s*true/);
});

test('§17: AdminBibNumberResponse enumerates the machine outcomes; success decodes only the two 200 shapes', () => {
  assert.match(types, /export type AdminBibNumberOutcome =\s*\n\s*\| 'BIB_UPDATED'\s*\n\s*\| 'BIB_UNCHANGED'\s*\n\s*\| 'BIB_CONFLICT'\s*\n\s*\| 'NOT_ELIGIBLE'\s*\n\s*\| 'NOT_FOUND';/);
  assert.match(types, /outcome: Extract<AdminBibNumberOutcome, 'BIB_UPDATED' \| 'BIB_UNCHANGED'>;/);
});

// ---- §33 — Wave 1 profile-edit surface is not regressed -------------
test('§33: the athlete drawer still shows shirt size and still mounts RegistrationEditForm', () => {
  assert.match(drawer, /<Detail label="Tamanho da camisa" value=\{registration\.shirtSize \|\| 'Não informado'\} \/>/);
  assert.match(drawer, /<RegistrationEditForm/);
});
