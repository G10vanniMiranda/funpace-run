import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_BOUND_REGISTRATIONS = 8;
const REGISTRATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNING_CONTEXT = 'funpace-meta-consent-v1:';

export type MetaConsentSession = {
  registrationIds: string[];
  issuedAt: number;
  expiresAt: number;
};

export function parseMarketingConsentDecision(value: unknown): boolean | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.marketing !== 'boolean') return null;
  return record.marketing;
}

export function bindMetaConsentRegistration(
  session: MetaConsentSession | null,
  registrationId: string,
  now: number,
  ttlSeconds: number,
): MetaConsentSession | null {
  const normalizedId = registrationId.trim().toLowerCase();
  if (!REGISTRATION_ID_PATTERN.test(normalizedId)) return null;
  const existingIds = session?.expiresAt && session.expiresAt > now
    ? session.registrationIds.filter((id) => id !== normalizedId)
    : [];
  return {
    registrationIds: [...existingIds, normalizedId].slice(-MAX_BOUND_REGISTRATIONS),
    issuedAt: now,
    expiresAt: now + ttlSeconds * 1000,
  };
}

export function signMetaConsentSession(session: MetaConsentSession, secret: string) {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${SIGNING_CONTEXT}${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyMetaConsentSession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): MetaConsentSession | null {
  if (!token || secret.length < 32) return null;
  const tokenParts = token.split('.');
  if (tokenParts.length !== 2) return null;
  const [payload, signature] = tokenParts;
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', secret).update(`${SIGNING_CONTEXT}${payload}`).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as MetaConsentSession;
    const idsAreValid = Array.isArray(session.registrationIds)
      && session.registrationIds.length > 0
      && session.registrationIds.length <= MAX_BOUND_REGISTRATIONS
      && new Set(session.registrationIds).size === session.registrationIds.length
      && session.registrationIds.every((id) => REGISTRATION_ID_PATTERN.test(id));
    const timesAreValid = Number.isFinite(session.issuedAt)
      && Number.isFinite(session.expiresAt)
      && session.issuedAt <= now + 5 * 60_000
      && session.expiresAt > now;
    return idsAreValid && timesAreValid ? session : null;
  } catch {
    return null;
  }
}
