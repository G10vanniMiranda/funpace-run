import { loadEnvFile } from 'node:process';
import { readFileSync } from 'node:fs';
import pg from 'pg';
loadEnvFile('.env');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: String(process.env.DATABASE_SSL).toLowerCase() === 'false' ? false : { rejectUnauthorized: false } });
const client = await pool.connect();
try {
  await client.query('begin');
  await client.query(readFileSync('server/migrations/20260712_payment_automation.sql', 'utf8'));
  await client.query('commit');
  console.log(JSON.stringify({ ok: true, migration: '20260712_payment_automation' }));
} catch (error) { await client.query('rollback'); throw error; }
finally { client.release(); await pool.end(); }
