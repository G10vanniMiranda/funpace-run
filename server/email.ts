import type { EventRecord, LotRecord, RegistrationRecord } from './database.js';

export type RegistrationEmailKind = 'pending' | 'confirmation';

export type RegistrationEmailContext = {
  registration: RegistrationRecord;
  event: EventRecord;
  distanceName: string;
  lot: LotRecord | null;
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

export function getEmailProvider() {
  return emailProvider || 'not_configured';
}

export function isEmailEnabled() {
  return emailProvider === 'resend' || emailProvider === 'console';
}

export function isEmailConfigured() {
  if (emailProvider === 'console') {
    return true;
  }

  if (emailProvider === 'resend') {
    return Boolean(resendApiKey && emailFrom);
  }

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

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Manaus',
  }).format(parsedDate);
}

function getEventLocation(event: EventRecord) {
  return event.locationName?.trim()
    ? `${event.locationName} - ${event.city}/${event.state}`
    : 'Local a definir';
}

function getEmailCopy(kind: RegistrationEmailKind) {
  if (kind === 'confirmation') {
    return {
      subject: 'Inscrição confirmada | FunPace Run',
      eyebrow: 'Inscrição confirmada',
      title: 'Sua inscrição está confirmada.',
      intro: 'Pagamento aprovado. Agora você faz parte da FunPace Run Experience.',
      paymentStatus: 'Confirmado',
      closing: 'Nos vemos na largada. Corra leve, corra junto, leve fun.',
    };
  }

  return {
    subject: 'Inscrição recebida | FunPace Run',
    eyebrow: 'Inscrição recebida',
    title: 'Recebemos sua inscrição.',
    intro: 'A confirmação final depende da aprovação do pagamento pelo gateway.',
    paymentStatus: 'Aguardando pagamento',
    closing: 'Finalize o pagamento para garantir sua vaga na FunPace Run Experience.',
  };
}

function buildRegistrationEmail(kind: RegistrationEmailKind, context: RegistrationEmailContext) {
  const { registration, event, distanceName, lot } = context;
  const copy = getEmailCopy(kind);
  const athleteName = registration.payload.fullName;
  const details = [
    ['Atleta', athleteName],
    ['Evento', event.name],
    ['Distância', distanceName],
    ['Camisa', registration.payload.shirtSize],
    ['Inscrição', registration.id],
    ['Lote', lot?.name || registration.lotId],
    ['Valor', formatCurrency(registration.amountCents)],
    ['Pagamento', copy.paymentStatus],
    ['Data', formatEventDate(event.date)],
    ['Horário', event.startTime],
    ['Local', getEventLocation(event)],
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
    <title>${escapeHtml(copy.subject)}</title>
  </head>
  <body style="margin:0;background:#050505;color:#ffffff;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(copy.intro)}</div>
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
                <p style="margin:0 0 14px;color:#d7ff00;font:800 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.16em;">${escapeHtml(copy.eyebrow)}</p>
                <h1 style="margin:0;color:#ffffff;font:900 34px/0.95 Arial,sans-serif;text-transform:uppercase;letter-spacing:-.04em;">${escapeHtml(copy.title)}</h1>
                <p style="margin:20px 0 0;color:#d4d4d8;font:400 16px/1.55 Arial,sans-serif;">Olá, ${escapeHtml(athleteName)}. ${escapeHtml(copy.intro)}</p>
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
              <td style="padding:22px 28px 0;">
                <p style="margin:0;color:#d4d4d8;font:400 15px/1.6 Arial,sans-serif;">A retirada do kit terá local, data e horário divulgados nos canais oficiais da FunPace. Fique atento ao seu e-mail e ao Instagram.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px;">
                <a href="${siteUrl}/regulamento" style="display:inline-block;background:#d7ff00;color:#000000;text-decoration:none;font:900 13px Arial,sans-serif;text-transform:uppercase;letter-spacing:.12em;padding:16px 18px;">Ver regulamento</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 30px;">
                <p style="margin:0;color:#a1a1aa;font:400 13px/1.6 Arial,sans-serif;">Contato oficial: <a href="mailto:${escapeHtml(emailReplyTo)}" style="color:#d7ff00;text-decoration:none;">${escapeHtml(emailReplyTo)}</a></p>
                <p style="margin:18px 0 0;color:#ffffff;font:700 14px/1.5 Arial,sans-serif;">${escapeHtml(copy.closing)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    copy.title,
    '',
    `Olá, ${athleteName}. ${copy.intro}`,
    '',
    ...details.map(([label, value]) => `${label}: ${value}`),
    '',
    'A retirada do kit terá local, data e horário divulgados nos canais oficiais da FunPace.',
    `Regulamento: ${siteUrl}/regulamento`,
    `Contato oficial: ${emailReplyTo}`,
    '',
    copy.closing,
  ].join('\n');

  return {
    subject: copy.subject,
    html,
    text,
  };
}

export async function sendRegistrationEmail(kind: RegistrationEmailKind, context: RegistrationEmailContext): Promise<EmailSendResult> {
  const provider = getEmailProvider();

  if (!isEmailEnabled()) {
    return { ok: false, skipped: true, provider, error: 'EMAIL_PROVIDER not configured.' };
  }

  const to = context.registration.payload.email;
  const email = buildRegistrationEmail(kind, context);

  if (emailProvider === 'console') {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      message: 'email_console_provider',
      kind,
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
    },
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
