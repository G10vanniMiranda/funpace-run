import type { PartnerType } from '../types/partner';

export const partnerActivationQueryParam = 'partner';
export const partnerActivationQueryValue = 'active';

export function buildPartnerRegistrationUrl() {
  return `/?${partnerActivationQueryParam}=${partnerActivationQueryValue}#register`;
}

export function hasPartnerActivationMarker(search: string) {
  return new URLSearchParams(search).get(partnerActivationQueryParam) === partnerActivationQueryValue;
}

export function slugifyPartnerName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function buildPartnerLink(origin: string, slug: string) {
  return `${origin.replace(/\/$/, '')}/p/${encodeURIComponent(slug)}`;
}

export async function copyPartnerLink(link: string, clipboard?: Pick<Clipboard, 'writeText'>) {
  const target = clipboard ?? globalThis.navigator?.clipboard;
  if (!target) throw new Error('A área de transferência não está disponível.');
  await target.writeText(link);
}
export const partnerTypeOptions: ReadonlyArray<{ value: PartnerType; label: string }> = [
  { value: 'sports_advisory', label: 'Assessoria esportiva' },
  { value: 'influencer', label: 'Influenciador' },
];

export const partnerTypeLabels: Record<PartnerType, string> = {
  sports_advisory: 'Assessoria esportiva',
  influencer: 'Influenciador',
};

export const partnerTypeBenefitLabels: Record<PartnerType, string> = {
  sports_advisory: 'Inscrição através da assessoria',
  influencer: 'Benefício do influenciador',
};
