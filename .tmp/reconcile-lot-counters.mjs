import { loadEnvFile } from 'node:process';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
loadEnvFile('.env');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: String(process.env.DATABASE_SSL).toLowerCase() === 'false' ? false : { rejectUnauthorized: false } });
const client = await pool.connect();
try {
  await client.query('begin');
  const lots = (await client.query(`select id, sold_count from "run-lots" for update`)).rows;
  const changed = [];
  for (const lot of lots) {
    const actual = Number((await client.query(`select count(*)::int total from "run-registrations" where lot_id=$1 and status in ('pending_payment','paid')`, [lot.id])).rows[0].total);
    if (Number(lot.sold_count) === actual) continue;
    await client.query(`update "run-lots" set sold_count=$1, status=case when continues_after_capacity then status when $1>=capacity then 'sold_out' when status='sold_out' then 'active' else status end where id=$2`, [actual, lot.id]);
    await client.query(`insert into "run-audit-logs"(id,actor,action,entity_type,entity_id,payload,created_at) values($1,'phase1-automatic-reconciliation','lot.counter_reconciled','lot',$2,$3,$4)`, [randomUUID(), lot.id, { previousSoldCount: Number(lot.sold_count), actualSoldCount: actual, source: 'derived_from_paid_and_pending_registrations' }, new Date().toISOString()]);
    changed.push({ lotId: lot.id, previous: Number(lot.sold_count), current: actual });
  }
  await client.query('commit');
  console.log(JSON.stringify({ ok: true, changed }, null, 2));
} catch (error) { await client.query('rollback'); throw error; }
finally { client.release(); await pool.end(); }
