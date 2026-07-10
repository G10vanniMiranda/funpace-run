import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

function loadDotEnv(path = '.env') {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL nao encontrada no ambiente nem no .env.');
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: (process.env.DATABASE_SSL || 'true') !== 'false'
    ? { rejectUnauthorized: false }
    : false,
});

await client.connect();

try {
  await client.query(readFileSync('server/supabase-schema.sql', 'utf8'));
  console.log('Schema aplicado com sucesso.');

  const checkpoints = [100, 101, 500, 501, 600, 601, 700, 701];
  const validation = await client.query(
    `select checkpoint.registration_number, lot.id, lot.name, lot.price_cents
     from unnest($1::int[]) as checkpoint(registration_number)
     cross join lateral public.run_select_lot_for_registration_number(
       'funpace-run-2026',
       checkpoint.registration_number
     ) lot
     order by checkpoint.registration_number`,
    [checkpoints],
  );

  console.table(validation.rows);
} finally {
  await client.end();
}
