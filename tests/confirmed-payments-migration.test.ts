import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPaths = [
  'server/migrations/20260824_confirmed_payments_google_sheet.sql',
  'supabase/migrations/20260824000100_confirmed_payments_google_sheet.sql',
];

test('confirmed payment outbox migrations are mirrored and only extend the two check constraints', () => {
  const migrations = migrationPaths.map((path) => readFileSync(path, 'utf8').trim());
  assert.equal(migrations[0], migrations[1]);
  assert.match(migrations[0], /alter table public\."run-google-sheet-sync"/);
  assert.match(migrations[0], /"run-google-sheet-sync_entity_type_check"/);
  assert.match(migrations[0], /"run-google-sheet-sync_sheet_name_check"/);
  assert.doesNotMatch(migrations[0], /google_sheet_syncs/);
  assert.match(migrations[0], /confirmed_payments_projection/);
  assert.match(migrations[0], /confirmed_payments/);
  assert.doesNotMatch(migrations[0], /insert|update\s+public|delete\s+from/i);
  for (const legacy of ['registration', 'payment', 'check_in', 'shirt_summary', 'lot_summary', 'alert', 'partnership', 'email', 'remarketing']) {
    assert.match(migrations[0], new RegExp(`'${legacy}'`));
  }
});
