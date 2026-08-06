import assert from 'node:assert/strict';
import test from 'node:test';
import {
  areOutboundWebhooksAllowed,
  areExternalPaymentsAllowed,
  assertDatabaseEnvironmentIsolation,
  databaseUrlMatchesProjectRef,
  isCronExecutionAllowed,
  isEmailRecipientAllowed,
  isEmailDeliveryAllowed,
  isGoogleSheetsAllowed,
} from '../server/environment.js';

const homologRef = 'tctbwjrdhpwxzwbcwcvy';
const productionRef = 'jypmwutwexpxjlaqwjvb';

test('homologation accepts only the explicitly expected Supabase project', () => {
  const homologDatabaseUrl = `postgresql://postgres.${homologRef}:secret@pooler.supabase.com:6543/postgres`;
  const productionDatabaseUrl = `postgresql://postgres.${productionRef}:secret@pooler.supabase.com:6543/postgres`;

  assert.equal(databaseUrlMatchesProjectRef(homologDatabaseUrl, homologRef), true);
  assert.equal(databaseUrlMatchesProjectRef(productionDatabaseUrl, homologRef), false);
  assert.doesNotThrow(() => assertDatabaseEnvironmentIsolation({
    APP_ENV: 'homologation',
    EXPECTED_DATABASE_PROJECT_REF: homologRef,
    DATABASE_URL: homologDatabaseUrl,
  }));
  assert.throws(() => assertDatabaseEnvironmentIsolation({
    APP_ENV: 'homologation',
    EXPECTED_DATABASE_PROJECT_REF: homologRef,
    DATABASE_URL: productionDatabaseUrl,
  }), /isolation check failed/i);
});

test('production also fails closed when the expected Supabase project is absent or wrong', () => {
  const productionRef = 'prodabcdefghijklmnop';
  const productionDatabaseUrl = `postgresql://postgres.${productionRef}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;
  assert.throws(() => assertDatabaseEnvironmentIsolation({
    APP_ENV: 'production',
    DATABASE_URL: productionDatabaseUrl,
  }), /production database isolation check failed/);
  assert.throws(() => assertDatabaseEnvironmentIsolation({
    APP_ENV: 'production',
    DATABASE_URL: productionDatabaseUrl,
    EXPECTED_DATABASE_PROJECT_REF: 'wrongprojectref00000',
  }), /production database isolation check failed/);
  assert.doesNotThrow(() => assertDatabaseEnvironmentIsolation({
    APP_ENV: 'production',
    DATABASE_URL: productionDatabaseUrl,
    EXPECTED_DATABASE_PROJECT_REF: productionRef,
  }));
});

test('homologation integrations are deny-by-default', () => {
  const environment = { APP_ENV: 'homologation' };
  assert.equal(areExternalPaymentsAllowed(environment), false);
  assert.equal(isCronExecutionAllowed(environment), false);
  assert.equal(isGoogleSheetsAllowed({ ...environment, GOOGLE_SHEETS_ENABLED: 'true' }), false);
  assert.equal(isEmailRecipientAllowed('tester@example.com', { ...environment, EMAIL_ENABLED: 'true' }), false);
});

test('production integrations are explicit and deny-by-default', () => {
  const environment = { APP_ENV: 'production' };
  assert.equal(areExternalPaymentsAllowed(environment), false);
  assert.equal(isEmailDeliveryAllowed(environment), false);
  assert.equal(isCronExecutionAllowed(environment), false);
  assert.equal(areOutboundWebhooksAllowed(environment), false);

  const enabled = {
    APP_ENV: 'production',
    PAYMENTS_ENABLED: 'true',
    EMAIL_ENABLED: 'true',
    CRON_ENABLED: 'true',
    OUTBOUND_WEBHOOKS_ENABLED: 'true',
  };
  assert.equal(areExternalPaymentsAllowed(enabled), true);
  assert.equal(isEmailDeliveryAllowed(enabled), true);
  assert.equal(isCronExecutionAllowed(enabled), true);
  assert.equal(areOutboundWebhooksAllowed(enabled), true);
});

test('homologation requires explicit secondary opt-ins for external integrations', () => {
  const environment = {
    APP_ENV: 'homologation',
    PAYMENTS_ENABLED: 'true',
    HOMOLOGATION_PAYMENTS_ENABLED: 'true',
    CRON_ENABLED: 'true',
    HOMOLOGATION_CRON_ENABLED: 'true',
    GOOGLE_SHEETS_ENABLED: 'true',
    HOMOLOGATION_GOOGLE_SHEETS_ENABLED: 'true',
    EMAIL_ENABLED: 'true',
    HOMOLOGATION_EMAIL_ALLOWLIST: 'tester@example.com',
  };

  assert.equal(areExternalPaymentsAllowed(environment), true);
  assert.equal(isCronExecutionAllowed(environment), true);
  assert.equal(isGoogleSheetsAllowed(environment), true);
  assert.equal(isEmailRecipientAllowed('tester@example.com', environment), true);
  assert.equal(isEmailRecipientAllowed('customer@example.com', environment), false);
});
