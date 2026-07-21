import type { PartnerType } from '../types/partner';

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
  if (!target) throw new Error('A area de transferencia nao esta disponivel.');
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
  sports_advisory: 'Inscricao atraves da assessoria',
  influencer: 'Beneficio do influenciador',
};
