import { existsSync, readFileSync } from 'node:fs';

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

const registrationId = process.argv[2];

if (!registrationId) {
  throw new Error('Usage: node scripts/inspect-registration.mjs <registration-id>');
}

const { transaction } = await import('../server/database.ts');

const result = await transaction((database) => {
  const registration = database.registrations.find((item) => item.id.toLowerCase() === registrationId.toLowerCase());
  const payment = registration ? database.payments.find((item) => item.registrationId === registration.id) : null;
  const events = payment ? database.paymentEvents.filter((item) => item.paymentId === payment.id || item.providerEventId === payment.providerPaymentId) : [];

  return {
    provider: process.env.DATABASE_PROVIDER || (process.env.DATABASE_URL ? 'postgres' : 'json'),
    found: Boolean(registration),
    registration: registration ? {
      id: registration.id,
      status: registration.status,
      amountCents: registration.amountCents,
      updatedAt: registration.updatedAt,
      confirmationEmailSentAt: registration.confirmationEmailSentAt || null,
    } : null,
    payment: payment ? {
      id: payment.id,
      status: payment.status,
      amountCents: payment.amountCents,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      checkoutUrl: Boolean(payment.checkoutUrl),
      updatedAt: payment.updatedAt,
    } : null,
    paymentEvents: events.map((event) => ({
      type: event.eventType,
      providerEventId: event.providerEventId,
      receivedAt: event.receivedAt,
    })),
  };
});

console.log(JSON.stringify(result, null, 2));
