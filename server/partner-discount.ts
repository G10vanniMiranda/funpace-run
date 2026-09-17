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

/**
 * Eligibility only (active, not deleted, valid percentage) — independent of any
 * price, so a caller can check "is this partner still eligible" before it knows
 * the lot price a discount would apply to.
 */
export function isPartnerRowEligibleForDiscount(partner?: Pick<DiscountEligiblePartner, 'status' | 'deletedAt' | 'discountPercentage'> | null): boolean {
  if (!partner) return false;
  const percentage = Number(partner.discountPercentage);
  return partner.status === 'active' && !partner.deletedAt && Number.isFinite(percentage) && percentage > 0 && percentage < 100;
}

export function calculatePartnerPricing(originalPriceCents: number, partner?: DiscountEligiblePartner | null): PartnerPricing | null {
  if (!Number.isInteger(originalPriceCents) || originalPriceCents <= 0 || !partner) return null;
  if (!isPartnerRowEligibleForDiscount(partner)) return null;
  const percentage = Number(partner.discountPercentage);
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
