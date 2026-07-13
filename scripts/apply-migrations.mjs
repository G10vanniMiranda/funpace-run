import { existsSync, readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
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
  await client.query('create table if not exists "run-schema-migrations" (name text primary key, applied_at text not null)');
  const applied = new Set((await client.query('select name from "run-schema-migrations"')).rows.map((row) => row.name));
  for (const name of readdirSync('server/migrations').filter((file) => file.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue;
    await client.query(readFileSync(`server/migrations/${name}`, 'utf8'));
    await client.query('insert into "run-schema-migrations" (name, applied_at) values ($1, $2)', [name, new Date().toISOString()]);
    console.log(`Aplicada: ${name}`);
  }
} finally {
  await client.end();
}
