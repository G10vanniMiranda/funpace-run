import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePaymentWebhook, resolvePaymentTransition, toPaymentProviderStatus } from '../server/index.js';

test('treats received status as paid', () => {
  assert.equal(toPaymentProviderStatus({ status: 'received' }), 'paid');
});

test('treats settled timestamp as paid even without explicit paid flag', () => {
  assert.equal(
    toPaymentProviderStatus({ status: 'processing', settledAt: '2026-07-07T12:00:00.000Z' }),
    'paid',
  );
});

test('normalizes webhook using nested metadata and received timestamp fields', () => {
  const result = normalizePaymentWebhook({
    id: 'evt_123',
    status: 'received',
    amount: 7990,
    payment_method: 'pix',
    metadata: {
      registrationId: 'reg_123',
    },
    transaction: {
      transaction_nsu: 'txn_123',
      received_at: '2026-07-07T12:00:00.000Z',
    },
  });

  assert.ok(result);
  assert.equal(result.registrationId, 'reg_123');
  assert.equal(result.providerEventId, 'evt_123');
  assert.equal(result.providerTransactionId, 'txn_123');
  assert.equal(result.paymentMethod, 'pix');
  assert.equal(result.nextStatus, 'paid');
});

test('normalizes the official InfinitePay webhook payload as paid', () => {
  const result = normalizePaymentWebhook({
    invoice_slug: 'abc123',
    amount: 7990,
    paid_amount: 7990,
    capture_method: 'pix',
    transaction_nsu: 'txn_123',
    order_nsu: 'reg_123',
    receipt_url: 'https://example.test/receipt',
  });

  assert.equal(result?.registrationId, 'reg_123');
  assert.equal(result?.providerPaymentId, 'abc123');
  assert.equal(result?.providerTransactionId, 'txn_123');
  assert.equal(result?.paymentMethod, 'pix');
  assert.equal(result?.nextStatus, 'paid');
});

test('never downgrades a paid registration from delayed gateway events', () => {
  assert.equal(resolvePaymentTransition('paid', 'expired'), 'paid');
  assert.equal(resolvePaymentTransition('paid', 'payment_failed'), 'paid');
  assert.equal(resolvePaymentTransition('paid', 'pending_payment'), 'paid');
});

test('accepts delayed approval after local expiration', () => {
  assert.equal(resolvePaymentTransition('expired', 'paid'), 'paid');
});
