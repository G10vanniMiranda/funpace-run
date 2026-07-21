import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL nao configurada.');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_SSL || 'true') !== 'false' ? { rejectUnauthorized: false } : false,
});

await client.connect();
try {
  await client.query(readFileSync('server/seeds/partners.sql', 'utf8'));
  console.log('Seed de parceiros aplicado com sucesso.');
} finally {
  await client.end();
}
