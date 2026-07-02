import { createHash } from 'node:crypto';
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

function cpfHash(cpf) {
  return createHash('sha256').update(cpf.replace(/\D/g, '')).digest('hex');
}

loadEnvFile('.env');
loadEnvFile('.env.local');

const cpf = process.argv[2];

if (!cpf) {
  throw new Error('Usage: node scripts/check-active-registration-by-cpf.mjs <cpf>');
}

const { transaction } = await import('../server/database.ts');
const hash = cpfHash(cpf);

const result = await transaction((database) => {
  const active = database.registrations.filter((registration) => (
    registration.cpfHash === hash && ['pending_payment', 'paid'].includes(registration.status)
  ));

  return {
    provider: process.env.DATABASE_PROVIDER || (process.env.DATABASE_URL ? 'postgres' : 'json'),
    activeCount: active.length,
    active: active.map((registration) => ({
      id: registration.id,
      status: registration.status,
      amountCents: registration.amountCents,
      updatedAt: registration.updatedAt,
    })),
  };
});

console.log(JSON.stringify(result, null, 2));
