import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePaymentWebhook, toPaymentProviderStatus } from '../server/index.js';

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
