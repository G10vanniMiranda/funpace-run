import assert from 'node:assert/strict';
import test from 'node:test';
import { isCronAuthorizationValid } from '../server/cron-auth';

test('cron fails closed when CRON_SECRET is absent', () => {
  assert.equal(isCronAuthorizationValid('', undefined), false);
  assert.equal(isCronAuthorizationValid('', 'Bearer anything'), false);
});

test('cron rejects invalid credentials and accepts only the exact bearer secret', () => {
  assert.equal(isCronAuthorizationValid('expected-secret', 'Bearer wrong-secret'), false);
  assert.equal(isCronAuthorizationValid('expected-secret', 'expected-secret'), false);
  assert.equal(isCronAuthorizationValid('expected-secret', 'Bearer expected-secret'), true);
});
