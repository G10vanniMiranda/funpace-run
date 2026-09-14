import type { Database, PaymentRecord, RegistrationRecord } from './database.js';
import { InfinitePayError, type InfinitePayPaymentCheck } from './infinitepay.js';

export type ReconciliationIssueCode =
  | 'gateway_paid_local_pending'
  | 'gateway_paid_local_expired'
  | 'local_paid_without_real_transaction'
  | 'local_confirmed_without_gateway_evidence'
  | 'amount_mismatch'
  | 'registration_without_payment';

export type ReconciliationIssue = {
  issueKey: string;
  issueCode: ReconciliationIssueCode;
  severity: 'info' | 'warning' | 'critical';
  resolutionStatus: 'consistent' | 'automatically_corrected' | 'manual_review_required';
  registrationId: string;
  paymentId: string | null;
  details: Record<string, unknown>;
};

export function findLocalPaymentByGatewayId(database: Pick<Database, 'payments'>, gatewayId: string) {
  return database.payments.find((payment) => (
    payment.gatewayTransactionId === gatewayId || payment.providerPaymentId === gatewayId
  )) || null;
}

export function findRegistrationByPayment(database: Pick<Database, 'registrations'>, payment: PaymentRecord) {
  return database.registrations.find((registration) => registration.id === payment.registrationId) || null;
}

// SERVICE-SWAP-001 — narrowly scoped exemption. A service-swap registration is
// an intentionally NON-GATEWAY, zero-amount, organization-authorized paid
// participation (see createServiceSwapRegistrationInPostgres); it will never
// have a real gateway_transaction_id and must not be flagged as suspicious
// the way an ordinary paid-without-evidence registration would be. This does
// NOT change hasRealGatewayTransaction's semantics — service_swap is still,
// correctly, "not a real gateway transaction" — it only recognizes it as a
// distinct, explicitly authorized case that should be excluded from
// `local_paid_without_real_transaction`. It matches on all three fields
// together so it can never accidentally cover infinitepay, manual_pix, or any
// other/unknown provider, or a non-zero-amount payment.
export function isAuthorizedNonGatewayParticipation(payment: PaymentRecord) {
  return payment.provider === 'service_swap'
    && payment.gatewayStatus === 'service_swap_authorized'
    && payment.amountCents === 0;
}

export function hasRealGatewayTransaction(payment: PaymentRecord) {
  const isReal = (value: unknown) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return Boolean(normalized && !normalized.startsWith('manual_') && !normalized.startsWith('manual-'));
  };
  // Synthetic manual_reconcile_* references are not gateway NSUs, but they are
  // already documented reconciliation evidence. They remain immutable history
  // and must not create a second manual-review case.
  if (payment.gatewayTransactionId?.trim()) return true;
  const findTransaction = (value: unknown, depth = 0): boolean => {
    if (!value || typeof value !== 'object' || depth > 5) return false;
    const record = value as Record<string, unknown>;
    for (const key of ['transaction_nsu', 'transactionNsu', 'transaction_id', 'transactionId']) {
      if (isReal(record[key])) return true;
    }
    return Object.values(record).some((nested) => findTransaction(nested, depth + 1));
  };
  return findTransaction(payment.gatewayPayload);
}

export function comparePaymentStatus(
  registration: RegistrationRecord,
  payment: PaymentRecord,
  gateway: InfinitePayPaymentCheck,
) {
  if (gateway.amountCents !== null && gateway.amountCents !== registration.amountCents) return 'amount_mismatch' as const;
  if (gateway.paid && registration.status === 'expired') return 'gateway_paid_local_expired' as const;
  if (gateway.paid && registration.status !== 'paid') return 'gateway_paid_local_pending' as const;
  return 'consistent' as const;
}

export function detectLocalReconciliationIssues(database: Pick<Database, 'registrations' | 'payments'>) {
  const issues: ReconciliationIssue[] = [];
  for (const registration of database.registrations) {
    const payment = database.payments.find((item) => item.registrationId === registration.id) || null;
    if (!payment) {
      issues.push({
        issueKey: `registration_without_payment:${registration.id}`,
        issueCode: 'registration_without_payment', severity: 'info', resolutionStatus: 'consistent',
        registrationId: registration.id, paymentId: null, details: { registrationStatus: registration.status },
      });
      continue;
    }
    if (registration.status === 'paid' && !hasRealGatewayTransaction(payment) && !isAuthorizedNonGatewayParticipation(payment)) {
      issues.push({
        issueKey: `local_paid_without_real_transaction:${registration.id}`,
        issueCode: 'local_paid_without_real_transaction', severity: 'warning', resolutionStatus: 'manual_review_required',
        registrationId: registration.id, paymentId: payment.id,
        details: { paymentStatus: payment.status, gatewayTransactionId: payment.gatewayTransactionId, preservedWithoutMutation: true },
      });
    }
  }
  return issues;
}

export async function fetchInfinitePayPayments<T>(
  candidates: T[],
  verify: (candidate: T) => Promise<InfinitePayPaymentCheck>,
  options: { maxAttempts?: number; baseDelayMs?: number } = {},
) {
  const results: Array<{ candidate: T; check?: InfinitePayPaymentCheck; error?: Error }> = [];
  const maxAttempts = options.maxAttempts || 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  for (const candidate of candidates) {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        results.push({ candidate, check: await verify(candidate) });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const retryable = !(error instanceof InfinitePayError) || !error.statusCode || error.statusCode === 429 || error.statusCode >= 500;
        if (!retryable || attempt === maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (2 ** (attempt - 1))));
      }
    }
    if (lastError) results.push({ candidate, error: lastError });
  }
  return results;
}

export function generateReconciliationReport(issues: ReconciliationIssue[]) {
  return {
    totalIssues: issues.length,
    manualReviewRequired: issues.filter((issue) => issue.resolutionStatus === 'manual_review_required').length,
    critical: issues.filter((issue) => issue.severity === 'critical').length,
    warning: issues.filter((issue) => issue.severity === 'warning').length,
    byCode: issues.reduce<Record<string, number>>((summary, issue) => {
      summary[issue.issueCode] = (summary[issue.issueCode] || 0) + 1;
      return summary;
    }, {}),
  };
}
