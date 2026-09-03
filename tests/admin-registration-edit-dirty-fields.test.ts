import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EDITABLE_PROFILE_FIELDS,
  HIDDEN_LEGACY_PROFILE_FIELDS,
  PROFILE_EDIT_REASON_MIN_LENGTH,
  buildProfileEditFormState,
  canSubmitProfileEdit,
  describeProfileEditSuccess,
  diffProfileChanges,
  hasProfileChanges,
  isProfileEditReasonValid,
  type ProfileEditFormState,
} from '../src/lib/admin-registration-edit';
import type { AdminRegistration } from '../src/types/registration';

// ADMIN-UX-RELIABILITY Stage 2 / Wave 1 — dirty-fields-only client changeset.
// No participant PII: a synthetic athlete. The backend
// (updateRegistrationFieldsInPostgres, HOTFIX-003/004) is unchanged and stays
// authoritative — these tests only pin what the CLIENT sends.

const REG = {
  id: '11111111-2222-3333-4444-555555555555',
  fullName: 'Atleta Teste',
  email: 'atleta.teste@synthetic.example',
  phone: '(69) 90000-0000',
  gender: 'male',
  shirtSize: 'GG',
  // hidden legacy fields — present on the row, never touched by the Wave-1 form
  birthDate: '',
  city: '',
  state: '',
  team: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  distance: '10K',
  lot: 'Lote 2',
  bibNumber: '0151',
  status: 'paid',
  updatedAt: '2026-08-30T14:33:49.348Z',
} as unknown as AdminRegistration;

const seed = () => buildProfileEditFormState(REG);

test('buildProfileEditFormState seeds ONLY the five editable fields', () => {
  const form = seed();
  assert.deepEqual(Object.keys(form).sort(), [...EDITABLE_PROFILE_FIELDS].sort());
  assert.equal(form.shirtSize, 'GG');
  assert.equal(form.email, 'atleta.teste@synthetic.example');
});

// ---- A — shirt GG -> G sends only shirtSize -------------------------------
test('A: shirtSize GG -> G => changes = { shirtSize: "G" } only', () => {
  const form: ProfileEditFormState = { ...seed(), shirtSize: 'G' };
  assert.deepEqual(diffProfileChanges(REG, form), { shirtSize: 'G' });
});

// ---- B — email-only correction ------------------------------------------
test('B: email change only => changes = { email } only (trimmed + lower-cased)', () => {
  const form: ProfileEditFormState = { ...seed(), email: '  NEW.Addr@Synthetic.Example ' };
  assert.deepEqual(diffProfileChanges(REG, form), { email: 'new.addr@synthetic.example' });
});

// ---- C — phone-only correction ---------------------------------------
test('C: phone change only => changes = { phone } only', () => {
  const form: ProfileEditFormState = { ...seed(), phone: '(69) 98888-7777' };
  assert.deepEqual(diffProfileChanges(REG, form), { phone: '(69) 98888-7777' });
});

// ---- D — multiple changed allowed fields ---------------------------
test('D: multiple changed fields => changes contains exactly those', () => {
  const form: ProfileEditFormState = { ...seed(), fullName: 'Atleta Renomeado', shirtSize: 'M' };
  assert.deepEqual(diffProfileChanges(REG, form), { fullName: 'Atleta Renomeado', shirtSize: 'M' });
});

// ---- E — unchanged fields absent -----------------------------------
test('E: unchanged fields never appear in the changeset', () => {
  const form: ProfileEditFormState = { ...seed(), shirtSize: 'G' };
  const changes = diffProfileChanges(REG, form);
  assert.equal('fullName' in changes, false);
  assert.equal('email' in changes, false);
  assert.equal('phone' in changes, false);
  assert.equal('gender' in changes, false);
});

test('E2: trailing whitespace equal to canonical is NOT dirty', () => {
  const form: ProfileEditFormState = { ...seed(), fullName: '  Atleta Teste  ', email: 'atleta.teste@synthetic.example ' };
  assert.deepEqual(diffProfileChanges(REG, form), {});
  assert.equal(hasProfileChanges(REG, form), false);
});

// ---- F — hidden legacy fields can never be sent ------------------
test('F: hidden legacy fields are never in the changeset even if injected', () => {
  const injected = { ...seed(), birthDate: '1990-01-01', city: 'Porto Velho', state: 'RO', team: 'X', emergencyContactName: 'Y', emergencyContactPhone: '(69) 91111-2222' } as unknown as ProfileEditFormState;
  const changes = diffProfileChanges(REG, injected);
  for (const hidden of HIDDEN_LEGACY_PROFILE_FIELDS) {
    assert.equal(hidden in changes, false, `${hidden} must never be sent`);
  }
  assert.deepEqual(changes, {});
});

// ---- G — no changes => no PATCH ---------------------------------
test('G: an untouched form yields {} and hasProfileChanges === false', () => {
  assert.deepEqual(diffProfileChanges(REG, seed()), {});
  assert.equal(hasProfileChanges(REG, seed()), false);
  assert.equal(canSubmitProfileEdit(REG, seed(), 'motivo suficiente'), false);
});

// ---- gating: dirty AND reason ---------------------------------
test('canSubmitProfileEdit requires BOTH a dirty field AND a valid reason', () => {
  const dirty: ProfileEditFormState = { ...seed(), shirtSize: 'G' };
  assert.equal(canSubmitProfileEdit(REG, dirty, ''), false);
  assert.equal(canSubmitProfileEdit(REG, dirty, 'abc'), false); // < min length
  assert.equal(canSubmitProfileEdit(REG, dirty, 'motivo ok'), true);
  assert.equal(isProfileEditReasonValid('a'.repeat(PROFILE_EDIT_REASON_MIN_LENGTH)), true);
  assert.equal(isProfileEditReasonValid(' a b '), false);
});

// ---- success copy -------------------------------------------
test('describeProfileEditSuccess: single field names both values', () => {
  assert.equal(
    describeProfileEditSuccess(REG, { shirtSize: 'G' }),
    'Tamanho da camisa atualizado de GG para G.',
  );
  assert.equal(
    describeProfileEditSuccess(REG, { gender: 'female' }),
    'Sexo atualizado de Masculino para Feminino.',
  );
});

test('describeProfileEditSuccess: multiple fields are listed', () => {
  assert.equal(
    describeProfileEditSuccess(REG, { fullName: 'Novo Nome', shirtSize: 'G' }),
    'Dados cadastrais atualizados: Nome, Tamanho da camisa.',
  );
});

// ---- §25 — Case C regression fixture (synthetic, no Diego PII) --
test('25: Case-C-equivalent — GG->G with a valid reason produces exactly one shirtSize change', () => {
  const before = { ...REG, shirtSize: 'GG' } as AdminRegistration;
  const form: ProfileEditFormState = { ...buildProfileEditFormState(before), shirtSize: 'G' };
  const reason = 'correção de tamanho de camisa solicitada pelo participante';

  assert.equal(canSubmitProfileEdit(before, form, reason), true);
  const changes = diffProfileChanges(before, form);
  assert.deepEqual(changes, { shirtSize: 'G' });
  assert.equal(Object.keys(changes).length, 1);
  assert.equal(describeProfileEditSuccess(before, changes), 'Tamanho da camisa atualizado de GG para G.');
});
