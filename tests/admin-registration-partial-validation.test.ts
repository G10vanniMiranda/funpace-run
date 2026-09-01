import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-UX-HOTFIX-004 — PATCH /api/admin/registrations/:id must apply PATCH, not
// PUT, semantics: an unrelated pre-existing legacy value (e.g. a blank UF) must
// NOT block an administrator from changing an independent, valid field.
//
// Production evidence: PATCH .../a47a4dc8-… ?event=funpace-run-2026 reached the
// app, ran the narrow mutation in 3.52s, and returned 400 {"message":"UF
// invalida."} — the operator only intended to fix `email`. Root cause:
//   toAdminRow maps a stored `state = ""` (or missing) to `state: null`
//   -> the Admin form submits the WHOLE editable profile, so `changes.state = null`
//   -> the backend loop only skipped `=== undefined`, so `null` fell through
//   -> `String(null).toUpperCase()` === "NULL"
//   -> the holistic validator: `"NULL"` is truthy and fails /^[A-Z]{2}$/ -> 400.
// 557 / 566 Production registrations have `state = ""` or missing, so *every*
// Admin registration edit was failing this way (registration.updated had never
// been written in Production).
//
// Fix: (1) skip `null` (and `undefined`) incoming values; (2) validate ONLY the
// fields the operator actually changes, against the merged payload. Repo
// convention: static source guards here; real-PostgreSQL behaviour is proven in
// homolog separately.

const serverIndex = readFileSync('server/index.ts', 'utf8');
const serverDatabase = readFileSync('server/database.ts', 'utf8');

function registrationHandler(): string {
  const start = serverIndex.indexOf('async function handleAdminRegistrationUpdate(');
  const end = serverIndex.indexOf('\nasync function handleAdminRegistrationDetails(');
  assert.ok(start >= 0 && end > start, 'handleAdminRegistrationUpdate located');
  return serverIndex.slice(start, end);
}
function directMutation(): string {
  const start = serverDatabase.indexOf('export async function updateRegistrationFieldsInPostgres(');
  const end = serverDatabase.indexOf('export async function pingDatabase()');
  assert.ok(start >= 0 && end > start, 'updateRegistrationFieldsInPostgres located');
  return serverDatabase.slice(start, end);
}
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('incoming null / undefined field values are skipped — never stringified to "NULL"', () => {
  const handler = code(registrationHandler());
  assert.match(
    handler,
    /for \(const field of allowedFields\) \{\s*if \(changes\[field\] === undefined \|\| changes\[field\] === null\) continue;/,
    'the normalisation loop skips both undefined AND null before any String(value) coercion',
  );
  // the null check must precede the String(value).toUpperCase() / .toLowerCase() coercions
  const skipAt = handler.indexOf('=== null) continue;');
  const upperAt = handler.indexOf("String(value).toUpperCase()");
  const lowerAt = handler.indexOf("String(value).toLowerCase()");
  assert.ok(skipAt >= 0 && upperAt > skipAt && lowerAt > skipAt, 'null is skipped before any String() coercion');
});

test('validation is per-changed-field (PATCH), not holistic on the merged payload (PUT)', () => {
  const handler = code(registrationHandler());
  const fn = code(directMutation());

  assert.doesNotMatch(handler, /validateMergedPayload/, 'holistic merged-payload validator removed from the handler');
  assert.doesNotMatch(fn, /validateMergedPayload/, 'holistic merged-payload validator removed from the narrow mutation');
  assert.match(handler, /validateChangedField\s*=\s*\(/, 'handler defines a per-field validator');
  assert.match(handler, /switch \(field\) \{/, 'per-field validator switches on the field name');

  // the narrow mutation runs the validator ONCE PER changed field, over `after`
  assert.match(
    fn,
    /for \(const field of Object\.keys\(after\)\) \{\s*const validationError = input\.validateChangedField\(field, merged as unknown as RegistrationFormData\);/,
    'validation loop iterates the actually-changed fields only',
  );
  // and it happens after the no-op short-circuit, before the UPDATE
  const noopAt = fn.indexOf('if (!Object.keys(after).length)');
  const loopAt = fn.indexOf('for (const field of Object.keys(after))');
  const updateAt = fn.search(/update \$\{table\.registrations\} set /);
  assert.ok(noopAt >= 0 && loopAt > noopAt && updateAt > loopAt, 'order: no-op check -> per-field validation -> UPDATE');
});

test('every original validation rule and message is preserved, one per field', () => {
  const handler = registrationHandler();
  // fullName / email
  assert.match(handler, /case 'fullName':[\s\S]*?String\(payload\.fullName\)\.trim\(\)[\s\S]*?'Nome e email valido sao obrigatorios\.'/);
  assert.match(handler, /case 'email':[\s\S]*?\/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$\/\.test\(payload\.email\)[\s\S]*?'Nome e email valido sao obrigatorios\.'/);
  // gender / shirtSize
  assert.match(handler, /case 'gender':[\s\S]*?\['female', 'male'\]\.includes\(payload\.gender\)[\s\S]*?'Sexo ou tamanho de camisa invalido\.'/);
  assert.match(handler, /case 'shirtSize':[\s\S]*?\['P', 'M', 'G', 'GG'\]\.includes\(payload\.shirtSize\)[\s\S]*?'Sexo ou tamanho de camisa invalido\.'/);
  // phone / emergencyContactPhone
  assert.match(handler, /case 'phone':[\s\S]*?onlyDigits\(payload\.phone\)\.length >= 10[\s\S]*?'Telefones devem conter DDD e numero validos\.'/);
  assert.match(handler, /case 'emergencyContactPhone':[\s\S]*?digits\.length === 0 \|\| digits\.length >= 10[\s\S]*?'Telefones devem conter DDD e numero validos\.'/);
  // state — only enforced when a value is present (blank/legacy UF is allowed to stay)
  assert.match(handler, /case 'state':[\s\S]*?!payload\.state \|\| \/\^\[A-Z\]\{2\}\$\/\.test\(payload\.state\)[\s\S]*?'UF invalida\.'/);
  // birthDate — only enforced when a value is present
  assert.match(handler, /case 'birthDate':[\s\S]*?if \(!payload\.birthDate\) return null;[\s\S]*?'Data de nascimento invalida\.'/);
  // city / team / emergencyContactName have no format rule
  assert.match(handler, /default:\s*\n\s*return null;/);
});

test('no financial / identity recalculation and no email side-effect in the changed path', () => {
  const handler = code(registrationHandler());
  const fn = code(directMutation());
  for (const forbidden of ['final_price', 'original_price', 'discount_percentage', 'discount_amount', 'amount_cents', 'coupon_code', 'lot_id', 'partner_id', 'cpf_hash', 'confirmation_email']) {
    assert.doesNotMatch(fn, new RegExp(forbidden), `narrow mutation must not touch ${forbidden}`);
  }
  for (const forbidden of [/processRegistrationEmail/, /sendRegistrationConfirmationEmail/, /enqueueConfirmationEmailObligation/]) {
    assert.doesNotMatch(handler, forbidden, 'handler triggers no email send');
    assert.doesNotMatch(fn, forbidden, 'narrow mutation triggers no email send');
  }
  // the UPDATE still writes only payload + updated_at
  assert.match(directMutation(), /update \$\{table\.registrations\} set payload = \$2::jsonb, updated_at = \$3 where id = \$1/);
});

test('no-op and 404 contracts unchanged', () => {
  const fn = directMutation();
  assert.match(fn, /return \{ statusCode: 404, payload: \{ message: 'Inscricao nao encontrada\.' \}, changed: false \}/);
  assert.match(fn, /if \(!Object\.keys\(after\)\.length\) \{\s*await client\.query\('rollback'\);\s*return \{ statusCode: 400, payload: \{ message: 'Nenhuma alteracao foi informada\.' \}/);
  assert.match(fn, /if \(value === currentPayload\[field\]\) continue;/, 'a resubmitted unchanged value is still not a change');
});

test('shared-email policy intact: no email-uniqueness check anywhere', () => {
  const handler = code(registrationHandler());
  const fn = code(directMutation());
  assert.doesNotMatch(handler + fn, /unique.*email|email.*already|e-mail j[aá] (est|cadastr)|duplicate.*email/i);
});
