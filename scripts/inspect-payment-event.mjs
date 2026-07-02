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

const providerEventId = process.argv[2];

if (!providerEventId) {
  throw new Error('Usage: node scripts/inspect-payment-event.mjs <provider-event-id>');
}

const { transaction } = await import('../server/database.ts');

const result = await transaction((database) => database.paymentEvents
  .filter((event) => event.providerEventId === providerEventId)
  .map((event) => ({
    eventType: event.eventType,
    providerEventId: event.providerEventId,
    receivedAt: event.receivedAt,
    payload: event.payload,
  })));

console.log(JSON.stringify(result, null, 2));
