import test from 'node:test';
import assert from 'node:assert/strict';
import { checkInfinitePayPayment, createInfinitePayCheckout, InfinitePayError } from '../server/infinitepay.js';
import { calculateCouponPricing } from '../server/coupons.js';

test('creates the InfinitePay charge with the server-calculated VOLTA10 amount', async () => {
  const originalFetch = globalThis.fetch;
  const originalPaymentsEnabled = process.env.PAYMENTS_ENABLED;
  process.env.PAYMENTS_ENABLED = 'true';
  let body: Record<string, any> = {};
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ url: 'https://checkout.infinitepay.io/test', slug: 'coupon-test' }), { status: 200 });
  };
  try {
    const pricing = calculateCouponPricing(9_990, 'VOLTA10');
    assert.ok(pricing);
    await createInfinitePayCheckout({
      handle: 'funpace', orderNsu: 'reg-coupon', amountCents: pricing.finalPriceCents,
      description: 'Inscrição teste', redirectUrl: 'https://example.com/sucesso', webhookUrl: 'https://example.com/webhook',
      customer: { fullName: 'Atleta Teste', email: 'atleta@example.com', phone: '(69) 99999-9999' } as any,
    });
    assert.equal(body.items[0].price, 8_991);
    assert.equal('finalAmount' in body, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalPaymentsEnabled === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = originalPaymentsEnabled;
  }
});

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

test('blocks new checkout creation while allowing payment_check for an existing charge', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreationEnabled = process.env.PAYMENT_CREATION_ENABLED;
  const originalConfirmationEnabled = process.env.PAYMENT_CONFIRMATION_ENABLED;
  process.env.PAYMENT_CREATION_ENABLED = 'false';
  process.env.PAYMENT_CONFIRMATION_ENABLED = 'true';
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({
      success: true, paid: true, amount: 8991, paid_amount: 8991, capture_method: 'pix',
    }), { status: 200 });
  };

  try {
    await assert.rejects(
      createInfinitePayCheckout({
        handle: 'funpace', orderNsu: 'existing-order', amountCents: 8991,
        description: 'Inscricao existente', redirectUrl: 'https://example.com/sucesso',
        webhookUrl: 'https://example.com/webhook',
        customer: { fullName: 'Atleta Teste', email: 'atleta@example.com', phone: '(69) 99999-9999' } as any,
      }),
      (error: unknown) => error instanceof InfinitePayError && error.statusCode === 503,
    );
    assert.equal(providerCalls, 0);

    const result = await checkInfinitePayPayment({
      handle: 'funpace', orderNsu: 'existing-order', transactionNsu: 'transaction-1', slug: 'slug-1',
    });
    assert.equal(result.paid, true);
    assert.equal(result.amountCents, 8991);
    assert.equal(providerCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCreationEnabled === undefined) delete process.env.PAYMENT_CREATION_ENABLED;
    else process.env.PAYMENT_CREATION_ENABLED = originalCreationEnabled;
    if (originalConfirmationEnabled === undefined) delete process.env.PAYMENT_CONFIRMATION_ENABLED;
    else process.env.PAYMENT_CONFIRMATION_ENABLED = originalConfirmationEnabled;
  }
});

test('blocks payment_check independently during an explicit confirmation emergency stop', async () => {
  const originalConfirmationEnabled = process.env.PAYMENT_CONFIRMATION_ENABLED;
  process.env.PAYMENT_CONFIRMATION_ENABLED = 'false';
  try {
    await assert.rejects(
      checkInfinitePayPayment({ handle: 'funpace', orderNsu: 'reg-1', transactionNsu: 'txn-1', slug: 'slug-1' }),
      (error: unknown) => error instanceof InfinitePayError && error.statusCode === 503,
    );
  } finally {
    if (originalConfirmationEnabled === undefined) delete process.env.PAYMENT_CONFIRMATION_ENABLED;
    else process.env.PAYMENT_CONFIRMATION_ENABLED = originalConfirmationEnabled;
  }
});
