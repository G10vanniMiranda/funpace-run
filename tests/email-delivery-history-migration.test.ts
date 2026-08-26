import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPaths = [
  'server/migrations/20260825_email_delivery_history.sql',
  'supabase/migrations/20260825000100_email_delivery_history.sql',
];

test('email delivery migrations are mirrored, schema-only and history-safe', () => {
  const migrations = migrationPaths.map((path) => readFileSync(path, 'utf8').trim());
  assert.equal(migrations[0], migrations[1]);
  const migration = migrations[0];
  assert.match(migration, /create table if not exists public\."run-email-deliveries"/);
  assert.match(migration, /registration_id text not null references public\."run-registrations"\(id\)/);
  assert.match(migration, /unique \(idempotency_key\)/i);
  assert.match(migration, /where provider_message_id is not null/);
  assert.match(migration, /email_delivery/);
  assert.doesNotMatch(migration, /unique\s*\(registration_id\)/i);
  assert.doesNotMatch(migration, /insert\s+into|update\s+public|delete\s+from|drop\s+table/i);
});

test('canonical schema keeps legacy summary columns and adds delivery history', () => {
  const schema = readFileSync('server/supabase-schema.sql', 'utf8');
  for (const column of [
    'confirmation_email_sent_at',
    'confirmation_email_last_attempt_at',
    'confirmation_email_provider',
    'confirmation_email_id',
    'confirmation_email_error',
  ]) assert.match(schema, new RegExp(column));
  assert.match(schema, /create table if not exists "run-email-deliveries"/);
  assert.match(schema, /email_delivery/);
});
