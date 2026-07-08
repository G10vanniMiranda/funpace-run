import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { snapshot } from '../server/database.ts';
import { buildRegistrationSheetRow, createGoogleSheetsClient, getGoogleSheetsConfig } from '../server/google-sheets.ts';

const database = await snapshot();
const sheets = createGoogleSheetsClient({ config: getGoogleSheetsConfig() });
const current = await sheets.getValues('Inscrições!M2:M');
const existingIds = new Set((current.values || []).map((row) => String(row[0] || '')).filter(Boolean));
const missing = database.registrations.filter((registration) => !existingIds.has(registration.id));

if (missing.length === 0) {
  console.log(JSON.stringify({ ok: true, appended: 0 }));
  process.exit(0);
}

const rows = missing.map((registration) => buildRegistrationSheetRow({
  registration,
  payment: database.payments.find((payment) => payment.registrationId === registration.id) || null,
  distanceName: database.distances.find((distance) => distance.id === registration.distanceId)?.name || registration.distanceId,
  lotName: database.lots.find((lot) => lot.id === registration.lotId)?.name || registration.lotId,
}));
const appended = await sheets.appendValues("'Inscrições'!A:N", rows);
const updatedRange = appended.updates?.updatedRange || appended.updatedRange || '';
const startRow = Number(updatedRange.match(/![A-Z]+(\d+):/)?.[1] || 0) || null;
const now = new Date().toISOString();
const records = missing.map((registration, index) => ({
  id: randomUUID(), entity_type: 'registration', entity_id: registration.id, sheet_name: 'registrations',
  operation: 'upsert', status: 'synchronized', row_number: startRow ? startRow + index : null,
  attempts: 1, last_attempt_at: now, synchronized_at: now, last_error: null, created_at: now, updated_at: now,
}));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: (process.env.DATABASE_SSL || 'true') !== 'false' ? { rejectUnauthorized: false } : false });

try {
  await pool.query(
    `insert into "run-google-sheet-sync" (id, entity_type, entity_id, sheet_name, operation, status, row_number, attempts, last_attempt_at, synchronized_at, last_error, created_at, updated_at)
     select id, entity_type, entity_id, sheet_name, operation, status, row_number, attempts, last_attempt_at, synchronized_at, last_error, created_at, updated_at
     from jsonb_to_recordset($1::jsonb) as x(id text, entity_type text, entity_id text, sheet_name text, operation text, status text, row_number integer, attempts integer, last_attempt_at text, synchronized_at text, last_error text, created_at text, updated_at text)
     on conflict (entity_type, entity_id, sheet_name) do update set status = 'synchronized', row_number = excluded.row_number, synchronized_at = excluded.synchronized_at, last_error = null, updated_at = excluded.updated_at`,
    [JSON.stringify(records)],
  );
} finally {
  await pool.end();
}

console.log(JSON.stringify({ ok: true, appended: missing.length, startRow, endRow: startRow ? startRow + missing.length - 1 : null }));
