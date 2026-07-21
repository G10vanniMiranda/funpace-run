import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PartnerType } from './database.js';

export type PartnerSession = {
  partnerId: string;
  slug: string;
  partnerType?: PartnerType;
  issuedAt: number;
  expiresAt: number;
  correlationId?: string;
  accessAuditId?: string;
};

export function signPartnerSession(session: PartnerSession, secret: string) {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyPartnerSession(token: string | undefined, secret: string, now = Date.now()): PartnerSession | null {
  if (!token || !secret) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature); const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PartnerSession;
    const validType = session.partnerType === undefined || ['sports_advisory', 'influencer'].includes(session.partnerType);
    return session.partnerId && session.slug && Number.isFinite(session.issuedAt) && session.expiresAt > now && validType ? session : null;
  } catch {
    return null;
  }
}

export function readCookie(cookieHeader: string | undefined, name: string) {
  const entry = String(cookieHeader || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined;
}
