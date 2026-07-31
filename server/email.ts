import QRCode from 'qrcode';
import type { EventRecord, LotRecord, RegistrationRecord } from './database.js';
import { isEmailDeliveryAllowed, isEmailRecipientAllowed } from './environment.js';

export type RegistrationEmailContext = {
  registration: RegistrationRecord;
  event: EventRecord;
  distanceName: string;
  lot: LotRecord | null;
  paymentMethod?: string | null;
  deliveryKey?: string;
};

export type EmailSendResult = {
  ok: boolean;
  skipped?: boolean;
  provider: string;
  providerMessageId?: string;
  error?: string;
};

const emailProvider = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
const resendApiKey = process.env.RESEND_API_KEY || '';
const emailFrom = process.env.EMAIL_FROM || '';
const emailReplyTo = process.env.EMAIL_REPLY_TO || emailFrom;
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_URL || 'https://www.funpace.club').replace(/\/$/, '');
const whatsappNumber = (process.env.VITE_WHATSAPP_NUMBER || '').replace(/\D/g, '');

export function getEmailProvider() {
  return emailProvider || 'not_configured';
}

export function isEmailEnabled() {
  return isEmailDeliveryAllowed() && (emailProvider === 'resend' || emailProvider === 'console');
}

export function isEmailConfigured() {
  if (!isEmailDeliveryAllowed()) return false;
  if (emailProvider === 'console') return true;
  if (emailProvider === 'resend') return Boolean(resendApiKey && emailFrom);
  return false;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatCurrency(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatEventDate(date: string) {
  const parsedDate = new Date(`${date}T00:00:00-04:00`);
  if (Number.isNaN(parsedDate.getTime())) return date;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Manaus',
  }).format(parsedDate);
}

function formatDateTime(date: string | null | undefined) {
  if (!date) return 'Confirmado';
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return date;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Manaus',
  }).format(parsedDate);
}

function getEventLocation(event: EventRecord) {
  return event.locationName?.trim()
    ? `${event.locationName} - ${event.city}/${event.state}`
    : 'Local a definir';
}

async function buildRegistrationConfirmationEmail(context: RegistrationEmailContext) {
  const { registration, event, distanceName, lot } = context;
  const athleteName = registration.payload.fullName;
  const registrationCode = registration.bibNumber || registration.id;
  const qrCodeDataUrl = await QRCode.toDataURL(registrationCode, { margin: 1, width: 180 });
  const subject = 'Inscrição confirmada | FunPace Run';
  const intro = 'Pagamento aprovado. Sua vaga na FunPace Run Experience está garantida.';
  const whatsappUrl = whatsappNumber
    ? `https://wa.me/55${whatsappNumber}?text=${encodeURIComponent(`Ola, preciso de suporte sobre minha inscricao ${registration.id} na FunPace Run.`)}`
    : '';
  const details = [
    ['Atleta', athleteName],
    ['Número da inscrição', registrationCode],
    ['Código da inscrição', registration.id],
    ['Evento', event.name],
    ['Distância', distanceName],
    ['Lote', lot?.name || registration.lotId],
    ['Tamanho da camisa', registration.payload.shirtSize],
    ['Valor pago', formatCurrency(registration.amountCents)],
    ['Data da confirmação', formatDateTime(registration.confirmedAt || registration.paidAt)],
    ['Forma de pagamento', context.paymentMethod || 'Pagamento aprovado pelo gateway'],
    ['Status', 'INSCRIÇÃO CONFIRMADA'],
    ['Data do evento', formatEventDate(event.date)],
    ['Horário do evento', event.startTime],
    ['Local do evento', getEventLocation(event)],
  ];
  const rowsHtml = details.map(([label, value]) => `
    <tr>
      <td style="padding:12px 0;color:#71717a;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #27272a;">${escapeHtml(label)}</td>
      <td style="padding:12px 0;color:#ffffff;font:600 14px Arial,sans-serif;text-align:right;border-bottom:1px solid #27272a;">${escapeHtml(value)}</td>
    </tr>
  `).join('');

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;background:#050505;color:#ffffff;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(intro)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#09090b;border:1px solid #27272a;">
            <tr>
              <td style="padding:28px 28px 12px;">
                <img src="${siteUrl}/logo.jpeg" alt="FunPace" width="132" style="display:block;max-width:132px;height:auto;border:0;" />
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 0;">
                <p style="margin:0 0 14px;color:#d7ff00;font:800 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.16em;">Inscrição confirmada</p>
                <h1 style="margin:0;color:#ffffff;font:900 34px/0.95 Arial,sans-serif;text-transform:uppercase;">Sua inscrição está confirmada.</h1>
                <p style="margin:20px 0 0;color:#d4d4d8;font:400 16px/1.55 Arial,sans-serif;">Olá, ${escapeHtml(athleteName)}. ${escapeHtml(intro)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px 8px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  ${rowsHtml}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;color:#000000;">
                  <tr>
                    <td style="padding:18px;vertical-align:middle;">
                      <p style="margin:0;color:#000000;font:900 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.12em;">Código para identificação</p>
                      <p style="margin:8px 0 0;color:#000000;font:900 24px Arial,sans-serif;">${escapeHtml(registrationCode)}</p>
                    </td>
                    <td align="right" style="padding:18px;width:150px;">
                      <img src="${qrCodeDataUrl}" alt="QR Code da inscrição" width="132" height="132" style="display:block;border:0;" />
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 28px 0;">
                <p style="margin:0;color:#d4d4d8;font:400 15px/1.6 Arial,sans-serif;">A retirada do kit terá local, data e horário divulgados nos canais oficiais da FunPace. Leve este código ou QR Code quando solicitado pela organização.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px;">
                <a href="${siteUrl}/regulamento" style="display:inline-block;background:#d7ff00;color:#000000;text-decoration:none;font:900 13px Arial,sans-serif;text-transform:uppercase;letter-spacing:.12em;padding:16px 18px;">Ver regulamento</a>
                <a href="${siteUrl}/privacidade" style="display:inline-block;margin-left:8px;color:#ffffff;text-decoration:none;font:900 13px Arial,sans-serif;text-transform:uppercase;letter-spacing:.12em;padding:16px 0;">Política de privacidade</a>
                ${whatsappUrl ? `<a href="${whatsappUrl}" style="display:inline-block;margin-left:8px;color:#ffffff;text-decoration:none;font:900 13px Arial,sans-serif;text-transform:uppercase;letter-spacing:.12em;padding:16px 0;">Suporte WhatsApp</a>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 30px;">
                <p style="margin:0;color:#a1a1aa;font:400 13px/1.6 Arial,sans-serif;">Contato oficial: <a href="mailto:${escapeHtml(emailReplyTo)}" style="color:#d7ff00;text-decoration:none;">${escapeHtml(emailReplyTo)}</a></p>
                <p style="margin:18px 0 0;color:#ffffff;font:700 14px/1.5 Arial,sans-serif;">Nos vemos na largada. Corra leve, corra junto, leve fun.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    'Sua inscrição está confirmada.',
    '',
    `Olá, ${athleteName}. ${intro}`,
    '',
    ...details.map(([label, value]) => `${label}: ${value}`),
    '',
    `Código para identificação: ${registrationCode}`,
    'A retirada do kit terá local, data e horário divulgados nos canais oficiais da FunPace.',
    `Regulamento: ${siteUrl}/regulamento`,
    `Política de privacidade: ${siteUrl}/privacidade`,
    ...(whatsappUrl ? [`Suporte WhatsApp: ${whatsappUrl}`] : []),
    `Contato oficial: ${emailReplyTo}`,
  ].join('\n');

  return { subject, html, text };
}

export async function sendRegistrationConfirmationEmail(context: RegistrationEmailContext): Promise<EmailSendResult> {
  const provider = getEmailProvider();

  if (!isEmailEnabled()) {
    return { ok: false, skipped: true, provider, error: 'EMAIL_PROVIDER not configured.' };
  }

  const to = context.registration.payload.email;

  if (!isEmailRecipientAllowed(to)) {
    return { ok: false, skipped: true, provider, error: 'Recipient blocked by environment policy.' };
  }

  const email = await buildRegistrationConfirmationEmail(context);

  if (emailProvider === 'console') {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      message: 'email_console_provider',
      kind: 'confirmation',
      to,
      subject: email.subject,
      registrationId: context.registration.id,
    }));

    return { ok: true, provider: 'console', providerMessageId: `console_${Date.now()}` };
  }

  if (!resendApiKey || !emailFrom) {
    return { ok: false, skipped: true, provider, error: 'RESEND_API_KEY and EMAIL_FROM must be configured.' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
      ...(context.deliveryKey ? { 'Idempotency-Key': context.deliveryKey } : {}),
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from: emailFrom,
      to,
      reply_to: emailReplyTo || undefined,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });

  const payload = await response.json().catch(() => null) as { id?: string; message?: string; error?: string } | null;

  if (!response.ok) {
    return {
      ok: false,
      provider,
      error: payload?.message || payload?.error || `Email provider responded with ${response.status}.`,
    };
  }

  return {
    ok: true,
    provider,
    providerMessageId: payload?.id || undefined,
  };
}
