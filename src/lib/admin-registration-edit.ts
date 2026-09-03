// ADMIN-UX-RELIABILITY Stage 2 / Wave 1 — athlete profile edit.
//
// Pure, framework-free helpers for the "Editar dados cadastrais" flow. The
// backend persistence path (`updateRegistrationFieldsInPostgres`, HOTFIX-003/004)
// is UNCHANGED by this stage — it stays authoritative and re-diffs every
// submitted change against the canonical row. This module only decides, on the
// client, WHICH fields to send (dirty-only) and how to describe the result.

import type { AdminRegistration, AdminRegistrationEditable } from '../types/registration';

// The fields the Wave-1 form exposes for editing. `AdminRegistrationEditable`
// still contains all eleven — the server keeps accepting and validating them —
// but the form only renders and sends these.
export const EDITABLE_PROFILE_FIELDS = ['fullName', 'email', 'phone', 'gender', 'shirtSize'] as const;
export type EditableProfileField = (typeof EDITABLE_PROFILE_FIELDS)[number];

// Present in `AdminRegistrationEditable` / the DB / the API contract, but hidden
// from the editable form for now (product decision). Data, columns, validators
// and API acceptance are all retained; the form simply does not touch them.
export const HIDDEN_LEGACY_PROFILE_FIELDS = [
  'birthDate', 'city', 'state', 'team', 'emergencyContactName', 'emergencyContactPhone',
] as const;

export const PROFILE_EDIT_REASON_MIN_LENGTH = 5;

export type ProfileEditFormState = Pick<AdminRegistrationEditable, EditableProfileField>;

const PROFILE_FIELD_LABELS: Record<EditableProfileField, string> = {
  fullName: 'Nome',
  email: 'E-mail',
  phone: 'Telefone',
  gender: 'Sexo',
  shirtSize: 'Tamanho da camisa',
};

const GENDER_LABELS: Record<string, string> = { male: 'Masculino', female: 'Feminino' };

// Seed the form from the canonical registration — only the editable fields.
export function buildProfileEditFormState(registration: AdminRegistration): ProfileEditFormState {
  return {
    fullName: registration.fullName ?? '',
    email: registration.email ?? '',
    phone: registration.phone ?? '',
    gender: registration.gender,
    shirtSize: registration.shirtSize as ProfileEditFormState['shirtSize'],
  };
}

// Client-side normalisation, deliberately a SUBSET of the server's: trim text,
// lower-case the email. Everything else (whitespace collapse, length caps, UF
// upper-casing, per-field validation) stays on the server. This only prevents a
// spurious "dirty" flag from trailing whitespace.
function normalizeForCompare(field: EditableProfileField, value: string): string {
  const trimmed = String(value ?? '').trim();
  return field === 'email' ? trimmed.toLowerCase() : trimmed;
}

/**
 * Dirty-fields-only changeset: an entry per editable field whose normalised form
 * value differs from the canonical registration value. Hidden legacy fields are
 * never considered. Returns `{}` when nothing changed — the caller must then NOT
 * issue a PATCH.
 */
export function diffProfileChanges(
  registration: AdminRegistration,
  form: ProfileEditFormState,
): Partial<Pick<AdminRegistrationEditable, EditableProfileField>> {
  const changes: Partial<Pick<AdminRegistrationEditable, EditableProfileField>> = {};
  for (const field of EDITABLE_PROFILE_FIELDS) {
    const canonical = normalizeForCompare(field, String(registration[field] ?? ''));
    const next = normalizeForCompare(field, String(form[field] ?? ''));
    if (next === canonical) continue;
    // send the trimmed value; the server re-normalises and re-diffs authoritatively.
    (changes as Record<string, string>)[field] = field === 'email'
      ? String(form[field] ?? '').trim().toLowerCase()
      : String(form[field] ?? '').trim();
  }
  return changes;
}

export function hasProfileChanges(registration: AdminRegistration, form: ProfileEditFormState): boolean {
  return Object.keys(diffProfileChanges(registration, form)).length > 0;
}

export function isProfileEditReasonValid(reason: string): boolean {
  return String(reason ?? '').trim().length >= PROFILE_EDIT_REASON_MIN_LENGTH;
}

/** submit is allowed only with at least one dirty field AND a valid reason. */
export function canSubmitProfileEdit(
  registration: AdminRegistration,
  form: ProfileEditFormState,
  reason: string,
): boolean {
  return hasProfileChanges(registration, form) && isProfileEditReasonValid(reason);
}

function displayValue(field: EditableProfileField, raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (field === 'gender') return GENDER_LABELS[value] || value || '—';
  return value || '—';
}

/**
 * Operator-visible success text. For a single-field change (the common support
 * case, e.g. shirt GG → G) it names the field and both values; otherwise it
 * lists the changed fields.
 */
export function describeProfileEditSuccess(
  before: AdminRegistration,
  changes: Partial<Pick<AdminRegistrationEditable, EditableProfileField>>,
): string {
  const fields = Object.keys(changes) as EditableProfileField[];
  if (fields.length === 0) return 'Nenhuma alteração foi enviada.';
  if (fields.length === 1) {
    const field = fields[0];
    return `${PROFILE_FIELD_LABELS[field]} atualizado de ${displayValue(field, before[field])} para ${displayValue(field, changes[field])}.`;
  }
  const labels = fields.map((field) => PROFILE_FIELD_LABELS[field]).join(', ');
  return `Dados cadastrais atualizados: ${labels}.`;
}
