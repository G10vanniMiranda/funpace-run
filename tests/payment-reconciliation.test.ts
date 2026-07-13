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
