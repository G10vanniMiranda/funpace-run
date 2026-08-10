import { createHash } from 'node:crypto';
import type { AuditLogRecord, Database, PaymentRecord, RegistrationRecord } from './database.js';

export const REMARKETING_STATUSES = [
  'PAGAMENTO_CONFIRMADO',
  'PAGAMENTO_EXPIROU',
  'PAGAMENTO_FALHOU',
  'ABANDONOU_CHECKOUT',
  'PAGAMENTO_PENDENTE',
] as const;

export type RemarketingStatus = typeof REMARKETING_STATUSES[number];
export type RemarketingSuppressionReason = '' | 'PAID' | 'TEST' | 'ADMIN_CANCELLED';

export type RemarketingProjection = {
  personKey: string;
  registrationIdReference: string;
  fullName: string;
  whatsapp: string;
  email: string;
  cpfMasked: string;
  firstRegistrationAt: string;
  lastRegistrationAt: string;
  lastPaymentAttemptAt: string;
  amountCents: number;
  lot: string;
  distance: string;
  registrationStatus: string;
  paymentStatus: string;
  attemptCount: number;
  checkoutCount: number;
  partnerOrOrigin: string;
  remarketingStatus: RemarketingStatus;
  eligible: boolean;
  suppressionReason: RemarketingSuppressionReason;
  lastPaymentCheckAt: string;
  updatedAt: string;
  registrationIds: string[];
};

export function normalizeRemarketingEmail(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeRemarketingPhone(value: string | null | undefined) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function createRemarketingPersonKey(anchorRegistrationId: string) {
  const digest = createHash('sha256')
    .update(`funpace:remarketing:person:v1:${anchorRegistrationId}`)
    .digest('hex');
  return `rmk_${digest.slice(0, 40)}`;
}

function maskCpf(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 ? `${digits.slice(0, 3)}.***.***-${digits.slice(9)}` : '***.***.***-**';
}

function hasPaidEvidence(registration: RegistrationRecord, payments: PaymentRecord[]) {
  return registration.status === 'paid'
    || Boolean(registration.paidAt)
    || Boolean(registration.confirmedAt)
    || payments.some((payment) => payment.status === 'paid' || Boolean(payment.paidAt));
}

function hasRequiredContact(registration: RegistrationRecord) {
  return Boolean(
    registration.payload.fullName?.trim()
    && normalizeRemarketingPhone(registration.payload.phone)
    && normalizeRemarketingEmail(registration.payload.email),
  );
}

function isUnequivocalTest(registration: RegistrationRecord) {
  const email = normalizeRemarketingEmail(registration.payload.email);
  const name = registration.payload.fullName.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
  const explicitMeta = registration.metaContext?.test === true
    || registration.metaContext?.fixture === true
    || registration.metaContext?.environment === 'homologation';
  return explicitMeta
    || /@(example\.com|example\.org|test\.invalid|localhost)$/.test(email)
    || /^(teste|test|fixture|homologacao|cadastro sintetico)(\b|\s|[-_])/.test(name);
}

function isAdminCancelled(registration: RegistrationRecord, auditLogs: AuditLogRecord[]) {
  if (registration.status !== 'cancelled') return false;
  return auditLogs.some((log) => log.entityId === registration.id
    && /admin/i.test(log.actor)
    && (
      /do_not_contact|contact_opt_out|remarketing_suppressed/i.test(log.action)
      || (log.payload && typeof log.payload === 'object'
        && ((log.payload as Record<string, unknown>).doNotContact === true
          || (log.payload as Record<string, unknown>).suppressionReason === 'ADMIN_CANCELLED'))
    ));
}

function deriveOperationalStatus(registration: RegistrationRecord, payment: PaymentRecord, now: Date, paidEvidence = false): RemarketingStatus {
  if (paidEvidence) return 'PAGAMENTO_CONFIRMADO';
  const statuses = `${registration.status} ${payment.status} ${payment.gatewayStatus || ''}`.toLowerCase();
  const expiresAt = payment.expiresAt || registration.expiresAt;
  if (/expired|expirado/.test(statuses) || (expiresAt && new Date(expiresAt).getTime() <= now.getTime())) {
    return 'PAGAMENTO_EXPIROU';
  }
  if (/failed|declined|rejected|falhou|recusado/.test(statuses)) return 'PAGAMENTO_FALHOU';
  if (/cancelled|canceled|cancelado|abandon/.test(statuses) && Boolean(payment.checkoutUrl)) return 'ABANDONOU_CHECKOUT';
  return 'PAGAMENTO_PENDENTE';
}

function maxDate(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) || '';
}

function partnerOrOrigin(registration: RegistrationRecord) {
  if (registration.partnerLink) return registration.partnerLink;
  if (registration.partnerName) return registration.partnerName;
  const attribution = registration.payload.attribution;
  return String(attribution?.utmSource || attribution?.source || attribution?.referrer || '').trim();
}

export function buildRemarketingProjections(database: Pick<Database,
  'registrations' | 'payments' | 'distances' | 'lots' | 'auditLogs'>, now = new Date()) {
  const registrations = database.registrations;
  const parent = registrations.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const union = (left: number, right: number) => {
    const leftRoot = find(left); const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  // CPF is the primary identity. A weak identifier can only join records when
  // it does not conflict with more than one non-empty CPF in the complete set.
  // This prevents a shared family phone/e-mail from joining financial identities.
  const cpfOwners = new Map<string, number>();
  registrations.forEach((registration, index) => {
    if (!registration.cpfHash) return;
    const owner = cpfOwners.get(registration.cpfHash);
    if (owner === undefined) cpfOwners.set(registration.cpfHash, index);
    else union(index, owner);
  });

  const weakGroups = new Map<string, number[]>();
  registrations.forEach((registration, index) => {
    const weakIdentities = [
      normalizeRemarketingEmail(registration.payload.email) && `email:${normalizeRemarketingEmail(registration.payload.email)}`,
      normalizeRemarketingPhone(registration.payload.phone) && `phone:${normalizeRemarketingPhone(registration.payload.phone)}`,
    ].filter((value): value is string => Boolean(value));
    for (const identity of weakIdentities) weakGroups.set(identity, [...(weakGroups.get(identity) || []), index]);
  });

  for (const indexes of weakGroups.values()) {
    const cpfHashes = new Set(indexes.map((index) => registrations[index].cpfHash).filter(Boolean));
    if (cpfHashes.size > 1) continue;
    const attachable = indexes.filter((index) => {
      const cpfHash = registrations[index].cpfHash;
      return !cpfHash || cpfHashes.size === 0 || cpfHashes.has(cpfHash);
    });
    for (let index = 1; index < attachable.length; index += 1) union(attachable[0], attachable[index]);
  }

  const groups = new Map<number, RegistrationRecord[]>();
  registrations.forEach((registration, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) || []), registration]);
  });

  const projections: RemarketingProjection[] = [];
  for (const group of groups.values()) {
    const sorted = group.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const attempts = sorted.filter((registration) => database.payments.some((payment) => payment.registrationId === registration.id));
    const contactAttempts = attempts.filter(hasRequiredContact);
    if (contactAttempts.length === 0) continue;

    const latest = contactAttempts.at(-1)!;
    const latestPayment = database.payments
      .filter((payment) => payment.registrationId === latest.id)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id)).at(-1)!;
    const groupPayments = database.payments.filter((payment) => sorted.some((registration) => registration.id === payment.registrationId));
    const paid = sorted.some((registration) => hasPaidEvidence(registration, groupPayments.filter((payment) => payment.registrationId === registration.id)));
    const test = sorted.some(isUnequivocalTest);
    const adminCancelled = sorted.some((registration) => isAdminCancelled(registration, database.auditLogs));
    const suppressionReason: RemarketingSuppressionReason = paid ? 'PAID' : test ? 'TEST' : adminCancelled ? 'ADMIN_CANCELLED' : '';
    const anchor = sorted[0];
    const lot = database.lots.find((item) => item.id === latest.lotId);
    const distance = database.distances.find((item) => item.id === latest.distanceId);
    const allDates = [
      ...sorted.flatMap((registration) => [registration.updatedAt, registration.paidAt, registration.confirmedAt]),
      ...groupPayments.flatMap((payment) => [payment.updatedAt, payment.paidAt]),
    ];

    projections.push({
      personKey: createRemarketingPersonKey(anchor.id),
      registrationIdReference: latest.id,
      fullName: latest.payload.fullName.trim(),
      whatsapp: normalizeRemarketingPhone(latest.payload.phone),
      email: normalizeRemarketingEmail(latest.payload.email),
      cpfMasked: maskCpf(latest.payload.cpf),
      firstRegistrationAt: sorted[0].createdAt,
      lastRegistrationAt: latest.createdAt,
      lastPaymentAttemptAt: maxDate(groupPayments.map((payment) => payment.updatedAt || payment.createdAt)),
      amountCents: latestPayment.amountCents,
      lot: lot?.name || latest.lotId,
      distance: distance?.name || latest.distanceId,
      registrationStatus: latest.status,
      paymentStatus: latestPayment.status,
      attemptCount: attempts.length,
      checkoutCount: groupPayments.filter((payment) => Boolean(payment.checkoutUrl || payment.providerPaymentId)).length,
      partnerOrOrigin: partnerOrOrigin(latest),
      remarketingStatus: deriveOperationalStatus(latest, latestPayment, now, paid),
      eligible: !suppressionReason,
      suppressionReason,
      lastPaymentCheckAt: now.toISOString(),
      updatedAt: maxDate(allDates),
      registrationIds: sorted.map((registration) => registration.id),
    });
  }
  return projections.sort((a, b) => a.personKey.localeCompare(b.personKey));
}

export function summarizeRemarketingProjections(projections: RemarketingProjection[]) {
  const statuses = Object.fromEntries(REMARKETING_STATUSES.map((status) => [status, 0])) as Record<RemarketingStatus, number>;
  const suppressions = { PAID: 0, TEST: 0, ADMIN_CANCELLED: 0 };
  const eligibleStatuses = Object.fromEntries(REMARKETING_STATUSES.map((status) => [status, 0])) as Record<RemarketingStatus, number>;
  for (const projection of projections) {
    statuses[projection.remarketingStatus] += 1;
    if (projection.eligible) eligibleStatuses[projection.remarketingStatus] += 1;
    if (projection.suppressionReason) suppressions[projection.suppressionReason] += 1;
  }
  return {
    candidates: projections.length,
    eligible: projections.filter((item) => item.eligible).length,
    suppressed: projections.filter((item) => !item.eligible).length,
    suppressions,
    statuses,
    eligibleStatuses,
    duplicatePersonKeys: projections.length - new Set(projections.map((item) => item.personKey)).size,
  };
}

export function analyzeRemarketingIdentityConflicts(database: Pick<Database, 'registrations' | 'payments'>) {
  const sharedAcrossCpf = (selector: (registration: RegistrationRecord) => string) => {
    const identities = new Map<string, Set<string>>();
    for (const registration of database.registrations) {
      const value = selector(registration);
      if (!value || !registration.cpfHash) continue;
      const cpfs = identities.get(value) || new Set<string>();
      cpfs.add(registration.cpfHash);
      identities.set(value, cpfs);
    }
    return [...identities.values()].filter((cpfs) => cpfs.size > 1).length;
  };
  return {
    emailsSharedAcrossCpf: sharedAcrossCpf((registration) => normalizeRemarketingEmail(registration.payload.email)),
    phonesSharedAcrossCpf: sharedAcrossCpf((registration) => normalizeRemarketingPhone(registration.payload.phone)),
    registrationsWithoutPhone: database.registrations.filter((registration) => !normalizeRemarketingPhone(registration.payload.phone)).length,
    registrationsWithoutEmail: database.registrations.filter((registration) => !normalizeRemarketingEmail(registration.payload.email)).length,
    financialDivergences: database.payments.filter((payment) => {
      const registration = database.registrations.find((item) => item.id === payment.registrationId);
      return Boolean(registration && registration.amountCents !== payment.amountCents);
    }).length,
  };
}
