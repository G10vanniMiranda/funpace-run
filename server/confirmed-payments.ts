import type { Database, PaymentRecord, RegistrationRecord } from './database.js';

export const CONFIRMED_PAYMENT_PROVIDER_LABELS = {
  infinitepay: 'InfinitePay',
  manual_pix: 'PIX Manual',
} as const;

export type ConfirmedPaymentProjection = {
  registrationId: string;
  paymentId: string;
  paidAt: string;
  fullName: string;
  cpfMasked: string;
  whatsapp: string;
  email: string;
  distance: string;
  shirtSize: string;
  lot: string;
  bibNumber: string;
  amountCents: number;
  paymentMethod: string;
  partner: string;
  partnerType: string;
  acquisitionOrigin: string;
  coupon: string;
  discountCents: number;
  provider: string;
};

export type ConfirmedPaymentsDiagnostics = {
  paidRegistrations: number;
  paidPayments: number;
  registrationPaidWithoutPaidPayment: number;
  paymentPaidWithoutPaidRegistration: number;
  duplicatePaidRegistrationIds: string[];
  duplicatePaidPaymentCount: number;
};

export type ConfirmedPaymentsProjectionResult = {
  projections: ConfirmedPaymentProjection[];
  diagnostics: ConfirmedPaymentsDiagnostics;
};

export function maskConfirmedPaymentCpf(cpf: string) {
  const digits = cpf.replace(/\D/g, '');
  return digits.length === 11
    ? `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`
    : '***.***.***-**';
}

export function confirmedPaymentProviderLabel(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'manual_pix') return CONFIRMED_PAYMENT_PROVIDER_LABELS.manual_pix;
  if (normalized === 'infinitepay') return CONFIRMED_PAYMENT_PROVIDER_LABELS.infinitepay;
  return `Outro — ${provider.trim() || 'não informado'}`;
}

function paymentRecency(payment: PaymentRecord) {
  return payment.paidAt || payment.updatedAt || payment.createdAt;
}

function selectLatestPaidPayment(payments: PaymentRecord[]) {
  return payments.slice().sort((left, right) => (
    paymentRecency(right).localeCompare(paymentRecency(left))
    || right.id.localeCompare(left.id)
  ))[0];
}

function partnerTypeLabel(registration: RegistrationRecord) {
  if (registration.partnerType === 'influencer') return 'Influenciador';
  if (registration.partnerType === 'sports_advisory') return 'Assessoria esportiva';
  return '';
}

function acquisitionOrigin(registration: RegistrationRecord) {
  const attribution = registration.payload.attribution;
  return String(
    attribution?.utmSource
    || attribution?.source
    || attribution?.lastTouch?.utmSource
    || attribution?.lastTouch?.referrer
    || attribution?.firstTouch?.utmSource
    || attribution?.firstTouch?.referrer
    || attribution?.referrer
    || '',
  ).trim() || 'Direto / sem origem identificada';
}

export function buildConfirmedPaymentsProjection(
  database: Pick<Database, 'registrations' | 'payments' | 'distances' | 'lots'>,
): ConfirmedPaymentsProjectionResult {
  const paidRegistrations = database.registrations.filter((registration) => registration.status === 'paid');
  const paidPayments = database.payments.filter((payment) => payment.status === 'paid');
  const paidRegistrationIds = new Set(paidRegistrations.map((registration) => registration.id));
  const paidPaymentsByRegistration = new Map<string, PaymentRecord[]>();

  for (const payment of paidPayments) {
    const related = paidPaymentsByRegistration.get(payment.registrationId) || [];
    related.push(payment);
    paidPaymentsByRegistration.set(payment.registrationId, related);
  }

  const duplicatePaidRegistrationIds = [...paidPaymentsByRegistration.entries()]
    .filter(([, payments]) => payments.length > 1)
    .map(([registrationId]) => registrationId)
    .sort();
  const projections: ConfirmedPaymentProjection[] = [];

  for (const registration of paidRegistrations) {
    const relatedPayments = paidPaymentsByRegistration.get(registration.id) || [];
    if (relatedPayments.length === 0) continue;
    const payment = selectLatestPaidPayment(relatedPayments);
    const distance = database.distances.find((item) => item.id === registration.distanceId);
    const lot = database.lots.find((item) => item.id === registration.lotId);

    projections.push({
      registrationId: registration.id,
      paymentId: payment.id,
      paidAt: payment.paidAt || registration.paidAt || registration.confirmedAt || payment.updatedAt,
      fullName: registration.payload.fullName.trim(),
      cpfMasked: maskConfirmedPaymentCpf(registration.payload.cpf),
      whatsapp: registration.payload.phone.trim(),
      email: registration.payload.email.trim(),
      distance: distance?.name || registration.distanceId,
      shirtSize: registration.payload.shirtSize,
      lot: lot?.name || registration.lotId,
      bibNumber: registration.bibNumber || '',
      amountCents: payment.amountCents,
      paymentMethod: confirmedPaymentProviderLabel(payment.provider),
      partner: registration.partnerName || 'Sem parceiro',
      partnerType: partnerTypeLabel(registration),
      acquisitionOrigin: acquisitionOrigin(registration),
      coupon: registration.couponCode || '',
      discountCents: registration.discountAmountCents || 0,
      provider: payment.provider,
    });
  }

  projections.sort((left, right) => (
    right.paidAt.localeCompare(left.paidAt)
    || left.registrationId.localeCompare(right.registrationId)
  ));

  return {
    projections,
    diagnostics: {
      paidRegistrations: paidRegistrations.length,
      paidPayments: paidPayments.length,
      registrationPaidWithoutPaidPayment: paidRegistrations.length - projections.length,
      paymentPaidWithoutPaidRegistration: paidPayments.filter((payment) => !paidRegistrationIds.has(payment.registrationId)).length,
      duplicatePaidRegistrationIds,
      duplicatePaidPaymentCount: duplicatePaidRegistrationIds.reduce(
        (total, registrationId) => total + (paidPaymentsByRegistration.get(registrationId)?.length || 1) - 1,
        0,
      ),
    },
  };
}
