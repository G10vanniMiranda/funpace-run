import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  buildKitDeliveryEmailContent,
  kitDeliveryImageUrl,
  KIT_DELIVERY_IMAGE_ALT,
  KIT_DELIVERY_CAMPAIGN_KEY,
  EVENT_CAMPAIGN_KIND,
  assessKitDeliveryEligibility,
  firstName,
} from '../server/kit-delivery-email.js';
import {
  runKitDeliveryCampaignBatch,
  KIT_DELIVERY_BATCH_SIZE,
  KIT_DELIVERY_CONCURRENCY,
  KIT_DELIVERY_MAX_CONSECUTIVE_FAILURES,
  KIT_DELIVERY_REQUIRES_EXPLICIT_EXECUTION,
} from '../server/kit-delivery-campaign.js';
import type { EventCampaignAudienceEntry, EventCampaignClaimResult, EventCampaignCompleteResult } from '../server/database.js';

const AUDIT = { actor: 'system:kit-delivery-test', actorRole: 'administrator', sessionId: null, ipAddress: null, userAgent: 'test' };

// --- P: template content, absolute image URL, alt, text version ------------

test('P. template contains the date, time and place', () => {
  const content = buildKitDeliveryEmailContent({ fullName: 'Maria da Silva' });
  for (const needle of ['19 de setembro', '11h às 20h', 'ASICS', 'Porto Velho Shopping']) {
    assert.ok(content.html.includes(needle), `html missing "${needle}"`);
    assert.ok(content.text.includes(needle), `text missing "${needle}"`);
  }
});

test('P. the image is referenced by an absolute URL, never base64/CID/relative, with the specified ALT', () => {
  const url = kitDeliveryImageUrl();
  assert.equal(url, 'https://www.funpace.club/email/kit-delivery-2026.jpg');
  const content = buildKitDeliveryEmailContent({ fullName: 'Maria da Silva' });
  assert.ok(content.html.includes(`src="${url}"`));
  assert.ok(!content.html.includes('data:image'));
  assert.ok(!content.html.includes('cid:'));
  assert.match(content.html, /max-width:600px;height:auto;display:block;border:0/);
  assert.equal(KIT_DELIVERY_IMAGE_ALT, 'Entrega de kits FUNPACE Run Experience — 19 de setembro, das 11h às 20h, na ASICS Porto Velho Shopping');
  assert.ok(content.html.includes(`alt="${KIT_DELIVERY_IMAGE_ALT.replace(/&/g, '&amp;')}"`));
});

test('P. a text/plain version is available and carries the same key facts, subject/preheader match, no invented policy', () => {
  const content = buildKitDeliveryEmailContent({ fullName: 'Maria da Silva Santos' });
  assert.ok(content.text.length > 0);
  assert.ok(!content.text.includes('<'), 'text/plain must not contain HTML markup');
  assert.equal(content.subject, 'Entrega de kits — FUNPACE Run Experience');
  assert.equal(content.preheader, 'Confira data, horário e local para retirada do seu kit.');
  assert.ok(content.html.includes('Olá, Maria!'));
  assert.equal(firstName('  '), 'Atleta');
  for (const forbidden of ['documento', 'autoriza', 'estacionamento', 'brinde']) {
    assert.ok(!content.html.toLowerCase().includes(forbidden), `unexpectedly mentions "${forbidden}"`);
  }
  assert.match(content.html, /href="https:\/\/www\.funpace\.club"/);
});

// --- N/O: audience contract (pure eligibility) ------------------------------

test('N. an unpaid registration never enters the cohort', () => {
  for (const status of ['pending_payment', 'expired', 'payment_failed', 'cancelled', 'refunded']) {
    const result = assessKitDeliveryEligibility({ registrationId: 'r1', effectiveStatus: status, canonicalEmail: 'a@b.com' });
    assert.equal(result.eligible, false);
    assert.equal((result as { reason: string }).reason, 'not_paid');
  }
  assert.equal(assessKitDeliveryEligibility({ registrationId: 'r1', effectiveStatus: 'paid', canonicalEmail: 'a@b.com' }).eligible, true);
});

test('O. an invalid/implausible email never enters the cohort', () => {
  for (const email of [null, '', 'not-an-email', 'a@b', 'a@@b.com', '@b.com', 'a@b.', 'a@.b.com']) {
    const result = assessKitDeliveryEligibility({ registrationId: 'r1', effectiveStatus: 'paid', canonicalEmail: email });
    assert.equal(result.eligible, false, `expected ${JSON.stringify(email)} to be rejected`);
    assert.equal((result as { reason: string }).reason, 'invalid_email');
  }
  assert.equal(assessKitDeliveryEligibility({ registrationId: 'r1', effectiveStatus: 'paid', canonicalEmail: 'athlete@example.com' }).eligible, true);
});

// --- A/B: migration file itself ---------------------------------------------

test('A/B. the migration file swaps the kind CHECK to allow confirmation AND event_campaign', () => {
  const sql = readFileSync(new URL('../server/migrations/20260914_email_deliveries_event_campaign_kind.sql', import.meta.url), 'utf8');
  assert.match(sql, /drop constraint if exists "run-email-deliveries_kind_check"/);
  assert.match(sql, /add constraint "run-email-deliveries_kind_check"\s*\n\s*check \(kind in \('confirmation', 'event_campaign'\)\)/);
  // no new column, no index, no data rewrite statement
  assert.ok(!/add column/i.test(sql));
  assert.ok(!/create index|create unique index/i.test(sql));
  assert.ok(!/update\s+"?run-email-deliveries"?\s+set/i.test(sql), 'must not rewrite existing rows');
});

test('reference schema dump (supabase-schema.sql) and the runtime bootstrap DDL stay in sync with the migration', () => {
  const schemaDump = readFileSync(new URL('../server/supabase-schema.sql', import.meta.url), 'utf8');
  assert.match(schemaDump, /kind text not null check \(kind in \('confirmation', 'event_campaign'\)\)/);
  const databaseSource = readFileSync(new URL('../server/database.ts', import.meta.url), 'utf8');
  assert.match(databaseSource, /kind text not null check \(kind in \('confirmation', 'event_campaign'\)\)/);
});

// --- D/E/F/G: isolated primitives — source-slice proof ----------------------

const databaseSource = readFileSync(new URL('../server/database.ts', import.meta.url), 'utf8');
const kitEmailSource = readFileSync(new URL('../server/kit-delivery-email.ts', import.meta.url), 'utf8');

function extractFunction(source: string, name: string, span = 6000): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  return source.slice(start, start + span)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

test('D. claimRegistrationEmailInPostgres / completeRegistrationEmailInPostgres are untouched by this stage', () => {
  // the confirmation primitives keep writing kind='confirmation' literally, unparametrised
  assert.match(databaseSource, /values \(\$1,\$2,'confirmation',\$3,\$4,\$5,\$6,\$7,null,'attempting',1,\$8,null,null,null,\$9,\$8,\$8\)/);
  // and this new campaign code never calls into them
  const eventCampaignSection = databaseSource.slice(databaseSource.indexOf('// KIT-DELIVERY-EMAIL-001 Stage 1B'));
  assert.ok(!eventCampaignSection.includes('claimRegistrationEmailInPostgres('));
  assert.ok(!eventCampaignSection.includes('completeRegistrationEmailInPostgres('));
});

test('E. claimEventCampaignEmailInPostgres creates a run-email-deliveries row with kind=event_campaign', () => {
  const src = extractFunction(databaseSource, 'claimEventCampaignEmailInPostgres', 8000);
  assert.ok(src.includes('table.emailDeliveries'));
  assert.ok(src.includes("'event_campaign'"));
  assert.ok(src.includes('insert into'));
});

test('F. campaign completion never touches run-registrations / confirmation_* fields', () => {
  const claimSrc = extractFunction(databaseSource, 'claimEventCampaignEmailInPostgres', 8000);
  const completeSrc = extractFunction(databaseSource, 'completeEventCampaignEmailInPostgres', 6000);
  for (const src of [claimSrc, completeSrc]) {
    for (const forbidden of [
      'confirmation_email_id', 'confirmation_email_sent_at', 'confirmation_email_error', 'confirmation_email_last_attempt_at',
    ]) {
      assert.ok(!src.includes(forbidden), `${forbidden} must never appear`);
    }
  }
  // completeEventCampaignEmailInPostgres has NO write against run-registrations at all
  assert.ok(!/\$\{table\.registrations\}\s*\n?\s*set/i.test(completeSrc), 'completion must never UPDATE run-registrations');
  // and it guards its own UPDATE with kind='event_campaign' so it can never complete a confirmation row
  assert.match(completeSrc, /where id = \$6 and kind = 'event_campaign'/);
});

test('G. provider_message_id is persisted on completion', () => {
  const completeSrc = extractFunction(databaseSource, 'completeEventCampaignEmailInPostgres', 6000);
  assert.ok(completeSrc.includes('provider_message_id'));
});

test('claim never writes confirmation_email_last_attempt_at (the field claimRegistrationEmailInPostgres writes unconditionally)', () => {
  const claimSrc = extractFunction(databaseSource, 'claimEventCampaignEmailInPostgres', 8000);
  assert.ok(!/\$\{table\.registrations\}\s*\n?\s*set/i.test(claimSrc), 'claim must never UPDATE run-registrations (only SELECT ... FOR UPDATE to lock it)');
});

test('the transport is reused from email.ts, not duplicated', () => {
  assert.ok(kitEmailSource.includes('import { escapeHtml, sendEmailViaResend, siteUrl'));
  assert.ok(!kitEmailSource.includes('resend.com/emails'));
});

// --- H/I: webhook correlation is kind-agnostic (proves campaign deliveries
// are found automatically without any webhook code change) -----------------

test('H/I. the webhook correlation query has no kind filter — event_campaign rows correlate exactly like confirmation rows', () => {
  const ingestSrc = extractFunction(databaseSource, 'ingestResendWebhookEventInPostgres', 4000);
  assert.match(ingestSrc, /select id, registration_id, recipient_hash\s+from \$\{table\.emailDeliveries\}\s+where provider = 'resend' and provider_message_id = \$1/);
  assert.ok(!ingestSrc.includes("kind ="), 'the correlation query must not filter by kind — this is what makes it work for event_campaign with zero changes');
});

// --- J: alert routing is also kind-agnostic --------------------------------

test('J. bounce/complaint/suppressed alert routing does not filter by kind — a correlated event_campaign delivery gets the real lifecycle alert, not unknown-message', () => {
  const indexSource = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');
  const webhookHandlerStart = indexSource.indexOf('async function handleResendWebhook(');
  const webhookHandler = indexSource.slice(webhookHandlerStart, webhookHandlerStart + 4000);
  assert.ok(webhookHandler.includes("outcome === 'uncorrelated'"), 'unknown-message alert only fires when uncorrelated');
  assert.ok(webhookHandler.includes('email_lifecycle_bounce'));
  // `normalized.kind` in this handler is the WEBHOOK PAYLOAD classification
  // (ignored vs lifecycle event) — an unrelated field name collision with
  // run-email-deliveries.kind. What actually matters: the alert-routing
  // logic never references the delivery kind values themselves.
  assert.ok(!webhookHandler.includes("'confirmation'") && !webhookHandler.includes("'event_campaign'"), 'alert routing must not gate on the delivery kind value');
});

// --- K/L/M: idempotency + concurrency + retry, at the orchestration
// contract level (true DB-level concurrency is proven at homolog) ----------

function fakeAudienceEntry(id: string): EventCampaignAudienceEntry {
  return { registrationId: id, fullName: `Athlete ${id}`, email: `${id}@example.com` };
}
function okClaim(deliveryId: string, registrationId: string): EventCampaignClaimResult {
  return { status: 'ok', deliveryId, recipientEmail: `${registrationId}@example.com`, fullName: 'Athlete', contextKey: `event-campaign:${KIT_DELIVERY_CAMPAIGN_KEY}:${registrationId}:hash`, deliveryKey: `event-campaign/${registrationId}/${deliveryId}` };
}

test('K. idempotency: a claim result other than "ok" is never sent, and never double-sent on a repeat pass', async () => {
  const sent: string[] = [];
  const claimedIds = new Set<string>();
  const claim = async (input: { registrationId: string }): Promise<EventCampaignClaimResult> => {
    if (claimedIds.has(input.registrationId)) return { status: 'already_sent' };
    claimedIds.add(input.registrationId);
    return okClaim(`d-${input.registrationId}`, input.registrationId);
  };
  const send = async (r: { registrationId: string }) => { sent.push(r.registrationId); return { ok: true, provider: 'resend', providerMessageId: `pmid-${r.registrationId}` }; };
  const completed: unknown[] = [];
  const complete = async (deliveryId: string): Promise<EventCampaignCompleteResult> => { completed.push(deliveryId); return { status: 'ok', delivered: true, registrationId: 'r1' }; };

  const recipients = [fakeAudienceEntry('r1')];
  const first = await runKitDeliveryCampaignBatch({ recipients, audit: AUDIT, dependencies: { claim, complete, send } });
  assert.equal(first.sent, 1);
  assert.deepEqual(sent, ['r1']);
  assert.equal(completed.length, 1);

  const second = await runKitDeliveryCampaignBatch({ recipients, audit: AUDIT, dependencies: { claim, complete, send } });
  assert.equal(second.sent, 0);
  assert.equal(second.skipped, 1);
  assert.equal(second.rows[0].outcome, 'skipped');
  assert.deepEqual(sent, ['r1'], 'send must not be called a second time for the same registration');
});

test('L. two "concurrent" claims for the same registration: only one proceeds to send (orchestration never races itself — sequential by design; true DB-level exclusivity is proven at homolog)', async () => {
  let claimCount = 0;
  const claim = async (input: { registrationId: string }): Promise<EventCampaignClaimResult> => {
    claimCount += 1;
    return claimCount === 1 ? okClaim('d1', input.registrationId) : { status: 'in_progress' };
  };
  const send = async () => ({ ok: true, provider: 'resend', providerMessageId: 'pmid' });
  const complete = async (): Promise<EventCampaignCompleteResult> => ({ status: 'ok', delivered: true, registrationId: 'r1' });

  // same registration appears twice in one batch slice (a caller bug / duplicate audience row) —
  // the SECOND claim call must find the row still 'attempting' and be told in_progress, not send twice.
  const recipients = [fakeAudienceEntry('r1'), fakeAudienceEntry('r1')];
  const result = await runKitDeliveryCampaignBatch({ recipients, audit: AUDIT, dependencies: { claim, complete, send } });
  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 1);
});

test('M. a failed attempt can be resumed safely on the next pass', async () => {
  let attempt = 0;
  const claim = async (input: { registrationId: string }): Promise<EventCampaignClaimResult> => {
    attempt += 1;
    return okClaim('d1', input.registrationId); // "latest wins": claim succeeds again after a failure
  };
  const send = async () => (attempt === 1 ? { ok: false, provider: 'resend', error: 'simulated transient error' } : { ok: true, provider: 'resend', providerMessageId: 'pmid-retry' });
  const completedResults: Array<{ ok: boolean }> = [];
  const complete = async (_id: string, result: { ok: boolean }): Promise<EventCampaignCompleteResult> => { completedResults.push(result); return { status: 'ok', delivered: result.ok, registrationId: 'r1' }; };

  const recipients = [fakeAudienceEntry('r1')];
  const first = await runKitDeliveryCampaignBatch({ recipients, audit: AUDIT, dependencies: { claim, complete, send } });
  assert.equal(first.failed, 1);
  const second = await runKitDeliveryCampaignBatch({ recipients, audit: AUDIT, dependencies: { claim, complete, send } });
  assert.equal(second.sent, 1);
  assert.deepEqual(completedResults.map((r) => r.ok), [false, true]);
});

test('a single failed row never crashes the batch, and the batch stops after N consecutive systemic failures', async () => {
  const claim = async (input: { registrationId: string }): Promise<EventCampaignClaimResult> => okClaim(`d-${input.registrationId}`, input.registrationId);
  const send = async () => ({ ok: false, provider: 'resend', error: 'simulated provider outage' });
  const complete = async (): Promise<EventCampaignCompleteResult> => ({ status: 'ok', delivered: false, registrationId: 'r' });
  const recipients = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'].map(fakeAudienceEntry);
  const result = await runKitDeliveryCampaignBatch({ recipients, audit: AUDIT, maxConsecutiveFailures: 3, dependencies: { claim, complete, send } });
  assert.equal(result.stoppedEarly, true);
  assert.equal(result.stopReason, 'max_consecutive_failures');
  assert.equal(result.failed, 3);
  assert.equal(result.attempted, 3);
});

test('batch strategy constants are declared as documented, and explicit execution is required', () => {
  assert.equal(KIT_DELIVERY_BATCH_SIZE, 25);
  assert.equal(KIT_DELIVERY_CONCURRENCY, 1);
  assert.equal(KIT_DELIVERY_MAX_CONSECUTIVE_FAILURES, 5);
  assert.equal(KIT_DELIVERY_REQUIRES_EXPLICIT_EXECUTION, true);
});

test('campaign kind and key constants are exactly the documented values', () => {
  assert.equal(EVENT_CAMPAIGN_KIND, 'event_campaign');
  assert.equal(KIT_DELIVERY_CAMPAIGN_KEY, 'funpace-run-2026-kit-delivery');
});
