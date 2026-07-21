export type PartnerManagementStatus = 'active' | 'inactive';

export type PartnerManagementInput = {
  name: string;
  slug: string;
  discountPercentage: number;
  description: string | null;
  status: PartnerManagementStatus;
};

export type PartnerValidationResult =
  | { ok: true; value: PartnerManagementInput }
  | { ok: false; errors: Record<string, string> };

export function normalizePartnerSlug(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function validatePartnerInput(input: Record<string, unknown> | null): PartnerValidationResult {
  const name = String(input?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const slug = normalizePartnerSlug(input?.slug);
  const discountPercentage = Number(input?.discountPercentage);
  const descriptionValue = String(input?.description ?? '').trim().slice(0, 1000);
  const description = descriptionValue || null;
  const status = String(input?.status ?? 'active') as PartnerManagementStatus;
  const errors: Record<string, string> = {};

  if (name.length < 2) errors.name = 'Informe o nome da assessoria.';
  if (slug.length < 2) errors.slug = 'Informe um slug com pelo menos 2 caracteres.';
  if (!Number.isFinite(discountPercentage) || discountPercentage <= 0 || discountPercentage >= 100) {
    errors.discountPercentage = 'O desconto deve ser maior que 0 e menor que 100.';
  }
  if (!['active', 'inactive'].includes(status)) errors.status = 'Status invalido.';

  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, value: { name, slug, discountPercentage, description, status } };
}
