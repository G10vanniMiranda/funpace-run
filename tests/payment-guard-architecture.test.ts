import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { arePaymentConfirmationsAllowed, arePaymentCreationsAllowed } from '../server/environment.js';
import { isPaymentWebhookTokenValid } from '../server/payment-webhook-auth.js';

test('webhook authentication stays mandatory regardless of payment capability flags', () => {
  const secret = 'homologation-webhook-secret';
  const creationOffConfirmationOn = {
    APP_ENV: 'homologation',
    PAYMENT_CREATION_ENABLED: 'false',
    HOMOLOGATION_PAYMENT_CREATION_ENABLED: 'false',
    PAYMENT_CONFIRMATION_ENABLED: 'true',
    HOMOLOGATION_PAYMENT_CONFIRMATION_ENABLED: 'true',
  };

  assert.equal(arePaymentCreationsAllowed(creationOffConfirmationOn), false);
  assert.equal(arePaymentConfirmationsAllowed(creationOffConfirmationOn), true);
  assert.equal(isPaymentWebhookTokenValid('', secret), false);
  assert.equal(isPaymentWebhookTokenValid('wrong', secret), false);
  assert.equal(isPaymentWebhookTokenValid(secret, secret), true);
});

test('application routes use creation and confirmation guards at their respective boundaries', () => {
  const serverSource = readFileSync('server/index.ts', 'utf8');
  const infinitePaySource = readFileSync('server/infinitepay.ts', 'utf8');

  assert.match(serverSource, /response\.shouldCreateCheckout\s*\n\s*&& paymentCreationAllowed/);
  assert.match(serverSource, /handlePaymentWebhook[\s\S]*?if \(!paymentConfirmationAllowed\)/);
  assert.match(serverSource, /handlePaymentConfirmation[\s\S]*?if \(!paymentConfirmationAllowed\)/);
  assert.match(serverSource, /isPaymentWebhookTokenValid\(receivedToken, webhookSecret\)/);
  assert.match(infinitePaySource, /checkInfinitePayPayment[\s\S]*?arePaymentConfirmationsAllowed\(\)/);
  assert.match(infinitePaySource, /createInfinitePayCheckout[\s\S]*?arePaymentCreationsAllowed\(\)/);
});

test('financial persistence retains amount validation and duplicate-event protection', () => {
  const databaseSource = readFileSync('server/database.ts', 'utf8');

  assert.match(databaseSource, /persistedAmountsAgree/);
  assert.match(databaseSource, /providerAmountMatches/);
  assert.match(databaseSource, /duplicateEvent/);
  assert.match(databaseSource, /if \(duplicate && row\.status === 'paid' && row\.payment_status === 'paid'\)/);
  assert.match(databaseSource, /coupon_used_at = case when coupon_code is not null then coalesce\(coupon_used_at, \$1\)/);
});
