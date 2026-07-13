import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

throw new Error('Desativado na Fase 1: inscricoes pagas nao podem ser criadas sem transacao verificada no gateway.');

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

const rawInput = process.argv[2] || process.env.MANUAL_REGISTRATION_PAYLOAD;

if (!rawInput) {
  throw new Error('Usage: node --import tsx scripts/create-manual-paid-registration.mjs \'<json-payload>\' or set MANUAL_REGISTRATION_PAYLOAD');
}

const input = JSON.parse(rawInput);

const { validateRegistration } = await import('../src/lib/validation.ts');
const { transaction } = await import('../server/database.ts');
const {
  getEmailProvider,
  isEmailConfigured,
  sendRegistrationConfirmationEmail,
} = await import('../server/email.ts');

function normalizePayload(payload) {
  const distance = String(payload.distance || '').trim().toUpperCase().replace('KM', 'K');
  const genderRaw = String(payload.gender || '').trim().toLowerCase();
  const gender = genderRaw === 'masculino' || genderRaw === 'male' ? 'male'
    : genderRaw === 'feminino' || genderRaw === 'female' ? 'female'
      : '';

  return {
    fullName: String(payload.fullName || '').trim(),
    email: String(payload.email || '').trim().toLowerCase(),
    cpf: String(payload.cpf || '').trim(),
    phone: String(payload.phone || '').trim(),
    city: String(payload.city || '').trim(),
    state: String(payload.state || '').trim().toUpperCase(),
    team: String(payload.team || '').trim(),
    birthDate: String(payload.birthDate || '').trim(),
    gender,
    shirtSize: String(payload.shirtSize || '').trim().toUpperCase() || 'M',
    distance,
    emergencyContactName: String(payload.emergencyContactName || '').trim(),
    emergencyContactPhone: String(payload.emergencyContactPhone || '').trim(),
    termsAccepted: payload.termsAccepted !== false,
    regulationAccepted: payload.regulationAccepted !== false,
    privacyAccepted: payload.privacyAccepted !== false,
  };
}

function hashCpf(cpf) {
  return createHash('sha256').update(String(cpf || '').replace(/\D/g, '')).digest('hex');
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
      actor: 'manual-registration-script',
      action: result.ok ? 'email.confirmation.sent' : 'email.confirmation.failed',
      entityType: 'registration',
      entityId: registration.id,
      payload: {
        provider: result.provider,
        email: registration.payload.email,
        providerMessageId: result.providerMessageId || null,
        error: result.ok ? null : result.error || 'Email send failed',
        source: 'manual_registration_script',
      },
      createdAt: completedAt,
    });
  });
}

async function createManualPaidRegistration(payload) {
  const normalizedPayload = normalizePayload(payload);
  const validationErrors = validateRegistration(normalizedPayload);

  if (Object.keys(validationErrors).length > 0) {
    return { ok: false, error: 'validation_failed', validationErrors };
  }

  return transaction((database) => {
    const event = database.events.find((item) => item.slug === 'funpace-run-2026' && item.status === 'published');

    if (!event) {
      return { ok: false, error: 'event_not_found' };
    }

    const distance = database.distances.find((item) => item.eventId === event.id && item.name === normalizedPayload.distance && item.status === 'active');
    const lot = database.lots.find((item) => item.eventId === event.id && item.status === 'active');

    if (!distance || !lot) {
      return { ok: false, error: 'distance_or_lot_unavailable' };
    }

    const activeSameCpf = database.registrations.find((item) => (
      item.eventId === event.id
      && item.cpfHash === hashCpf(normalizedPayload.cpf)
      && ['pending_payment', 'paid'].includes(item.status)
    ));

    if (activeSameCpf) {
      return {
        ok: false,
        error: 'duplicate_active_registration',
        registrationId: activeSameCpf.id,
        status: activeSameCpf.status,
      };
    }

    const distanceOccupied = database.registrations.filter((item) => (
      item.distanceId === distance.id && ['pending_payment', 'paid'].includes(item.status)
    )).length;

    if (distanceOccupied >= distance.capacity || lot.soldCount >= lot.capacity) {
      return { ok: false, error: 'capacity_exhausted' };
    }

    const now = new Date().toISOString();
    const registrationId = randomUUID();
    const paymentId = randomUUID();
    const providerEventId = `manual_paid_${registrationId}`;
    const cpfHash = hashCpf(normalizedPayload.cpf);

    database.registrations.push({
      id: registrationId,
      eventId: event.id,
      distanceId: distance.id,
      lotId: lot.id,
      cpfHash,
      status: 'paid',
      amountCents: lot.priceCents,
      payload: normalizedPayload,
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      paidAt: now,
      confirmedAt: now,
      confirmationEmailSentAt: null,
      confirmationEmailLastAttemptAt: null,
      confirmationEmailProvider: null,
      confirmationEmailId: null,
      confirmationEmailError: null,
      bibNumber: null,
    });

    database.payments.push({
      id: paymentId,
      registrationId,
      provider: 'infinitepay',
      status: 'paid',
      amountCents: lot.priceCents,
      providerPaymentId: null,
      checkoutUrl: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      paidAt: now,
      gatewayStatus: 'manual_reconciled_paid',
      gatewayTransactionId: null,
      gatewayPayload: {
        source: 'manual_registration_script',
        reason: 'Manual paid registration created from verified WhatsApp order.',
      },
    });

    database.paymentEvents.push({
      id: randomUUID(),
      paymentId,
      providerEventId,
      eventType: 'manual.payment_confirmed',
      payload: {
        source: 'manual_registration_script',
        registrationId,
        reason: 'Manual paid registration created from verified WhatsApp order.',
      },
      receivedAt: now,
    });

    lot.soldCount += 1;
    if (lot.soldCount >= lot.capacity) {
      lot.status = 'sold_out';
    }

    database.auditLogs.push({
      id: randomUUID(),
      actor: 'manual-registration-script',
      action: 'registration.created_paid_manually',
      entityType: 'registration',
      entityId: registrationId,
      payload: {
        source: 'manual_registration_script',
        paymentId,
        amountCents: lot.priceCents,
        fullName: normalizedPayload.fullName,
        email: normalizedPayload.email,
        cpfHash,
      },
      createdAt: now,
    });

    return {
      ok: true,
      registrationId,
      paymentId,
      amountCents: lot.priceCents,
      context: {
        registration: {
          id: registrationId,
          eventId: event.id,
          distanceId: distance.id,
          lotId: lot.id,
          cpfHash,
          status: 'paid',
          amountCents: lot.priceCents,
          payload: normalizedPayload,
          createdAt: now,
          updatedAt: now,
          expiresAt: null,
          paidAt: now,
          confirmedAt: now,
          confirmationEmailSentAt: null,
          confirmationEmailLastAttemptAt: null,
          confirmationEmailProvider: null,
          confirmationEmailId: null,
          confirmationEmailError: null,
          bibNumber: null,
        },
        event: { ...event },
        distanceName: distance.name,
        lot: { ...lot },
      },
    };
  });
}

async function sendConfirmationEmail(registrationId, context) {
  const provider = getEmailProvider();

  if (!isEmailConfigured()) {
    await persistEmailResult(registrationId, {
      ok: false,
      provider,
      error: 'Email provider not configured.',
    });
    return { ok: false, provider, error: 'Email provider not configured.' };
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

const created = await createManualPaidRegistration(input);

if (!created.ok) {
  console.log(JSON.stringify(created, null, 2));
  process.exit(1);
}

const emailResult = await sendConfirmationEmail(created.registrationId, created.context);

console.log(JSON.stringify({
  ok: true,
  registrationId: created.registrationId,
  paymentId: created.paymentId,
  amountCents: created.amountCents,
  emailSent: emailResult.ok,
  emailProvider: emailResult.provider,
  emailError: emailResult.ok ? null : emailResult.error || null,
}, null, 2));

process.exit(0);
