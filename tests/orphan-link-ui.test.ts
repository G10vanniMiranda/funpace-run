import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-RELIABILITY Wave 3C — orphan-link Admin UX gap-closure: migrates
// the original ad-hoc plain try/catch action (identified as FAIL/PARTIAL
// against the established reliability contract in the Stage 1 forensic) onto
// the same useAdminMutation contract already proven for bib/check-in/kit/
// event-distance-config: explicit submitting/success/failure, retry:false,
// ambiguous-commit READ-ONLY verification (never an automatic resend), and a
// distinct committed-but-refresh-failed state.

const adminTsx = readFileSync('src/pages/Admin.tsx', 'utf8');
const apiTs = readFileSync('src/lib/api.ts', 'utf8');

function paymentControlPanel(): string {
  const start = adminTsx.indexOf('function PaymentControlPanel(');
  const end = adminTsx.indexOf('\nfunction OrphanLinkModal(');
  assert.ok(start >= 0 && end > start, 'PaymentControlPanel located');
  return adminTsx.slice(start, end);
}

function orphanLinkModal(): string {
  const start = adminTsx.indexOf('function OrphanLinkModal(');
  const end = adminTsx.indexOf('\nfunction OperationControlPanel(');
  assert.ok(start >= 0 && end > start, 'OrphanLinkModal located');
  return adminTsx.slice(start, end);
}

test('regression: no longer a plain try/catch with a transient banner as the sole feedback', () => {
  const body = paymentControlPanel();
  assert.doesNotMatch(body, /catch \(error\) \{ setActionError\(error instanceof ApiError \? error\.message : 'Não foi possível vincular o evento\.'\); \}/, 'the old ad-hoc catch-and-banner pattern is removed');
  assert.doesNotMatch(body, /<ActionModal[\s\S]{0,120}title="Vincular evento/, 'no longer uses the generic ActionModal for orphan-link');
});

test('the link runs on the reusable mutation state machine (one confirm -> one PATCH)', () => {
  const body = paymentControlPanel();
  assert.match(body, /const orphanMutation = useAdminMutation<AdminOrphanLinkResponse>\(\);/);
  assert.match(body, /orphanMutation\.submit\(async \(\) => \{/);
  assert.match(body, /return await linkAdminOrphanPayment\(adminKey, draft\.event\.id, draft\.registrationId, draft\.reason\);/);
  assert.equal((body.match(/await linkAdminOrphanPayment\(/g) || []).length, 1, 'issues exactly one linkAdminOrphanPayment call per submit');
  // invalid draft throws (surfaced as FAILURE), never a silent no-op
  assert.match(body, /throw new ApiError\('Informe a inscrição e um motivo com pelo menos 5 caracteres\.', \{ code: 'validation', businessCode: 'ORPHAN_LINK_INVALID' \}\)/);
});

test('durable feedback: the modal renders submitting / success / failure and cannot silently vanish', () => {
  const body = paymentControlPanel();
  assert.match(body, /<OrphanLinkModal/);
  assert.match(body, /state=\{orphanMutation\.state\}/);
  assert.match(body, /context=\{orphanContext\}/);
  assert.match(body, /onSubmit=\{submitOrphanLink\}/);
  assert.match(body, /onAcknowledge=\{acknowledgeOrphanLink\}/);

  const modal = orphanLinkModal();
  assert.match(modal, /const submitting = state\.phase === 'submitting';/);
  assert.match(modal, /const succeeded = state\.phase === 'success';/);
  assert.match(modal, /const failed = state\.phase === 'failure';/);
  assert.match(modal, /Vinculando…/);
  assert.match(modal, /role="status"/);
  assert.match(modal, /role="alert"/);
  assert.match(modal, /disabled=\{submitting \|\| !reasonValid \|\| !registrationIdValid\}/);
  assert.match(modal, /onClick=\{submitting \? undefined : onClose\}/);
});

test('no automatic retry: linkAdminOrphanPayment passes retry:false', () => {
  assert.match(apiTs, /export function linkAdminOrphanPayment\(adminKey: string, eventId: string, registrationId: string, reason: string\) \{\s*\n\s*return adminFetch<AdminOrphanLinkResponse>\([\s\S]{0,220}retry: false/);
});

test('the *_ALREADY_LINKED_HERE outcome is distinguished from a real link in the success message (informational, not an error)', () => {
  const modal = orphanLinkModal();
  assert.match(modal, /const alreadyLinkedHere = state\.result\?\.outcome === 'ORPHAN_ALREADY_LINKED_HERE';/);
  assert.match(modal, /\$\{alreadyLinkedHere \? 'border-white\/15 bg-white\/5 text-zinc-200' : 'border-emerald-400\/30 bg-emerald-400\/10 text-emerald-100'\}/);
  assert.match(modal, /Este evento já estava vinculado a esta inscrição\./);
  // explicit copy that this action never confirms a payment — matches the
  // Stage 1 domain decision (evidence association, not confirmation)
  assert.match(modal, /confirma o pagamento/);
});

test('committed-but-refresh-failed is a distinct, durable state — never a mutation failure, never triggers a resubmit', () => {
  const body = paymentControlPanel();
  assert.match(
    body,
    /if \(ok\) \{\s*try \{\s*await refreshOrphanEvents\(\);\s*\} catch \{[\s\S]*?setOrphanContext\(\(current\) => \(current \? \{ \.\.\.current, refreshFailed: true \} : current\)\);/,
    'a post-success refetch failure sets refreshFailed, distinct from mutation failure',
  );

  const modal = orphanLinkModal();
  assert.match(modal, /context\?\.refreshFailed && \(/);
  assert.match(modal, /Vínculo salvo, mas não foi possível atualizar os dados exibidos\. Atualize antes de tentar novamente — não reenvie\./);
});

test('ambiguous (timeout/network) failure runs a READ-ONLY verification and never auto-resends', () => {
  const body = paymentControlPanel();
  assert.match(
    body,
    /const ambiguous = caught instanceof TypeError\s*\n\s*\|\| \(caught instanceof ApiError && \(caught\.code === 'timeout' \|\| caught\.code === 'network_error'\)\);/,
    'ambiguity is classified from the raw caught error (network/timeout only)',
  );
  assert.match(body, /const targetDetails = await getAdminPaymentDetails\(adminKey, draft\.registrationId\);/, 'verification is a read, not a write');
  const verificationBranch = body.slice(body.indexOf('if (!ambiguous) return;'), body.indexOf('} catch {\n        setOrphanContext((current) => (current ? { ...current, verification: \'unreachable\''));
  assert.doesNotMatch(verificationBranch, /linkAdminOrphanPayment\(adminKey, draft\.event\.id/, 'the verification branch never re-issues the mutation call');
});

test('the modal renders all four verification outcomes distinctly (confirmed / not-applied / conflict / unknown / unreachable) and never offers a plain resend once verification is conclusive', () => {
  const modal = orphanLinkModal();
  assert.match(modal, /verification === 'confirmed' && \(/);
  assert.match(modal, /A conexão falhou, mas a verificação confirmou que o evento foi vinculado a esta inscrição\. Não reenvie\./);
  assert.match(modal, /verification === 'not-applied' && \(/);
  assert.match(modal, /verification === 'conflict' && \(/);
  assert.match(modal, /verification === 'unknown' && \(/);
  assert.match(modal, /verification === 'unreachable' && \(/);
  assert.match(
    modal,
    /const showForm = !succeeded && !sessionExpired\s*\n\s*&& verification !== 'confirmed' && verification !== 'conflict' && verification !== 'unknown' && verification !== 'unreachable';/,
  );
  assert.match(modal, /const concludeOnly = succeeded \|\| verification === 'confirmed';/);
  assert.match(modal, /const reviewOnly = verification === 'conflict' \|\| verification === 'unknown' \|\| verification === 'unreachable';/);
});

test('double-submit is prevented (inherited from useAdminMutation) and the modal cannot be dismissed mid-flight', () => {
  const modal = orphanLinkModal();
  assert.match(modal, /const submitting = state\.phase === 'submitting';/);
  assert.match(modal, /disabled=\{submitting \|\| !reasonValid \|\| !registrationIdValid\}/);
  assert.match(modal, /onClick=\{submitting \? undefined : onClose\}/);
});

test('explicit confirmation is required before submit: both registrationId and reason (>=5 chars) must be present', () => {
  const modal = orphanLinkModal();
  assert.match(modal, /const reasonValid = draft\.reason\.trim\(\)\.length >= 5;/);
  assert.match(modal, /const registrationIdValid = draft\.registrationId\.trim\(\)\.length > 0;/);
});
