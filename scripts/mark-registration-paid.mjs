import { randomUUID } from 'node:crypto';
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
const transactionNsu = process.argv[3] || '';

if (!registrationId) {
  throw new Error('Usage: node scripts/mark-registration-paid.mjs <registration-id> [transaction-nsu]');
}

const { transaction } = await import('../server/database.ts');

const result = await transaction((database) => {
  const registration = database.registrations.find((item) => item.id.toLowerCase() === registrationId.toLowerCase());

  if (!registration) {
    return { found: false };
  }

  const payment = database.payments.find((item) => item.registrationId === registration.id);
  const now = new Date().toISOString();
  const providerEventId = transactionNsu || `manual_paid_${registration.id}`;

  registration.status = 'paid';
  registration.updatedAt = now;
  registration.expiresAt = null;

  if (payment) {
    payment.status = 'paid';
    payment.provider = payment.provider || 'infinitepay';
    payment.providerPaymentId = transactionNsu || payment.providerPaymentId;
    payment.updatedAt = now;
    payment.expiresAt = null;
  }

  if (!database.paymentEvents.some((item) => item.providerEventId === providerEventId)) {
    database.paymentEvents.push({
      id: randomUUID(),
      paymentId: payment?.id || '',
      providerEventId,
      eventType: 'manual.payment_confirmed',
      payload: {
        registrationId: registration.id,
        transactionNsu: transactionNsu || null,
        reason: 'Manual confirmation after verified Pix payment.',
      },
      receivedAt: now,
    });
  }

  database.auditLogs.push({
    id: randomUUID(),
    actor: 'admin',
    action: 'registration.payment_marked_paid',
    entityType: 'registration',
    entityId: registration.id,
    payload: {
      transactionNsu: transactionNsu || null,
    },
    createdAt: now,
  });

  return {
    found: true,
    registrationId: registration.id,
    status: registration.status,
    paymentStatus: payment?.status || null,
    providerEventId,
  };
});

console.log(JSON.stringify(result, null, 2));
