import assert from 'node:assert/strict';
import test from 'node:test';
import {
  areExternalPaymentsAllowed,
  assertDatabaseEnvironmentIsolation,
  databaseUrlMatchesProjectRef,
  isCronExecutionAllowed,
  isEmailRecipientAllowed,
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

test('homologation integrations are deny-by-default', () => {
  const environment = { APP_ENV: 'homologation' };
  assert.equal(areExternalPaymentsAllowed(environment), false);
  assert.equal(isCronExecutionAllowed(environment), false);
  assert.equal(isGoogleSheetsAllowed({ ...environment, GOOGLE_SHEETS_ENABLED: 'true' }), false);
  assert.equal(isEmailRecipientAllowed('tester@example.com', { ...environment, EMAIL_ENABLED: 'true' }), false);
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
