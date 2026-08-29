/**
 * RELEASE-05 Stage 2A — guarded historical email backfill executor (DORMANT).
 *
 * Write-capable, but incapable of running by accident. It refuses to apply
 * unless ALL of these are present:
 *   --apply
 *   --approved-plan <sha256 plan fingerprint>       (matched against a freshly
 *                                                    recomputed plan; no fixed
 *                                                    constant is versioned)
 *   --confirm APPLY_APPROVED_EMAIL_HISTORY_BACKFILL
 *   env EMAIL_HISTORY_BACKFILL_ENVIRONMENT=production
 *
 * Default mode is --dry-run: a read-only transaction that prints the sanitized
 * plan and its fingerprint. It never sends email, never calls a provider, never
 * touches an outbox, never updates the legacy summary and never writes an audit
 * row. It only ever INSERTs append-only rows into public."run-email-deliveries"
 * (ON CONFLICT DO NOTHING). UNRESOLVED / AMBIGUOUS / CONFLICT / provider-collision
 * candidates are excluded by construction.
 *
 * This CLI is NOT invoked against production in Stage 2A.
 */
import { existsSync, readFileSync } from 'node:fs';

import {
  buildApprovedBackfillPlan,
  buildBackfillRollbackStatement,
  buildHistoricalDeliveryInsertRows,
  buildHistoricalDeliveryInsertStatement,
  deriveBackfillBatchId,
  EMAIL_HISTORY_BACKFILL_APPLY_CONFIRMATION,
  EMAIL_HISTORY_BACKFILL_ENV_GATE,
  precheckProviderCollisions,
  sanitizePlan,
} from '../server/email-delivery-backfill-execution.ts';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };

if (has('--help') || has('-h')) {
  console.log('Usage:');
  console.log('  node --import tsx scripts/apply-email-delivery-backfill.mjs --dry-run [--json]');
  console.log('  node --import tsx scripts/apply-email-delivery-backfill.mjs --fixture <path> [--json]');
  console.log('  node --import tsx scripts/apply-email-delivery-backfill.mjs --apply --approved-plan <sha256> \\');
  console.log(`      --confirm ${EMAIL_HISTORY_BACKFILL_APPLY_CONFIRMATION}   (requires EMAIL_HISTORY_BACKFILL_ENVIRONMENT=${EMAIL_HISTORY_BACKFILL_ENV_GATE})`);
  process.exit(0);
}

const asJson = has('--json');
const fixturePath = valueOf('--fixture');
const mode = has('--apply') ? 'apply' : 'dry-run';

// Authorization gates are checked FIRST, before any database configuration is
// read or any client is imported. `--apply` cannot proceed without all of them.
if (mode === 'apply') {
  const approvedPlan = valueOf('--approved-plan');
  if (!approvedPlan || !/^[0-9a-f]{64}$/.test(approvedPlan)) {
    console.error('refused: --apply requires --approved-plan <sha256 plan fingerprint>.');
    process.exit(2);
  }
  if (valueOf('--confirm') !== EMAIL_HISTORY_BACKFILL_APPLY_CONFIRMATION) {
    console.error(`refused: --apply requires --confirm ${EMAIL_HISTORY_BACKFILL_APPLY_CONFIRMATION}.`);
    process.exit(2);
  }
  if (process.env.EMAIL_HISTORY_BACKFILL_ENVIRONMENT !== EMAIL_HISTORY_BACKFILL_ENV_GATE) {
    console.error(`refused: --apply requires EMAIL_HISTORY_BACKFILL_ENVIRONMENT=${EMAIL_HISTORY_BACKFILL_ENV_GATE}.`);
    process.exit(2);
  }
}

for (const p of ['.env', '.env.local']) if (!fixturePath && existsSync(p)) {
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !line.trim().startsWith('#')) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}

function toIso(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function shapeCandidates(state) {
  return {
    candidates: state.registrations.map((reg) => ({
      registrationId: reg.id,
      summary: {
        registrationId: reg.id,
        currentRecipientEmail: reg.currentRecipientEmail || '',
        provider: reg.provider,
        providerMessageId: reg.providerMessageId,
        sentAt: toIso(reg.sentAt),
        lastAttemptAt: toIso(reg.lastAttemptAt),
        error: reg.error,
      },
      audits: (state.auditsByRegistration[reg.id] || []).map((a) => ({
        action: a.action, payload: a.payload, createdAt: toIso(a.createdAt),
      })),
    })),
    existing: state.existingDeliveries,
  };
}

// --- fixture (offline, no DB) -------------------------------------------------
if (fixturePath) {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const byReg = {};
  for (const a of raw.audits || []) { (byReg[a.registrationId] ??= []).push(a); }
  const plan = buildApprovedBackfillPlan(shapeCandidates({
    registrations: raw.registrations || [],
    auditsByRegistration: byReg,
    existingDeliveries: raw.existingDeliveries || [],
  }));
  const sanitized = sanitizePlan(plan);
  const batchId = deriveBackfillBatchId(plan.planFingerprint, '2026-01-01');
  const rows = buildHistoricalDeliveryInsertRows(plan.eligible, batchId, '2026-01-01T00:00:00.000Z');
  const statement = buildHistoricalDeliveryInsertStatement(rows);
  const output = {
    mode: 'fixture-dry-run', writes: 0,
    plan: sanitized,
    statementPreview: { hasOnConflictDoNothing: statement.text.includes('on conflict (idempotency_key) do nothing'), expectedInserts: statement.expectedInserts, params: statement.params.length },
    rollbackPreview: plan.eligible.length > 0
      ? { expectedDeletes: buildBackfillRollbackStatement({ batchId, idempotencyKeys: plan.eligible.map((c) => c.idempotencyKey) }).expectedDeletes }
      : { expectedDeletes: 0 },
  };
  console.log(asJson ? JSON.stringify(output, null, 2) : JSON.stringify(sanitized));
  process.exit(0);
}

// --- database modes --------------------------------------------------------
async function loadState(client) {
  await client.query(mode === 'apply'
    ? 'begin transaction isolation level serializable'
    : 'begin transaction isolation level repeatable read read only');
  if (mode === 'apply') {
    await client.query("select pg_advisory_xact_lock(hashtext('funpace-email-history-backfill'))");
  }
  const identity = (await client.query('select current_database() db, current_schema() sch, now() at')).rows[0];
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
  const auditRows = (await client.query(
    `select entity_id, action, payload, created_at from "run-audit-logs"
      where entity_type='registration'
        and (action like 'email.%' or action = 'registration.updated'
             or action like '%participant_transfer%' or action = 'registration.created_paid_manually')
      order by entity_id, created_at`,
  )).rows;
  const auditsByRegistration = {};
  for (const a of auditRows) { (auditsByRegistration[a.entity_id] ??= []).push({ action: a.action, payload: a.payload, createdAt: a.created_at }); }
  const existingDeliveries = (await client.query(
    `select registration_id, recipient_hash, provider, provider_message_id, idempotency_key from "run-email-deliveries"`,
  )).rows.map((r) => ({
    registrationId: r.registration_id, recipientHash: r.recipient_hash, provider: r.provider,
    providerMessageId: r.provider_message_id, idempotencyKey: r.idempotency_key,
  }));
  return { identity, registrations, auditsByRegistration, existingDeliveries };
}

const { default: pg } = await import('pg');
if ((process.env.DATABASE_PROVIDER || '').toLowerCase() !== 'supabase' || !process.env.DATABASE_URL) {
  console.error('Supabase target is not configured.');
  process.exit(1);
}
const url = new URL(process.env.DATABASE_URL);
if (!url.hostname.endsWith('.supabase.com')) { console.error('Database target is not Supabase.'); process.exit(1); }

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_SSL || 'true') !== 'false' ? { rejectUnauthorized: false } : false,
});
await client.connect();
let writes = 0;
try {
  const state = await loadState(client);
  const plan = buildApprovedBackfillPlan(shapeCandidates(state));
  const sanitized = sanitizePlan(plan);

  if (mode === 'dry-run') {
    await client.query('rollback');
    const out = {
      mode: 'DRY RUN', writes: 0,
      snapshotAt: toIso(state.identity.at),
      target: { db: state.identity.db, schema: state.identity.sch },
      plan: sanitized,
      alreadyExisting: plan.excluded.alreadyHasHistory,
      providerCollisions: plan.excluded.providerCollision,
      plannedInserts: plan.eligible.length,
      unresolvedExcluded: plan.excluded.notRecoverable,
      expectedInserts: plan.eligible.length,
      expectedUpdates: 0,
      expectedDeletes: 0,
    };
    console.log(asJson ? JSON.stringify(out, null, 2) : JSON.stringify(sanitized));
    process.exit(0);
  }

  // --- apply (gated; not exercised against production in Stage 2A) ----------
  const approvedPlan = valueOf('--approved-plan');
  if (plan.planFingerprint !== approvedPlan) {
    await client.query('rollback');
    console.error(`STOP: plan fingerprint mismatch. current=${plan.planFingerprint} approved=${approvedPlan}`);
    process.exit(3);
  }
  const collision = precheckProviderCollisions(plan.eligible, state.existingDeliveries);
  if (!collision.ok) {
    await client.query('rollback');
    console.error(`STOP: provider-message collision on ${collision.conflicts.length} candidate(s).`);
    process.exit(3);
  }
  const recordedAt = toIso(state.identity.at);
  const batchId = deriveBackfillBatchId(plan.planFingerprint, recordedAt);
  const rows = buildHistoricalDeliveryInsertRows(plan.eligible, batchId, recordedAt);
  const statement = buildHistoricalDeliveryInsertStatement(rows);
  const result = await client.query(statement.text, statement.params);
  writes = result.rowCount || 0;

  const post = (await client.query(
    `select idempotency_key from "run-email-deliveries" where metadata->>'backfillBatchId' = $1`,
    [batchId],
  )).rows.map((r) => r.idempotency_key);
  const allPresent = rows.every((row) => post.includes(row.idempotency_key));
  const idempotentRerun = writes === 0 && allPresent;
  const expectedFresh = writes === statement.expectedInserts && allPresent;
  if (!idempotentRerun && !expectedFresh) {
    await client.query('rollback');
    console.error(`ROLLBACK: unexpected inserted count. inserted=${writes} expected=${statement.expectedInserts}`);
    process.exit(3);
  }
  await client.query('commit');
  console.log(JSON.stringify({
    mode: 'APPLY',
    verdict: idempotentRerun ? 'IDEMPOTENT_NOOP' : 'APPLIED',
    batchId,
    planFingerprint: plan.planFingerprint,
    inserted: writes,
    expectedInserts: statement.expectedInserts,
    expectedUpdates: 0,
    expectedDeletes: 0,
    destinationBatchCount: post.length,
  }, null, 2));
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
if (mode !== 'apply' && writes !== 0) { console.error('invariant violated: dry-run wrote'); process.exit(4); }
