import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDatabaseConnectionUrl } from '../server/database';

test('Vercel uses Supabase transaction pooling instead of session pooling', () => {
  const sessionUrl = 'postgresql://postgres.project:secret@aws-0-region.pooler.supabase.com:5432/postgres';
  const resolved = new URL(resolveDatabaseConnectionUrl(sessionUrl, true));

  assert.equal(resolved.port, '6543');
  assert.equal(resolved.hostname, 'aws-0-region.pooler.supabase.com');
  assert.equal(resolved.username, 'postgres.project');
});

test('database URLs are not rewritten outside Vercel or for other hosts', () => {
  const supabaseSessionUrl = 'postgresql://postgres.project:secret@aws-0-region.pooler.supabase.com:5432/postgres';
  const externalUrl = 'postgresql://user:secret@database.example.com:5432/app';

  assert.equal(resolveDatabaseConnectionUrl(supabaseSessionUrl, false), supabaseSessionUrl);
  assert.equal(resolveDatabaseConnectionUrl(externalUrl, true), externalUrl);
});
