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

const registrationId = process.argv[2]?.trim();

if (!registrationId) {
  throw new Error('Usage: node --import tsx scripts/resend-registration-email.mjs <registration-id>');
}

const [{ transaction }, { processRegistrationEmail }] = await Promise.all([
  import('../server/database.ts'),
  import('../server/index.ts'),
]);

const registration = await transaction((database) => {
  const found = database.registrations.find((item) => item.id.toLowerCase() === registrationId.toLowerCase());

  return found ? {
    id: found.id,
    status: found.status,
    email: found.payload.email,
  } : null;
}, { persist: false, scope: 'admin-registrations' });

if (!registration) {
  throw new Error('Registration not found.');
}

if (registration.status !== 'paid') {
  throw new Error(`Confirmation e-mail requires a paid registration. Current status: ${registration.status}`);
}

await processRegistrationEmail('confirmation', registration.id, { force: true });

const result = await transaction((database) => {
  const updated = database.registrations.find((item) => item.id === registration.id);

  return {
    registrationId: updated?.id,
    email: updated?.payload.email,
    sentAt: updated?.confirmationEmailSentAt || null,
    attemptedAt: updated?.confirmationEmailLastAttemptAt || null,
    provider: updated?.confirmationEmailProvider || null,
    providerMessageId: updated?.confirmationEmailId || null,
    error: updated?.confirmationEmailError || null,
  };
}, { persist: false, scope: 'admin-registrations' });

console.log(JSON.stringify(result, null, 2));
process.exit(result.sentAt && !result.error ? 0 : 1);
