export type CouponPricing = {
  code: string;
  discountPercentage: number;
  discountAmountCents: number;
  originalPriceCents: number;
  finalPriceCents: number;
};

type CouponDefinition = {
  discountBasisPoints: number;
  campaign: string;
  source: string;
};

const coupons: Readonly<Record<string, CouponDefinition>> = Object.freeze({
  VOLTA10: {
    discountBasisPoints: 1_000,
    campaign: 'whatsapp_remarketing_volta10',
    source: 'whatsapp',
  },
});

export function normalizeCouponCode(input: unknown) {
  return typeof input === 'string' ? input.trim().toUpperCase().slice(0, 40) : '';
}

export function calculateCouponPricing(originalPriceCents: number, inputCode: unknown): CouponPricing | null {
  if (!Number.isSafeInteger(originalPriceCents) || originalPriceCents <= 0) return null;
  const code = normalizeCouponCode(inputCode);
  const coupon = coupons[code];
  if (!coupon) return null;

  const discountAmountCents = Math.floor(
    ((originalPriceCents * coupon.discountBasisPoints) + 5_000) / 10_000,
  );
  const finalPriceCents = originalPriceCents - discountAmountCents;
  if (discountAmountCents <= 0 || finalPriceCents <= 0) return null;

  return {
    code,
    discountPercentage: coupon.discountBasisPoints / 100,
    discountAmountCents,
    originalPriceCents,
    finalPriceCents,
  };
}

export function getCouponCampaignAttribution(inputCode: unknown) {
  const code = normalizeCouponCode(inputCode);
  const coupon = coupons[code];
  return coupon ? { campaign: coupon.campaign, source: coupon.source } : null;
}
