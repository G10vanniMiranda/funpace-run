import { existsSync, readFileSync } from 'node:fs';

function loadEnvFile(path) {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function getArgumentValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : '';
}

function getDefaultSince() {
  const now = new Date();
  const manausNow = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Manaus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).reduce((parts, part) => {
    if (part.type !== 'literal') parts[part.type] = part.value;
    return parts;
  }, {});
  const yesterday = new Date(`${manausNow.year}-${manausNow.month}-${manausNow.day}T00:00:00-04:00`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString();
}

loadEnvFile('.env');
loadEnvFile('.env.local');

const since = getArgumentValue('--since') || getDefaultSince();
const dryRun = process.argv.includes('--dry-run');
const sinceTime = new Date(since).getTime();

if (!Number.isFinite(sinceTime)) {
  throw new Error(`Invalid --since value: ${since}`);
}

const [{ transaction }, { processRegistrationEmail }] = await Promise.all([
  import('../server/database.ts'),
  import('../server/index.ts'),
]);

const candidates = await transaction((database) => database.registrations
  .filter((registration) => new Date(registration.createdAt).getTime() >= sinceTime)
  .filter((registration) => registration.status === 'paid')
  .map((registration) => {
    const payment = database.payments.find((item) => item.registrationId === registration.id) || null;
    return {
      id: registration.id,
      email: registration.payload.email,
      fullName: registration.payload.fullName,
      status: registration.status,
      createdAt: registration.createdAt,
      paidAt: registration.paidAt || payment?.paidAt || null,
      paymentStatus: payment?.status || null,
      confirmationEmailSentAt: registration.confirmationEmailSentAt || null,
      confirmationEmailLastAttemptAt: registration.confirmationEmailLastAttemptAt || null,
      confirmationEmailError: registration.confirmationEmailError || null,
    };
  })
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt)), { persist: false, scope: 'admin-registrations' });

const missingConfirmation = candidates.filter((registration) => !registration.confirmationEmailSentAt);
const results = [];

for (const registration of missingConfirmation) {
  if (dryRun) {
    results.push({
      registrationId: registration.id,
      email: registration.email,
      sent: false,
      dryRun: true,
    });
    continue;
  }

  const result = await processRegistrationEmail(registration.id);
  results.push({
    registrationId: registration.id,
    email: registration.email,
    sent: Boolean(result?.ok),
    skipped: Boolean(result?.skipped || result === null),
    provider: result?.provider || null,
    providerMessageId: result?.providerMessageId || null,
    error: result?.ok ? null : result?.error || null,
  });
}

const after = await transaction((database) => {
  const ids = new Set(missingConfirmation.map((registration) => registration.id));
  return database.registrations
    .filter((registration) => ids.has(registration.id))
    .map((registration) => ({
      registrationId: registration.id,
      email: registration.payload.email,
      confirmationEmailSentAt: registration.confirmationEmailSentAt || null,
      confirmationEmailProvider: registration.confirmationEmailProvider || null,
      confirmationEmailId: registration.confirmationEmailId || null,
      confirmationEmailError: registration.confirmationEmailError || null,
    }));
}, { persist: false, scope: 'admin-registrations' });

console.log(JSON.stringify({
  since,
  dryRun,
  paidRegistrationsSince: candidates.length,
  paidWithoutConfirmationEmail: missingConfirmation.length,
  attempted: results.length,
  sent: results.filter((result) => result.sent).length,
  skipped: results.filter((result) => result.skipped).length,
  failed: results.filter((result) => !result.sent && !result.skipped).length,
  results,
  after,
}, null, 2));
