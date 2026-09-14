// KIT-DELIVERY-EMAIL-001 — operational campaign: informs already-paid FunPace
// Run Experience participants of the kit-delivery date/time/place.
//
// Stage 1B (Human Architecture Gate: OPTION B — REQUIRE_MINIMAL_MIGRATION):
//   * `run-email-deliveries.kind` is widened to allow 'event_campaign'
//     alongside 'confirmation' (server/migrations/
//     20260914_email_deliveries_event_campaign_kind.sql) — a metadata-only
//     CHECK constraint swap, no rewrite, reversible.
//   * This campaign's delivery history lives on the CANONICAL
//     run-email-deliveries table now, under kind='event_campaign', so the
//     already-deployed Resend webhook lifecycle ingestion
//     (ingestResendWebhookEventInPostgres, which correlates purely by
//     `provider_message_id` and is NOT filtered by `kind`) correlates
//     sent/delivered/bounced automatically — zero webhook code changes.
//   * The claim/complete primitives (server/database.ts:
//     claimEventCampaignEmailInPostgres / completeEventCampaignEmailInPostgres)
//     are brand new and structurally isolated — they never reference
//     run-registrations.confirmation_email_* (unlike
//     claimRegistrationEmailInPostgres, which unconditionally writes
//     confirmation_email_last_attempt_at on every claim).
//   * Reuses the existing transport (sendEmailViaResend, extracted from
//     server/email.ts) and email-validity check (isPlausibleRecipientEmail,
//     already used by the confirmation-recovery flow).
import { isPlausibleRecipientEmail } from './confirmation-recovery.js';
import { escapeHtml, sendEmailViaResend, siteUrl, type EmailSendResult } from './email.js';

export const KIT_DELIVERY_CAMPAIGN_KEY = 'funpace-run-2026-kit-delivery';
export const EVENT_CAMPAIGN_KIND = 'event_campaign';
export const KIT_DELIVERY_IMAGE_PATH = '/email/kit-delivery-2026.jpg';

export function kitDeliveryImageUrl(): string {
  return `${siteUrl}${KIT_DELIVERY_IMAGE_PATH}`;
}

export const KIT_DELIVERY_IMAGE_ALT =
  'Entrega de kits FUNPACE Run Experience — 19 de setembro, das 11h às 20h, na ASICS Porto Velho Shopping';

/** First given name only, for a warm-but-not-presumptuous greeting. */
export function firstName(fullName: string): string {
  return (fullName || '').trim().split(/\s+/)[0] || 'Atleta';
}

export type KitDeliveryEmailContent = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};

/**
 * Pure template builder — no I/O, no registration/payment lookups beyond the
 * one field it needs (the athlete's first name). Deliberately does not state
 * anything the brief did not confirm (no document requirement, no pickup
 * authorization rule, no parking note, no giveaway, no extra time window).
 */
export function buildKitDeliveryEmailContent(input: { fullName: string }): KitDeliveryEmailContent {
  const subject = 'Entrega de kits — FUNPACE Run Experience';
  const preheader = 'Confira data, horário e local para retirada do seu kit.';
  const name = firstName(input.fullName);
  const imageUrl = kitDeliveryImageUrl();
  const ctaUrl = siteUrl;

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;background:#050505;color:#ffffff;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#09090b;border:1px solid #27272a;">
            <tr>
              <td style="padding:28px 28px 12px;">
                <img src="${siteUrl}/logo.jpeg" alt="FunPace" width="132" style="display:block;max-width:132px;height:auto;border:0;" />
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 0;">
                <p style="margin:0 0 14px;color:#d7ff00;font:800 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.16em;">Entrega de kits</p>
                <h1 style="margin:0;color:#ffffff;font:900 30px/1.05 Arial,sans-serif;text-transform:uppercase;">A FUNPACE Run Experience está chegando.</h1>
                <p style="margin:18px 0 0;color:#d4d4d8;font:400 16px/1.55 Arial,sans-serif;">Olá, ${escapeHtml(name)}! A entrega dos kits será realizada em:</p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 28px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;color:#000000;">
                  <tr>
                    <td style="padding:20px;">
                      <p style="margin:0;color:#000000;font:900 20px/1.3 Arial,sans-serif;text-transform:uppercase;">19 de setembro</p>
                      <p style="margin:6px 0 0;color:#000000;font:700 16px/1.4 Arial,sans-serif;">11h às 20h</p>
                      <p style="margin:6px 0 0;color:#000000;font:700 16px/1.4 Arial,sans-serif;">ASICS — Porto Velho Shopping</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 28px 0;">
                <img src="${imageUrl}" alt="${escapeHtml(KIT_DELIVERY_IMAGE_ALT)}" width="600" style="width:100%;max-width:600px;height:auto;display:block;border:0;" />
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 0;">
                <p style="margin:0;color:#d4d4d8;font:400 15px/1.6 Arial,sans-serif;"><strong style="color:#ffffff;">19 de setembro, das 11h às 20h, na ASICS Porto Velho Shopping.</strong> Guarde essa informação — te esperamos por lá.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px;">
                <a href="${ctaUrl}" style="display:inline-block;background:#d7ff00;color:#000000;text-decoration:none;font:900 13px Arial,sans-serif;text-transform:uppercase;letter-spacing:.12em;padding:16px 18px;">Ver informações do evento</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 30px;">
                <p style="margin:0;color:#ffffff;font:700 14px/1.5 Arial,sans-serif;">Nos vemos na entrega dos kits.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    'FUNPACE RUN EXPERIENCE',
    '',
    'ENTREGA DE KITS',
    '',
    `Olá, ${name}!`,
    '',
    '19 de setembro',
    '11h às 20h',
    'ASICS — Porto Velho Shopping',
    '',
    'Nos vemos em breve.',
    '',
    `Ver informações do evento: ${ctaUrl}`,
  ].join('\n');

  return { subject, preheader, html, text };
}

export type KitDeliveryEmailRecipient = {
  registrationId: string;
  fullName: string;
  email: string;
  /** the deliveryKey returned by claimEventCampaignEmailInPostgres, used as the Resend Idempotency-Key. */
  deliveryKey: string;
};

/**
 * The ONLY effective-status/email-shape rules this campaign applies. Kept
 * pure and separate from any DB read so the eligibility contract is testable
 * without Postgres — mirrors assessConfirmationRecovery's split between a
 * pure assessment function and its Postgres-reading loader.
 */
export type KitDeliveryCandidate = {
  registrationId: string;
  /** the EFFECTIVE status, already resolved the same way toAdminRow does. */
  effectiveStatus: string;
  canonicalEmail: string | null;
};

export type KitDeliveryEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'not_paid' | 'invalid_email' };

export function assessKitDeliveryEligibility(candidate: KitDeliveryCandidate): KitDeliveryEligibility {
  if (candidate.effectiveStatus !== 'paid') return { eligible: false, reason: 'not_paid' };
  if (!isPlausibleRecipientEmail(candidate.canonicalEmail)) return { eligible: false, reason: 'invalid_email' };
  return { eligible: true };
}

/** Sends ONE kit-delivery campaign email via the shared Resend transport. */
export async function sendKitDeliveryEmail(recipient: KitDeliveryEmailRecipient): Promise<EmailSendResult> {
  const content = buildKitDeliveryEmailContent({ fullName: recipient.fullName });
  return sendEmailViaResend({
    to: recipient.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    deliveryKey: recipient.deliveryKey,
    logKind: EVENT_CAMPAIGN_KIND,
    logContext: { registrationId: recipient.registrationId, campaignKey: KIT_DELIVERY_CAMPAIGN_KEY },
  });
}
