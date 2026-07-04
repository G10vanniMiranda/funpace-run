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

    process.env[key] ||= value;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

const { transaction } = await import('../server/database.ts');

const targetPriceCents = 7990;

const result = await transaction((database) => {
  let lotsUpdated = 0;
  let pendingRegistrationsExpired = 0;
  let pendingPaymentsExpired = 0;
  const now = new Date().toISOString();

  for (const lot of database.lots) {
    if (lot.id === 'lot-1') {
      lot.priceCents = targetPriceCents;
      lotsUpdated += 1;
    }
  }

  for (const registration of database.registrations) {
    if (registration.lotId === 'lot-1' && registration.status === 'pending_payment' && registration.amountCents !== targetPriceCents) {
      registration.status = 'expired';
      registration.amountCents = targetPriceCents;
      registration.updatedAt = now;
      registration.expiresAt = now;
      pendingRegistrationsExpired += 1;
    }
  }

  for (const payment of database.payments) {
    const registration = database.registrations.find((item) => item.id === payment.registrationId);

    if (registration?.lotId === 'lot-1' && payment.status === 'pending_payment' && payment.amountCents !== targetPriceCents) {
      payment.status = 'expired';
      payment.amountCents = targetPriceCents;
      payment.checkoutUrl = null;
      payment.providerPaymentId = null;
      payment.updatedAt = now;
      payment.expiresAt = now;
      pendingPaymentsExpired += 1;
    }
  }

  for (const lot of database.lots) {
    if (lot.id === 'lot-1') {
      lot.soldCount = database.registrations.filter((registration) => (
        registration.lotId === lot.id && ['pending_payment', 'paid'].includes(registration.status)
      )).length;

      if (lot.status === 'sold_out' && lot.soldCount < lot.capacity) {
        lot.status = 'active';
      }
    }
  }

  return {
    provider: process.env.DATABASE_PROVIDER || (process.env.DATABASE_URL ? 'postgres' : 'json'),
    targetPriceCents,
    lotsUpdated,
    pendingRegistrationsExpired,
    pendingPaymentsExpired,
  };
});

console.log(JSON.stringify(result, null, 2));
