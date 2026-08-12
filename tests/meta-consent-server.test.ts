import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  bindMetaConsentRegistration,
  parseMarketingConsentDecision,
  signMetaConsentSession,
  verifyMetaConsentSession,
} from '../server/meta-consent-session';
import { canQueueMetaPurchase, canTrackMetaBrowserPurchase } from '../server/meta-events';

const secret = 'meta-consent-test-secret-with-at-least-32-characters';
const registrationA = '123e4567-e89b-42d3-a456-426614174000';
const registrationB = '123e4567-e89b-42d3-a456-426614174001';
const now = 1_800_000_000_000;

test('accepts grant, revocation and reaccept decisions, rejecting ambiguous payloads', () => {
  assert.equal(parseMarketingConsentDecision({ marketing: true }), true);
  assert.equal(parseMarketingConsentDecision({ marketing: false }), false);
  assert.equal(parseMarketingConsentDecision({ marketing: true }), true);
  assert.equal(parseMarketingConsentDecision({ marketing: 'true' }), null);
  assert.equal(parseMarketingConsentDecision({ marketing: false, registrationId: registrationB }), null);
  assert.equal(parseMarketingConsentDecision({}), null);
});

test('signed HttpOnly subject binds only registrations created by that browser', () => {
  const ownSession = bindMetaConsentRegistration(null, registrationA, now, 3600);
  assert.ok(ownSession);
  const token = signMetaConsentSession(ownSession, secret);
  const verified = verifyMetaConsentSession(token, secret, now + 1);
  assert.deepEqual(verified?.registrationIds, [registrationA]);
  assert.equal(verified?.registrationIds.includes(registrationB), false);
  assert.equal(verifyMetaConsentSession(`${token}tampered`, secret, now + 1), null);
  assert.equal(verifyMetaConsentSession(`${token}.extra`, secret, now + 1), null);
  assert.equal(verifyMetaConsentSession(token, secret, now + 3_600_001), null);
});

test('server alone can extend the signed subject idempotently', () => {
  const first = bindMetaConsentRegistration(null, registrationA, now, 3600);
  const repeated = bindMetaConsentRegistration(first, registrationA, now + 1, 3600);
  const extended = bindMetaConsentRegistration(repeated, registrationB, now + 2, 3600);
  assert.deepEqual(repeated?.registrationIds, [registrationA]);
  assert.deepEqual(extended?.registrationIds, [registrationA, registrationB]);
  assert.equal(bindMetaConsentRegistration(extended, 'not-a-registration', now + 3, 3600), null);
});

test('Purchase respects the current durable consent decision', () => {
  const paidAt = new Date().toISOString();
  const beforePayment = new Date(Date.parse(paidAt) - 1_000).toISOString();
  const afterPayment = new Date(Date.parse(paidAt) + 1_000).toISOString();
  assert.equal(canQueueMetaPurchase('paid', 'paid', paidAt, true, beforePayment), true);
  assert.equal(canQueueMetaPurchase('paid', 'paid', paidAt, false, beforePayment), false);
  assert.equal(canQueueMetaPurchase('paid', 'paid', paidAt, true, afterPayment), false);
  assert.equal(canQueueMetaPurchase('paid', 'paid', paidAt, true, null), false);
});

test('revocation blocks unsent events and leaves sent events intact', () => {
  const database = readFileSync('server/database.ts', 'utf8');
  const updateStart = database.indexOf('export async function updateMetaMarketingConsentInPostgres');
  const updateEnd = database.indexOf('export async function cleanupMetaClientContextInPostgres', updateStart);
  const updateBlock = database.slice(updateStart, updateEnd);
  assert.match(updateBlock, /status in \('pending','failed'\)/);
  assert.match(updateBlock, /set status='dead'/);
  assert.match(updateBlock, /last_error='MARKETING_CONSENT_REVOKED'/);
  assert.doesNotMatch(updateBlock, /status in \([^)]*sent/);
  assert.doesNotMatch(updateBlock, /delete from/);
});

test('enqueue, worker and Purchase recovery consult current durable consent', () => {
  const database = readFileSync('server/database.ts', 'utf8');
  const events = readFileSync('server/meta-events.ts', 'utf8');
  assert.match(database, /registration\.id=\$4 and registration\.marketing_consent=true/);
  assert.match(database, /join .*registrations.*registration on registration\.id=integration\.entity_id/);
  assert.match(database, /registration\.marketing_consent=true/);
  assert.match(events, /consentSnapshot\?\.marketingConsent/);
  assert.match(events, /snapshot\.marketingConsent/);
});

test('worker serializes the final consent decision with the external send', () => {
  const database = readFileSync('server/database.ts', 'utf8');
  const events = readFileSync('server/meta-events.ts', 'utf8');
  const lockStart = database.indexOf('export async function withMetaConsentSendAuthorizationInPostgres');
  const lockEnd = database.indexOf('export async function getMetaRegistrationSnapshotInPostgres', lockStart);
  const lockBlock = database.slice(lockStart, lockEnd);
  assert.match(lockBlock, /select marketing_consent/);
  assert.match(lockBlock, /for update/);
  assert.ok(lockBlock.indexOf('await send()') < lockBlock.indexOf("client.query('commit')"));
  assert.match(events, /withMetaConsentSendAuthorizationInPostgres\([\s\S]*\(\) => sendMetaServerEvent\(event\)/);
});

test('consent migrations are additive, fail legacy registrations closed and retain RLS', () => {
  const migration = readFileSync('supabase/migrations/20260803035938_meta_consent_hardening.sql', 'utf8');
  const failClosed = readFileSync('supabase/migrations/20260803050443_meta_legacy_consent_fail_closed.sql', 'utf8');
  assert.match(migration, /add column if not exists marketing_consent boolean not null default false/);
  assert.match(migration, /add column if not exists marketing_consent_updated_at text/);
  assert.match(migration, /payload #> '\{meta,marketingConsent\}'/);
  assert.match(migration, /enable row level security/);
  assert.doesNotMatch(migration, /drop table|drop column|delete from/i);
  assert.match(failClosed, /set marketing_consent = false/);
  assert.match(failClosed, /LEGACY_MARKETING_CONSENT_FAIL_CLOSED/);
  assert.match(failClosed, /integration\.status in \('pending', 'processing', 'failed'\)/);
  assert.doesNotMatch(failClosed, /integration\.status in \([^)]*sent/);
  assert.doesNotMatch(failClosed, /amount|payment|paid_at|confirmed_at/i);
});

test('Purchase recovery requires consent to predate financial confirmation', () => {
  const database = readFileSync('server/database.ts', 'utf8');
  const start = database.indexOf('export async function listPaidRegistrationsMissingMetaPurchaseInPostgres');
  const end = database.indexOf('export async function updateMetaMarketingConsentInPostgres', start);
  const recovery = database.slice(start, end);
  assert.match(recovery, /marketing_consent_updated_at::timestamptz/);
  assert.match(recovery, /<= coalesce\(payment\.paid_at,registration\.paid_at,registration\.confirmed_at\)::timestamptz/);
});

test('privileged function migration removes public definer execution and pins search paths', () => {
  const migration = readFileSync('supabase/migrations/20260803050456_restrict_privileged_functions.sql', 'utf8');
  assert.match(migration, /prevent_partner_audit_mutation\(\)[\s\S]*set search_path = pg_catalog, public/);
  assert.match(migration, /protect_confirmed_partner_snapshot\(\)[\s\S]*set search_path = pg_catalog, public/);
  assert.match(migration, /run_select_lot_for_registration_number\(text, integer\)[\s\S]*security invoker/);
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/);
});

test('browser Purchase requires server-confirmed temporal eligibility', () => {
  const successPage = readFileSync('src/pages/Success.tsx', 'utf8');
  const server = readFileSync('server/index.ts', 'utf8');
  assert.match(successPage, /registration\.metaPurchaseEligible/);
  assert.match(server, /metaPurchaseEligible: canTrackMetaBrowserPurchase/);
});

test('browser Purchase is restricted to the bound browser and a 24 hour window', () => {
  const paidAt = '2026-08-03T10:00:00.000Z';
  const consentAt = '2026-08-03T09:00:00.000Z';
  const soon = Date.parse(paidAt) + 60_000;
  assert.equal(canTrackMetaBrowserPurchase('paid', 'paid', paidAt, true, consentAt, true, soon), true);
  assert.equal(canTrackMetaBrowserPurchase('paid', 'paid', paidAt, true, consentAt, false, soon), false);
  assert.equal(canTrackMetaBrowserPurchase('paid', 'paid', paidAt, true, consentAt, true, soon + 25 * 60 * 60 * 1000), false);
  assert.equal(canTrackMetaBrowserPurchase('pending_payment', 'pending_payment', null, true, consentAt, true, soon), false);
});

test('browser synchronizes consent without accepting a registration id', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const api = readFileSync('src/lib/api.ts', 'utf8');
  const server = readFileSync('server/index.ts', 'utf8');
  const vercelRoute = readFileSync('api/privacy/marketing-consent.ts', 'utf8');
  assert.match(app, /synchronizeMarketingConsent\(consent\.preferences\.marketing/);
  assert.match(api, /JSON\.stringify\(\{ marketing \}\)/);
  assert.match(server, /HttpOnly; SameSite=Strict/);
  assert.match(server, /parseMarketingConsentDecision\(body\)/);
  assert.match(server, /isMetaConsentRateLimited\(req\)/);
  assert.match(server, /Origem nao autorizada/);
  assert.match(vercelRoute, /handleApiRequest\(req, res\)/);
});
