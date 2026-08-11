import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePaymentStatus, detectLocalReconciliationIssues, generateReconciliationReport } from '../server/payment-reconciliation';
import type { Database, PaymentRecord, RegistrationRecord } from '../server/database';

const registration = { id: 'r1', status: 'paid', amountCents: 1000 } as RegistrationRecord;
const payment = { id: 'p1', registrationId: 'r1', status: 'paid', gatewayTransactionId: null } as PaymentRecord;

test('ambiguous historical paid records are manual review only', () => {
  const database = { registrations: [registration], payments: [payment] } as Database;
  const issues = detectLocalReconciliationIssues(database);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].resolutionStatus, 'manual_review_required');
  assert.equal(issues[0].details.preservedWithoutMutation, true);
  assert.equal(generateReconciliationReport(issues).manualReviewRequired, 1);
});

test('gateway paid can only be auto-corrected when amount is consistent', () => {
  assert.equal(comparePaymentStatus({ ...registration, status: 'pending_payment' }, payment, { paid: true, amountCents: 1000, paidAmountCents: 1000, raw: {} }), 'gateway_paid_local_pending');
  assert.equal(comparePaymentStatus({ ...registration, status: 'pending_payment' }, payment, { paid: true, amountCents: 900, paidAmountCents: 900, raw: {} }), 'amount_mismatch');
});

test('transaction evidence nested in immutable gateway payload avoids a false manual review', () => {
  const database = {
    registrations: [registration],
    payments: [{ ...payment, gatewayPayload: { data: { transaction_nsu: 'real-nsu-123' } } }],
  } as Database;
  assert.equal(detectLocalReconciliationIssues(database).length, 0);
});

test('reconciliation treats the legitimate discounted total as the expected amount', () => {
  const discountedRegistration = {
    ...registration,
    amountCents: 8_991,
    originalPriceCents: 9_990,
    discountAmountCents: 999,
    finalPriceCents: 8_991,
    couponCode: 'VOLTA10',
  } as RegistrationRecord;
  assert.equal(comparePaymentStatus(discountedRegistration, { ...payment, amountCents: 8_991 }, {
    paid: true, amountCents: 8_991, paidAmountCents: 8_991, raw: {},
  }), 'consistent');
  assert.equal(comparePaymentStatus(discountedRegistration, { ...payment, amountCents: 8_991 }, {
    paid: true, amountCents: 9_990, paidAmountCents: 9_990, raw: {},
  }), 'amount_mismatch');
});
