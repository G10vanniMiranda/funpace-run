export type DiscountEligiblePartner = {
  id: string;
  name: string;
  discountPercentage: number;
  status: 'active' | 'inactive';
  deletedAt?: string | null;
};

export type PartnerPricing = {
  partnerId: string;
  partnerName: string;
  discountPercentage: number;
  discountAmountCents: number;
  originalPriceCents: number;
  finalPriceCents: number;
};

export function calculatePartnerPricing(originalPriceCents: number, partner?: DiscountEligiblePartner | null): PartnerPricing | null {
  if (!Number.isInteger(originalPriceCents) || originalPriceCents <= 0 || !partner) return null;
  const percentage = Number(partner.discountPercentage);
  if (partner.status !== 'active' || partner.deletedAt || !Number.isFinite(percentage) || percentage <= 0 || percentage >= 100) return null;
  const discountAmountCents = Math.round((originalPriceCents * percentage) / 100);
  const finalPriceCents = originalPriceCents - discountAmountCents;
  if (discountAmountCents <= 0 || finalPriceCents <= 0) return null;
  return {
    partnerId: partner.id,
    partnerName: partner.name,
    discountPercentage: percentage,
    discountAmountCents,
    originalPriceCents,
    finalPriceCents,
  };
}
