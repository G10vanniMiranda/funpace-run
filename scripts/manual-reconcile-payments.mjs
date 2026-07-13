import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

throw new Error('Desativado na Fase 1: pagamentos so podem ser confirmados por webhook ou payment_check verificado.');

function loadEnvFile(path) {
  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

const registrationIds = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);

if (registrationIds.length === 0) {
  throw new Error('Usage: node --import tsx scripts/manual-reconcile-payments.mjs <registration-id> [registration-id...]');
}

const { transaction } = await import('../server/database.ts');
const {
  getEmailProvider,
  isEmailConfigured,
  sendRegistrationConfirmationEmail,
} = await import('../server/email.ts');

async function markRegistrationPaid(registrationId) {
  return transaction((database) => {
    const registration = database.registrations.find((item) => item.id.toLowerCase() === registrationId.toLowerCase());

    if (!registration) {
      return { found: false, registrationId };
    }

    const payment = database.payments.find((item) => item.registrationId === registration.id) || null;
    const event = database.events.find((item) => item.id === registration.eventId) || null;
    const distance = database.distances.find((item) => item.id === registration.distanceId) || null;
    const lot = database.lots.find((item) => item.id === registration.lotId) || null;
    const now = new Date().toISOString();
    const previousStatus = registration.status;
    const providerEventId = `manual_paid_${registration.id}`;

    registration.status = 'paid';
    registration.updatedAt = now;
    registration.expiresAt = null;
    registration.paidAt = registration.paidAt || now;
    registration.confirmedAt = registration.confirmedAt || now;

    if (payment) {
      payment.status = 'paid';
      payment.provider = payment.provider || 'infinitepay';
      payment.updatedAt = now;
      payment.paidAt = payment.paidAt || now;
      payment.expiresAt = null;
      payment.gatewayStatus = 'manual_reconciled_paid';
      payment.gatewayPayload = {
        source: 'manual_reconcile_script',
        reason: 'Manual confirmation after verified Pix payment.',
        registrationId: registration.id,
      };
    }

    if (!database.paymentEvents.some((item) => item.providerEventId === providerEventId)) {
      database.paymentEvents.push({
        id: randomUUID(),
        paymentId: payment?.id || '',
        providerEventId,
        eventType: 'manual.payment_confirmed',
        payload: {
          source: 'manual_reconcile_script',
          registrationId: registration.id,
          reason: 'Manual confirmation after verified Pix payment.',
        },
        receivedAt: now,
      });
    }

    database.auditLogs.push({
      id: randomUUID(),
      actor: 'manual-reconciliation-script',
      action: 'registration.payment_marked_paid',
      entityType: 'registration',
      entityId: registration.id,
      payload: {
        source: 'manual_reconcile_script',
        previousStatus,
        paymentId: payment?.id || null,
      },
      createdAt: now,
    });

    if (!event || !distance) {
      return {
        found: true,
        registrationId: registration.id,
        email: registration.payload.email,
        status: registration.status,
        paymentStatus: payment?.status || null,
        emailContextMissing: true,
      };
    }

    return {
      found: true,
      registrationId: registration.id,
      email: registration.payload.email,
      status: registration.status,
      paymentStatus: payment?.status || null,
      emailContextMissing: false,
      context: {
        registration: { ...registration, payload: { ...registration.payload } },
        event: { ...event },
        distanceName: distance.name,
        lot: lot ? { ...lot } : null,
      },
    };
  }, { scope: 'checkout' });
}

async function persistEmailResult(registrationId, result) {
  const completedAt = new Date().toISOString();

  await transaction((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);

    if (!registration) {
      return;
    }

    registration.confirmationEmailLastAttemptAt = completedAt;
    registration.confirmationEmailProvider = result.provider;
    registration.confirmationEmailId = result.ok ? result.providerMessageId || null : registration.confirmationEmailId || null;
    registration.confirmationEmailError = result.ok ? null : result.error || 'Email send failed';

    if (result.ok) {
      registration.confirmationEmailSentAt = completedAt;
    }

    database.auditLogs.push({
      id: randomUUID(),
      actor: 'manual-reconciliation-script',
      action: result.ok ? 'email.confirmation.sent' : 'email.confirmation.failed',
      entityType: 'registration',
      entityId: registration.id,
      payload: {
        provider: result.provider,
        email: registration.payload.email,
        providerMessageId: result.providerMessageId || null,
        error: result.ok ? null : result.error || 'Email send failed',
        source: 'manual_reconcile_script',
      },
      createdAt: completedAt,
    });
  }, { scope: 'checkout' });
}

async function persistEmailSkip(registrationId, provider, reason) {
  const completedAt = new Date().toISOString();

  await transaction((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);

    if (!registration) {
      return;
    }

    registration.confirmationEmailLastAttemptAt = completedAt;
    registration.confirmationEmailProvider = provider;
    registration.confirmationEmailError = reason;

    database.auditLogs.push({
      id: randomUUID(),
      actor: 'manual-reconciliation-script',
      action: 'email.confirmation.skipped',
      entityType: 'registration',
      entityId: registration.id,
      payload: {
        provider,
        email: registration.payload.email,
        error: reason,
        source: 'manual_reconcile_script',
      },
      createdAt: completedAt,
    });
  }, { scope: 'checkout' });
}

async function sendConfirmationEmail(registrationId, context) {
  const provider = getEmailProvider();

  if (!isEmailConfigured()) {
    const reason = 'Email provider not configured.';
    await persistEmailSkip(registrationId, provider, reason);
    return { ok: false, skipped: true, provider, error: reason };
  }

  let result = { ok: false, provider, error: 'Unknown email error' };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      result = await sendRegistrationConfirmationEmail(context);
    } catch (error) {
      result = {
        ok: false,
        provider,
        error: error instanceof Error ? error.message : 'Unknown email error',
      };
    }

    if (result.ok || attempt === 3) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }

  await persistEmailResult(registrationId, result);

  return result;
}

const output = [];

for (const registrationId of registrationIds) {
  const reconciled = await markRegistrationPaid(registrationId);

  if (!reconciled.found) {
    output.push({
      registrationId,
      ok: false,
      error: 'registration_not_found',
    });
    continue;
  }

  if (reconciled.emailContextMissing) {
    output.push({
      registrationId: reconciled.registrationId,
      ok: true,
      paid: true,
      emailSent: false,
      error: 'registration_email_context_missing',
    });
    continue;
  }

  const emailResult = await sendConfirmationEmail(reconciled.registrationId, reconciled.context);

  output.push({
    registrationId: reconciled.registrationId,
    ok: true,
    paid: true,
    email: reconciled.email,
    emailSent: emailResult.ok,
    emailProvider: emailResult.provider,
    emailError: emailResult.ok ? null : emailResult.error || null,
  });
}

console.log(JSON.stringify(output, null, 2));
process.exit(0);
