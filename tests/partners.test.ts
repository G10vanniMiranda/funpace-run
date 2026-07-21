import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePartnerSlug, validatePartnerInput } from '../server/partner-management.js';
import { buildPartnerLink, copyPartnerLink, partnerTypeBenefitLabels, partnerTypeLabels, slugifyPartnerName } from '../src/lib/partners.js';
import { calculatePartnerPricing } from '../server/partner-discount.js';
import { signPartnerSession, verifyPartnerSession } from '../server/partner-session.js';
import { getPartnerAuditEventTitle, getPartnerEntityLabel } from '../server/partner-audit-labels.js';

test('generates a URL-safe partner slug from the name', () => {
  assert.equal(normalizePartnerSlug('  Assessoria São João Running  '), 'assessoria-sao-joao-running');
  assert.equal(slugifyPartnerName('Runners Club'), 'runners-club');
});

test('validates and normalizes a valid partner payload', () => {
  const result = validatePartnerInput({
    name: '  Runners   Club ', slug: 'Runners Club', discountPercentage: 10,
    description: '  Assessoria de corrida  ', status: 'active',
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, {
    name: 'Runners Club', slug: 'runners-club', discountPercentage: 10,
    description: 'Assessoria de corrida', status: 'active', partnerType: 'sports_advisory',
  });
});

test('accepts both partner type API conventions and preserves legacy defaults', () => {
  const legacy = validatePartnerInput({ name: 'Legacy Partner', slug: 'legacy', discountPercentage: 10, status: 'active' });
  assert.equal(legacy.ok, true);
  if (legacy.ok) assert.equal(legacy.value.partnerType, 'sports_advisory');

  const camelCase = validatePartnerInput({ name: 'Influencer One', slug: 'influencer-one', discountPercentage: 10, status: 'active', partnerType: 'influencer' });
  assert.equal(camelCase.ok, true);
  if (camelCase.ok) assert.equal(camelCase.value.partnerType, 'influencer');

  const snakeCase = validatePartnerInput({ name: 'Influencer Two', slug: 'influencer-two', discountPercentage: 10, status: 'active', partner_type: 'influencer' });
  assert.equal(snakeCase.ok, true);
  if (snakeCase.ok) assert.equal(snakeCase.value.partnerType, 'influencer');

  const unsupported = validatePartnerInput({ name: 'Future Type', slug: 'future-type', discountPercentage: 10, status: 'active', partnerType: 'ambassador' });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.ok(unsupported.errors.partnerType);
});

test('rejects invalid partner discounts and statuses', () => {
  for (const discountPercentage of [-1, 0, 100, 101, Number.NaN]) {
    const result = validatePartnerInput({ name: 'Partner', slug: 'partner', discountPercentage, status: 'active' });
    assert.equal(result.ok, false);
    if (!result.ok && 'errors' in result) assert.ok(result.errors.discountPercentage);
  }
  const invalidStatus = validatePartnerInput({ name: 'Partner', slug: 'partner', discountPercentage: 10, status: 'deleted' });
  assert.equal(invalidStatus.ok, false);
});

test('calculates partner pricing from the original backend price', () => {
  const partner = { id: 'partner-1', name: 'Runners Club', discountPercentage: 10, status: 'active' as const, deletedAt: null };
  assert.deepEqual(calculatePartnerPricing(12_000, partner), {
    partnerId: 'partner-1', partnerName: 'Runners Club', discountPercentage: 10,
    discountAmountCents: 1_200, originalPriceCents: 12_000, finalPriceCents: 10_800,
  });
  assert.equal(calculatePartnerPricing(10_800, { ...partner, status: 'inactive' }), null);
  assert.equal(calculatePartnerPricing(10_800, { ...partner, discountPercentage: 0 }), null);
  assert.equal(calculatePartnerPricing(10_800, { ...partner, deletedAt: '2026-07-21T00:00:00.000Z' }), null);
  const influencer = { ...partner, partnerType: 'influencer' as const };
  const sportsAdvisory = { ...partner, partnerType: 'sports_advisory' as const };
  assert.deepEqual(calculatePartnerPricing(12_000, influencer), calculatePartnerPricing(12_000, sportsAdvisory));
});

test('signs partner sessions and rejects tampering or expiration', () => {
  const secret = 'partner-session-test-secret-at-least-32-characters';
  const session = { partnerId: 'partner-1', slug: 'runners-club', partnerType: 'influencer' as const, issuedAt: 1_000, expiresAt: 10_000, correlationId: 'correlation-1' };
  const token = signPartnerSession(session, secret);
  assert.deepEqual(verifyPartnerSession(token, secret, 5_000), session);
  assert.equal(verifyPartnerSession(`${token}tampered`, secret, 5_000), null);
  assert.equal(verifyPartnerSession(token, secret, 10_001), null);
  const legacy = { partnerId: 'legacy-partner', slug: 'legacy', issuedAt: 1_000, expiresAt: 10_000 };
  assert.deepEqual(verifyPartnerSession(signPartnerSession(legacy, secret), secret, 5_000), legacy);
  const invalidType = { ...legacy, partnerType: 'ambassador' as never };
  assert.equal(verifyPartnerSession(signPartnerSession(invalidType, secret), secret, 5_000), null);
});

test('centralizes contextual labels for both supported partner types', () => {
  assert.equal(partnerTypeLabels.sports_advisory, 'Assessoria esportiva');
  assert.equal(partnerTypeLabels.influencer, 'Influenciador');
  assert.equal(partnerTypeBenefitLabels.sports_advisory, 'Inscricao atraves da assessoria');
  assert.equal(partnerTypeBenefitLabels.influencer, 'Beneficio do influenciador');
});

test('labels payment audit events with the persisted attribution type', () => {
  assert.equal(getPartnerEntityLabel('influencer'), 'influenciador');
  assert.equal(getPartnerEntityLabel('sports_advisory'), 'assessoria');
  assert.equal(getPartnerAuditEventTitle('partner.link_accessed', 'influencer'), 'Link do influenciador acessado');
  assert.equal(getPartnerAuditEventTitle('consistency.issue_detected', 'sports_advisory'), 'Inconsistencia de assessoria detectada');
});

test('builds and copies the exclusive partner link', async () => {
  const calls: string[] = [];
  const link = buildPartnerLink('https://funpace.club/', 'runners-club');
  await copyPartnerLink(link, { writeText: async (value) => { calls.push(value); } });
  assert.equal(link, 'https://funpace.club/p/runners-club');
  assert.deepEqual(calls, [link]);
});
