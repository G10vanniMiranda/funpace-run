import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';
import {
  buildEmailDeliveryIdempotencyKey,
  buildLegacyEmailDeliveryCandidate,
  summarizeEmailDeliveryBackfill,
} from '../server/email-delivery-history.ts';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

if (process.argv.slice(2).some((arg) => arg !== '--dry-run')) {
  throw new Error('This phase only supports --dry-run. Backfill execution requires a separate production gate.');
}
if ((process.env.DATABASE_PROVIDER || '').toLowerCase() !== 'supabase' || !process.env.DATABASE_URL) {
  throw new Error('Supabase read-only target is not configured.');
}

const connectionUrl = new URL(process.env.DATABASE_URL);
if (!connectionUrl.hostname.endsWith('.supabase.com')) throw new Error('Database target is not Supabase.');
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_SSL || 'true') !== 'false' ? { rejectUnauthorized: false } : false,
});

await client.connect();
try {
  await client.query('begin transaction isolation level repeatable read read only');
  const identity = (await client.query('select current_database() database_name, current_schema() schema_name')).rows[0];
  const registrations = (await client.query(
    `select id, payload->>'email' current_recipient_email, confirmation_email_provider, confirmation_email_id,
            confirmation_email_sent_at, confirmation_email_last_attempt_at, confirmation_email_error
     from "run-registrations"
     where confirmation_email_sent_at is not null or confirmation_email_id is not null or confirmation_email_error is not null`,
  )).rows;
  const audits = (await client.query(
    `select entity_id, action, payload, created_at from "run-audit-logs"
     where entity_type='registration' and action in ('email.confirmation.attempted','email.confirmation.sent','email.confirmation.failed')
     order by entity_id, created_at`,
  )).rows;
  const auditsByRegistration = new Map();
  for (const audit of audits) {
    const items = auditsByRegistration.get(audit.entity_id) || [];
    items.push({ action: audit.action, payload: audit.payload, createdAt: audit.created_at });
    auditsByRegistration.set(audit.entity_id, items);
  }

  const candidates = registrations.flatMap((row) => {
    const candidate = buildLegacyEmailDeliveryCandidate({
      registrationId: row.id,
      currentRecipientEmail: row.current_recipient_email || '',
      provider: row.confirmation_email_provider,
      providerMessageId: row.confirmation_email_id,
      sentAt: row.confirmation_email_sent_at,
      lastAttemptAt: row.confirmation_email_last_attempt_at,
      error: row.confirmation_email_error,
    }, auditsByRegistration.get(row.id) || []);
    if (!candidate) return [];
    return [{
      ...candidate,
      idempotencyKey: buildEmailDeliveryIdempotencyKey(candidate),
    }];
  });

  const tableExists = Boolean((await client.query(`select to_regclass('public."run-email-deliveries"') table_name`)).rows[0]?.table_name);
  let existing = [];
  if (tableExists) {
    existing = (await client.query('select idempotency_key, provider, provider_message_id from "run-email-deliveries"')).rows;
  }
  const backfillSummary = summarizeEmailDeliveryBackfill(candidates, existing.map((item) => ({
    idempotencyKey: item.idempotency_key,
    provider: item.provider,
    providerMessageId: item.provider_message_id,
  })), registrations.length);

  console.log(JSON.stringify({
    verdict: backfillSummary.verdict,
    mode: 'DRY RUN',
    changed: 'ZERO MUTATION',
    target: { database: identity.database_name, schema: identity.schema_name, provider: 'supabase' },
    legacy: {
      registrationsWithSummary: registrations.length,
      candidates: backfillSummary.candidates,
      recipientFromAudit: backfillSummary.recipientFromAudit,
      recipientFallback: backfillSummary.recipientFallback,
      ambiguous: backfillSummary.ambiguous,
    },
    collisions: {
      candidateIdempotency: backfillSummary.candidateIdempotency,
      candidateProviderMessage: backfillSummary.candidateProviderMessage,
      existingIdempotency: backfillSummary.existingIdempotency,
      existingProviderMessage: backfillSummary.existingProviderMessage,
    },
    destinationTableExists: tableExists,
    executionAuthorized: false,
  }, null, 2));
  await client.query('rollback');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
