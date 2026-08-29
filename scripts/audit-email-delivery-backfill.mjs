/**
 * RELEASE-05 Stage 1A — historical email backfill audit (READ ONLY).
 *
 * Recomputes the current cohort of legacy-email registrations that have no
 * append-only delivery history, classifies each by evidence strength, timeline
 * position relative to the history rollout, and provider-message collision, and
 * reports a sanitized plan. It NEVER writes: no INSERT/UPDATE/DELETE, no email
 * send, no provider call, no outbox. There is no --apply / --execute path.
 *
 *   node --import tsx scripts/audit-email-delivery-backfill.mjs --dry-run [--json]
 *   node --import tsx scripts/audit-email-delivery-backfill.mjs --fixture <path.json> [--json]
 */
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

import {
  buildEmailDeliveryIdempotencyKey,
  buildLegacyEmailDeliveryCandidate,
  hashEmailRecipient,
  resolveEmailDeliveryContextKey,
} from '../server/email-delivery-history.ts';
import {
  buildEmailBackfillAuditReport,
  buildSafeHistoricalEmailCandidateSummary,
  classifyProviderMessageCollision,
  fingerprint,
  hasHistoryByProviderMessageIdentity,
} from '../server/email-delivery-backfill-audit.ts';

const argv = process.argv.slice(2);

for (const forbidden of ['--apply', '--execute', '--write', '--force', '--commit']) {
  if (argv.includes(forbidden)) {
    console.error(`refused: ${forbidden} is not supported. This tool is read-only (Stage 1A) and cannot write.`);
    process.exit(2);
  }
}
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node --import tsx scripts/audit-email-delivery-backfill.mjs [--dry-run] [--fixture <path>] [--json]');
  console.log('READ ONLY. No --apply/--execute/--write path. DB access is a read-only transaction.');
  process.exit(0);
}
const asJson = argv.includes('--json');
const fixtureIdx = argv.indexOf('--fixture');
const fixturePath = fixtureIdx >= 0 ? argv[fixtureIdx + 1] : null;
const MIGRATION_WINDOW_MS = 24 * 60 * 60 * 1000;

for (const path of ['.env', '.env.local']) if (existsSync(path)) {
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !line.trim().startsWith('#')) {
      process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
}

function toIso(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Turn one raw state bundle into the sanitized audit report. Pure. */
function classifyState(state) {
  const auditsByRegistration = new Map();
  for (const audit of state.audits) {
    const list = auditsByRegistration.get(audit.registrationId) || [];
    list.push({ action: audit.action, payload: audit.payload, createdAt: toIso(audit.createdAt) });
    auditsByRegistration.set(audit.registrationId, list);
  }
  const existingKeys = new Set(state.existingDeliveries.map((d) => d.idempotencyKey));
  const existingByRegistration = new Set(state.existingDeliveries.map((d) => d.registrationId));
  const existingByProviderMessage = new Map();
  for (const d of state.existingDeliveries) {
    if (!d.providerMessageId) continue;
    const key = `${d.provider}:${d.providerMessageId}`;
    const list = existingByProviderMessage.get(key) || [];
    list.push(d);
    existingByProviderMessage.set(key, list);
  }

  const existingRows = state.existingDeliveries.map((d) => ({
    registrationId: d.registrationId,
    recipientHash: d.recipientHash,
    provider: d.provider,
    providerMessageId: d.providerMessageId,
  }));

  const candidates = [];
  let alreadyHasHistory = 0;
  let alreadyHasHistoryViaProviderMessage = 0;
  for (const reg of state.registrations) {
    const summary = {
      registrationId: reg.id,
      currentRecipientEmail: reg.currentRecipientEmail || '',
      provider: reg.provider,
      providerMessageId: reg.providerMessageId,
      sentAt: toIso(reg.sentAt),
      lastAttemptAt: toIso(reg.lastAttemptAt),
      error: reg.error,
    };
    const audits = auditsByRegistration.get(reg.id) || [];
    const candidate = buildLegacyEmailDeliveryCandidate(summary, audits);
    const idempotencyKey = candidate ? buildEmailDeliveryIdempotencyKey(candidate) : null;

    if (idempotencyKey && existingKeys.has(idempotencyKey)) { alreadyHasHistory += 1; continue; }

    if (candidate && hasHistoryByProviderMessageIdentity({
      candidateRegistrationId: reg.id,
      candidateRecipientHash: hashEmailRecipient(candidate.recipientEmail),
      candidateProvider: candidate.provider,
      candidateProviderMessageId: candidate.providerMessageId,
      existing: existingRows,
    })) { alreadyHasHistoryViaProviderMessage += 1; continue; }

    let collisionClass = 'NONE';
    if (candidate && candidate.providerMessageId) {
      const same = existingByProviderMessage.get(`${candidate.provider}:${candidate.providerMessageId}`) || [];
      collisionClass = classifyProviderMessageCollision({
        candidateRegistrationId: reg.id,
        candidateRecipientHash: hashEmailRecipient(candidate.recipientEmail),
        candidateContextKey: candidate.contextKey,
        candidateIdempotencyKey: idempotencyKey,
        existingSameProviderMessage: same.map((d) => ({
          registrationId: d.registrationId,
          recipientHash: d.recipientHash,
          contextKey: d.contextKey || resolveEmailDeliveryContextKey(d.recipientEmail || '', null),
          idempotencyKey: d.idempotencyKey,
        })),
      });
    }

    candidates.push(buildSafeHistoricalEmailCandidateSummary({
      registrationId: reg.id,
      summary,
      audits,
      historyRolloutAt: state.historyRolloutAt,
      migrationWindowMs: MIGRATION_WINDOW_MS,
      hasExistingIdempotency: false,
      hasExistingDeliveryForRegistration: existingByRegistration.has(reg.id),
      collisionClass,
    }));
  }

  return buildEmailBackfillAuditReport({
    registrationsTotal: state.registrationsTotal,
    legacyEmailState: state.registrations.length,
    alreadyHasHistory,
    alreadyHasHistoryViaProviderMessage,
    deliveryRows: state.existingDeliveries.length,
    historyRolloutAt: state.historyRolloutAt,
    candidates,
  });
}

async function loadProductionState() {
  if ((process.env.DATABASE_PROVIDER || '').toLowerCase() !== 'supabase' || !process.env.DATABASE_URL) {
    throw new Error('Supabase read-only target is not configured.');
  }
  const url = new URL(process.env.DATABASE_URL);
  if (!url.hostname.endsWith('.supabase.com')) throw new Error('Database target is not Supabase.');
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: (process.env.DATABASE_SSL || 'true') !== 'false' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  try {
    await client.query('begin transaction isolation level repeatable read read only');
    const identity = (await client.query('select current_database() db, current_schema() sch, now() snapshot_at')).rows[0];
    const registrationsTotal = Number((await client.query('select count(*)::int c from "run-registrations"')).rows[0].c);
    const registrations = (await client.query(
      `select id, payload->>'email' current_recipient_email, confirmation_email_provider provider,
              confirmation_email_id provider_message_id, confirmation_email_sent_at sent_at,
              confirmation_email_last_attempt_at last_attempt_at, confirmation_email_error error
         from "run-registrations"
        where confirmation_email_sent_at is not null or confirmation_email_id is not null or confirmation_email_error is not null`,
    )).rows.map((r) => ({
      id: r.id, currentRecipientEmail: r.current_recipient_email, provider: r.provider,
      providerMessageId: r.provider_message_id, sentAt: r.sent_at, lastAttemptAt: r.last_attempt_at, error: r.error,
    }));
    const audits = (await client.query(
      `select entity_id, action, payload, created_at from "run-audit-logs"
        where entity_type='registration'
          and (action like 'email.%' or action = 'registration.updated' or action like '%participant_transfer%'
               or action = 'registration.created_paid_manually')
        order by entity_id, created_at`,
    )).rows.map((r) => ({ registrationId: r.entity_id, action: r.action, payload: r.payload, createdAt: r.created_at }));
    const existingDeliveries = (await client.query(
      `select registration_id, recipient_email, recipient_hash, context_key, idempotency_key,
              provider, provider_message_id, attempted_at, created_at, metadata
         from "run-email-deliveries"`,
    )).rows.map((r) => ({
      registrationId: r.registration_id, recipientEmail: r.recipient_email, recipientHash: r.recipient_hash,
      contextKey: r.context_key, idempotencyKey: r.idempotency_key, provider: r.provider,
      providerMessageId: r.provider_message_id, attemptedAt: r.attempted_at, createdAt: r.created_at, metadata: r.metadata,
    }));

    // History rollout = earliest live (non-backfill) delivery timestamp, derived from data.
    const liveTimes = existingDeliveries
      .filter((d) => !(d.metadata && d.metadata.historical === true) && !(d.metadata && d.metadata.backfill === true))
      .map((d) => toIso(d.attemptedAt || d.createdAt))
      .filter(Boolean)
      .sort();
    const historyRolloutAt = liveTimes[0] || toIso(identity.snapshot_at);

    await client.query('rollback');
    return {
      mode: 'production',
      snapshotAt: toIso(identity.snapshot_at),
      target: { db: identity.db, schema: identity.sch, hostFingerprint: fingerprint(url.hostname) },
      registrationsTotal, registrations, audits, existingDeliveries, historyRolloutAt,
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

function loadFixtureState(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return {
    mode: 'fixture',
    snapshotAt: null,
    target: { db: 'fixture', schema: 'fixture', hostFingerprint: 'fixture' },
    registrationsTotal: raw.registrationsTotal ?? raw.registrations?.length ?? 0,
    registrations: raw.registrations || [],
    audits: raw.audits || [],
    existingDeliveries: raw.existingDeliveries || [],
    historyRolloutAt: raw.historyRolloutAt,
  };
}

const state = fixturePath ? loadFixtureState(fixturePath) : await loadProductionState();
const report = classifyState(state);
const envelope = {
  mode: state.mode,
  snapshotAt: state.snapshotAt,
  target: state.target,
  writes: 0,
  apiCalls: fixturePath ? [] : ['spreadsheets.get:none', 'db:SELECT-only'],
  report,
};

if (asJson) {
  console.log(JSON.stringify(envelope, null, 2));
} else {
  console.log(`mode=${envelope.mode} snapshotAt=${envelope.snapshotAt ?? 'n/a'} writes=0`);
  console.log(`historyRolloutAt=${report.historyRolloutAt}`);
  console.log(`totals ${JSON.stringify(report.totals)}`);
  console.log(`evidence ${JSON.stringify(report.evidence)}`);
  console.log(`gap ${JSON.stringify(report.gap)}`);
  console.log(`collision ${JSON.stringify(report.collision)}`);
  console.log(`plan ${JSON.stringify(report.plan)}`);
  console.log(`classificationFingerprint=${report.classificationFingerprint}`);
}
if (envelope.writes !== 0) { console.error('invariant violated: writes != 0'); process.exit(3); }
