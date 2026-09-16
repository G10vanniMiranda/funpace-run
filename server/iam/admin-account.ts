/**
 * ADMIN-IAM-001 Stage 1 — pure model for individual administrative accounts.
 *
 * Status is DERIVED, never stored. Role labels are centralised. The serializer is
 * the single safe projection for the future Users & Access API and must never
 * expose `password_hash` or any token material.
 *
 * Pure: no DB, no HTTP, no request context.
 */

export const ADMIN_ACCOUNT_ROLES = ['administrator', 'finance', 'operation'] as const;
export type AdminAccountRole = (typeof ADMIN_ACCOUNT_ROLES)[number];

/** Backend enum -> PT-BR label. Enum values are never changed. */
export const ADMIN_ROLE_LABELS: Record<AdminAccountRole, string> = {
  administrator: 'Administrador',
  finance: 'Financeiro',
  operation: 'Operação',
};

export function isAdminAccountRole(value: unknown): value is AdminAccountRole {
  return typeof value === 'string' && (ADMIN_ACCOUNT_ROLES as readonly string[]).includes(value);
}

export function adminRoleLabel(role: AdminAccountRole): string {
  return ADMIN_ROLE_LABELS[role];
}

export type AdminAccountStatus = 'disabled' | 'pending_invite' | 'active';

/** Minimal shape needed to reason about an account (subset of the DB record). */
export type AdminAccountLifecycle = {
  role: AdminAccountRole;
  passwordHash: string | null | undefined;
  disabledAt: string | null | undefined;
};

/**
 * Deterministic priority: `disabled` wins over everything (a disabled account is
 * `disabled` even if it never accepted its invite), then `pending_invite` (no
 * password yet), else `active`.
 */
export function deriveAdminAccountStatus(account: AdminAccountLifecycle): AdminAccountStatus {
  if (account.disabledAt) return 'disabled';
  if (account.passwordHash == null || account.passwordHash === '') return 'pending_invite';
  return 'active';
}

/**
 * Approved definition (Stage 0 §19): role administrator, not disabled, and the
 * invite has been accepted (password set). This is the ONLY definition used by
 * the last-administrator invariant — never a frontend count.
 */
export function isActiveAdministrator(account: AdminAccountLifecycle): boolean {
  return account.role === 'administrator' && deriveAdminAccountStatus(account) === 'active';
}

/** Full DB record shape (kept structurally compatible with AdminUserRecord). */
export type AdminAccountRecord = {
  id: string;
  email: string;
  name?: string | null;
  role: AdminAccountRole;
  passwordHash?: string | null;
  createdBy?: string | null;
  disabledBy?: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string | null;
  disabledAt?: string | null;
  // any extra columns are intentionally dropped by the serializer below.
  [key: string]: unknown;
};

export type SerializedAdminAccount = {
  id: string;
  name: string | null;
  email: string;
  role: AdminAccountRole;
  roleLabel: string;
  status: AdminAccountStatus;
  createdBy: string | null;
  disabledBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  disabledAt: string | null;
};

/**
 * Safe projection for the Users & Access surface. Allow-list only: `password_hash`
 * and any auth internals are structurally impossible to leak because the output
 * object is built field by field.
 */
export function serializeAdminAccount(account: AdminAccountRecord): SerializedAdminAccount {
  return {
    id: account.id,
    name: account.name ?? null,
    email: account.email,
    role: account.role,
    roleLabel: adminRoleLabel(account.role),
    status: deriveAdminAccountStatus({
      role: account.role,
      passwordHash: account.passwordHash ?? null,
      disabledAt: account.disabledAt ?? null,
    }),
    createdBy: account.createdBy ?? null,
    disabledBy: account.disabledBy ?? null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastLoginAt: account.lastLoginAt ?? null,
    disabledAt: account.disabledAt ?? null,
  };
}

/**
 * IAM audit action names. Defined here so IAM-2/3/5 emit consistent strings;
 * Stage 1 does not emit any of them.
 */
export const IAM_AUDIT_ACTIONS = {
  USER_INVITED: 'iam.user_invited',
  USER_ACTIVATED: 'iam.user_activated',
  USER_ROLE_CHANGED: 'iam.user_role_changed',
  USER_DISABLED: 'iam.user_disabled',
  USER_REACTIVATED: 'iam.user_reactivated',
  USER_SESSIONS_REVOKED: 'iam.user_sessions_revoked',
  PASSWORD_RESET_REQUESTED: 'iam.password_reset_requested',
  PASSWORD_CHANGED: 'iam.password_changed',
  LOGIN_SUCCESS: 'iam.login_success',
  LOGIN_FAILED: 'iam.login_failed',
  BREAKGLASS_USED: 'iam.breakglass_used',
} as const;

export type IamAuditAction = (typeof IAM_AUDIT_ACTIONS)[keyof typeof IAM_AUDIT_ACTIONS];
