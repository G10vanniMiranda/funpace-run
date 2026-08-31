import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_ROLE_LABELS,
  IAM_AUDIT_ACTIONS,
  adminRoleLabel,
  deriveAdminAccountStatus,
  isActiveAdministrator,
  isAdminAccountRole,
  serializeAdminAccount,
  type AdminAccountRecord,
} from '../server/iam/admin-account.js';
import {
  AUTH_TOKEN_TTL_MS,
  assertAuthTokenPurpose,
  authTokenExpiresAt,
  classifyAuthToken,
  generateAuthToken,
  hashAuthToken,
  isAuthTokenActive,
  isAuthTokenPurpose,
  verifyAuthToken,
} from '../server/iam/tokens.js';
import { revokeAllAdminSessionsForUserInPostgres } from '../server/database.js';

// ADMIN-IAM-001 Stage 1 — pure data & security primitives.

// ---- §39 status serializer ----

const baseAccount: AdminAccountRecord = {
  id: 'u1', email: 'a@x.com', name: 'A', role: 'administrator', passwordHash: 'scrypt$s$k',
  createdBy: null, disabledBy: null, createdAt: 't0', updatedAt: 't1', lastLoginAt: null, disabledAt: null,
};

test('§39 status: active / pending_invite / disabled, disabled wins over missing password', () => {
  assert.equal(deriveAdminAccountStatus({ role: 'administrator', passwordHash: 'h', disabledAt: null }), 'active');
  assert.equal(deriveAdminAccountStatus({ role: 'operation', passwordHash: null, disabledAt: null }), 'pending_invite');
  assert.equal(deriveAdminAccountStatus({ role: 'operation', passwordHash: '', disabledAt: null }), 'pending_invite');
  assert.equal(deriveAdminAccountStatus({ role: 'finance', passwordHash: 'h', disabledAt: 't' }), 'disabled');
  // disabled takes precedence even when the invite was never accepted
  assert.equal(deriveAdminAccountStatus({ role: 'administrator', passwordHash: null, disabledAt: 't' }), 'disabled');
});

// ---- §44 active-administrator definition ----

test('§44 isActiveAdministrator: only administrator + active counts', () => {
  assert.equal(isActiveAdministrator({ role: 'administrator', passwordHash: 'h', disabledAt: null }), true);
  assert.equal(isActiveAdministrator({ role: 'administrator', passwordHash: null, disabledAt: null }), false, 'pending invite admin does NOT count');
  assert.equal(isActiveAdministrator({ role: 'administrator', passwordHash: 'h', disabledAt: 't' }), false, 'disabled admin does NOT count');
  assert.equal(isActiveAdministrator({ role: 'finance', passwordHash: 'h', disabledAt: null }), false);
  assert.equal(isActiveAdministrator({ role: 'operation', passwordHash: 'h', disabledAt: null }), false);
});

// ---- §41 safe serializer — test by ABSENCE ----

test('§41 serializeAdminAccount never exposes password_hash / token material', () => {
  const withSecrets = {
    ...baseAccount,
    passwordHash: 'scrypt$SALT$SECRETKEY',
    password_hash: 'scrypt$SALT$SECRETKEY',
    tokenHash: 'deadbeef'.repeat(8),
    token_hash: 'deadbeef'.repeat(8),
    rawToken: 'super-secret',
  } as unknown as AdminAccountRecord;
  const out = serializeAdminAccount(withSecrets);
  const keys = Object.keys(out);
  for (const forbidden of ['passwordHash', 'password_hash', 'tokenHash', 'token_hash', 'rawToken']) {
    assert.equal(keys.includes(forbidden), false, `${forbidden} must be absent from the serialized account`);
  }
  assert.deepEqual(keys.sort(), [
    'createdAt', 'createdBy', 'disabledAt', 'disabledBy', 'email', 'id',
    'lastLoginAt', 'name', 'role', 'roleLabel', 'status', 'updatedAt',
  ]);
  assert.equal(out.roleLabel, 'Administrador');
  assert.equal(out.status, 'active');
  assert.equal(JSON.stringify(out).includes('SECRETKEY'), false);
});

test('§41 serializer tolerates the legacy bootstrap row (no name / null password)', () => {
  const legacy = { ...baseAccount, name: undefined, passwordHash: null } as unknown as AdminAccountRecord;
  const out = serializeAdminAccount(legacy);
  assert.equal(out.name, null);
  assert.equal(out.status, 'pending_invite');
});

// ---- §42 role labels ----

test('§42 role labels: all three, enum values unchanged', () => {
  assert.deepEqual(ADMIN_ROLE_LABELS, { administrator: 'Administrador', finance: 'Financeiro', operation: 'Operação' });
  assert.equal(adminRoleLabel('administrator'), 'Administrador');
  assert.equal(adminRoleLabel('finance'), 'Financeiro');
  assert.equal(adminRoleLabel('operation'), 'Operação');
  assert.equal(isAdminAccountRole('administrator'), true);
  assert.equal(isAdminAccountRole('root'), false);
  assert.equal(isAdminAccountRole(42), false);
});

// ---- §40 token primitives ----

test('§40 generateAuthToken: >= 256 bits entropy, url-safe, unique', () => {
  const a = generateAuthToken();
  const b = generateAuthToken();
  // base64url of 32 bytes -> 43 chars
  assert.ok(a.token.length >= 43, `token length ${a.token.length}`);
  assert.match(a.token, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a.token, b.token, 'two generated tokens differ');
  assert.notEqual(a.tokenHash, b.tokenHash);
});

test('§40 stored hash is not the raw token and is a stable sha256 hex', () => {
  const { token, tokenHash } = generateAuthToken();
  assert.notEqual(tokenHash, token);
  assert.match(tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(hashAuthToken(token), tokenHash, 'same raw token hashes consistently');
});

test('§40 verifyAuthToken: correct token passes, wrong token / malformed hash fail', () => {
  const { token, tokenHash } = generateAuthToken();
  assert.equal(verifyAuthToken(token, tokenHash), true);
  assert.equal(verifyAuthToken(`${token}x`, tokenHash), false);
  assert.equal(verifyAuthToken(generateAuthToken().token, tokenHash), false);
  assert.equal(verifyAuthToken(token, 'not-a-hash'), false);
  assert.equal(verifyAuthToken('', tokenHash), false);
  // never prints a token: assertions above compare booleans only
});

test('§14 token TTLs are centralised: invite 72h, reset 1h', () => {
  assert.equal(AUTH_TOKEN_TTL_MS.invite, 72 * 60 * 60 * 1000);
  assert.equal(AUTH_TOKEN_TTL_MS.reset, 60 * 60 * 1000);
  const from = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(authTokenExpiresAt('invite', from), '2026-01-04T00:00:00.000Z');
  assert.equal(authTokenExpiresAt('reset', from), '2026-01-01T01:00:00.000Z');
});

test('§13 token purpose: only invite / reset', () => {
  assert.equal(isAuthTokenPurpose('invite'), true);
  assert.equal(isAuthTokenPurpose('reset'), true);
  assert.equal(isAuthTokenPurpose('magic'), false);
  assert.equal(assertAuthTokenPurpose('invite'), 'invite');
  assert.throws(() => assertAuthTokenPurpose('login'), /Unknown auth token purpose/);
});

test('§15 token lifecycle: active / expired / consumed, consumed wins', () => {
  const now = new Date('2026-01-02T00:00:00.000Z');
  assert.equal(classifyAuthToken({ expiresAt: '2026-01-03T00:00:00.000Z', consumedAt: null }, now), 'active');
  assert.equal(classifyAuthToken({ expiresAt: '2026-01-01T00:00:00.000Z', consumedAt: null }, now), 'expired');
  assert.equal(classifyAuthToken({ expiresAt: '2026-01-03T00:00:00.000Z', consumedAt: '2026-01-01T12:00:00.000Z' }, now), 'consumed');
  assert.equal(classifyAuthToken({ expiresAt: 'not-a-date', consumedAt: null }, now), 'expired');
  assert.equal(isAuthTokenActive({ expiresAt: '2026-01-03T00:00:00.000Z', consumedAt: null }, now), true);
  assert.equal(isAuthTokenActive({ expiresAt: '2026-01-03T00:00:00.000Z', consumedAt: 'x' }, now), false);
});

// ---- §25 audit action constants exist (not emitted here) ----

test('§25 IAM audit action constants are defined and namespaced', () => {
  for (const key of [
    'USER_INVITED', 'USER_ACTIVATED', 'USER_ROLE_CHANGED', 'USER_DISABLED', 'USER_REACTIVATED',
    'USER_SESSIONS_REVOKED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_CHANGED', 'LOGIN_SUCCESS',
    'LOGIN_FAILED', 'BREAKGLASS_USED',
  ] as const) {
    assert.match(IAM_AUDIT_ACTIONS[key], /^iam\.[a-z_]+$/);
  }
});

// ---- §43 revoke-all-sessions primitive: behaviour via an injected fake client ----

function fakeClient() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = async (...args: unknown[]) => {
    calls.push({ sql: String(args[0]), params: (args[1] as unknown[]) ?? [] });
    return { rowCount: 2, rows: [] };
  };
  return { calls, query };
}

test('§43 revokeAllAdminSessionsForUserInPostgres targets the user by (lowercased) email and only unrevoked rows', async () => {
  const client = fakeClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = await revokeAllAdminSessionsForUserInPostgres('Ops.Person@Example.com', '2026-03-01T00:00:00.000Z', client as any);
  assert.equal(n, 2, 'returns the count of newly revoked sessions');
  assert.equal(client.calls.length, 1);
  const { sql, params } = client.calls[0];
  assert.match(sql, /update .*run-admin-sessions/s);
  assert.match(sql, /set\s+revoked_at\s*=\s*\$1/);
  assert.match(sql, /where\s+actor\s*=\s*\$2\s+and\s+revoked_at\s+is\s+null/);
  assert.deepEqual(params, ['2026-03-01T00:00:00.000Z', 'ops.person@example.com']);
});

test('§43 revoke-all is a no-op for an empty email (no query issued)', async () => {
  const client = fakeClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = await revokeAllAdminSessionsForUserInPostgres('   ', '2026-03-01T00:00:00.000Z', client as any);
  assert.equal(n, 0);
  assert.equal(client.calls.length, 0);
});
