import test from 'node:test';
import assert from 'node:assert/strict';
import { checkInfinitePayPayment, InfinitePayError } from '../server/infinitepay.js';

test('verifies an approved PIX with the official payment_check contract', async () => {
  const originalFetch = globalThis.fetch;
  const originalPaymentsEnabled = process.env.PAYMENTS_ENABLED;
  process.env.PAYMENTS_ENABLED = 'true';
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ success: true, paid: true, amount: 7990, paid_amount: 7990, capture_method: 'pix' }), { status: 200 });
  };
  try {
    const result = await checkInfinitePayPayment({ handle: 'funpace', orderNsu: 'reg-1', transactionNsu: 'txn-1', slug: 'slug-1' });
    assert.equal(result.paid, true);
    assert.equal(result.amountCents, 7990);
    assert.deepEqual(body, { handle: 'funpace', order_nsu: 'reg-1', transaction_nsu: 'txn-1', slug: 'slug-1' });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalPaymentsEnabled === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = originalPaymentsEnabled;
  }
});

test('surfaces provider outages so webhook processing can return an error and be retried', async () => {
  const originalFetch = globalThis.fetch;
  const originalPaymentsEnabled = process.env.PAYMENTS_ENABLED;
  process.env.PAYMENTS_ENABLED = 'true';
  globalThis.fetch = async () => { throw new Error('connection lost'); };
  try {
    await assert.rejects(
      checkInfinitePayPayment({ handle: 'funpace', orderNsu: 'reg-1', transactionNsu: 'txn-1', slug: 'slug-1' }),
      (error: unknown) => error instanceof InfinitePayError && error.statusCode === 502,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalPaymentsEnabled === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = originalPaymentsEnabled;
  }
});
