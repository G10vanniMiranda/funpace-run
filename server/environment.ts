export type AppEnvironment = 'development' | 'homologation' | 'production';

const supportedEnvironments = new Set<AppEnvironment>(['development', 'homologation', 'production']);

export function getAppEnvironment(environment: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const configured = String(environment.APP_ENV || '').trim().toLowerCase();

  if (supportedEnvironments.has(configured as AppEnvironment)) {
    return configured as AppEnvironment;
  }

  return environment.VERCEL_ENV === 'production' ? 'production' : 'development';
}

export function isHomologationEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  return getAppEnvironment(environment) === 'homologation';
}

export function databaseUrlMatchesProjectRef(databaseUrl: string, projectRef: string) {
  const expected = projectRef.trim().toLowerCase();

  if (!/^[a-z0-9]{20}$/.test(expected)) {
    return false;
  }

  try {
    const parsed = new URL(databaseUrl);
    const candidates = [
      parsed.hostname,
      decodeURIComponent(parsed.username),
      parsed.pathname,
    ].map((value) => value.toLowerCase());

    return candidates.some((value) => value.includes(expected));
  } catch {
    return false;
  }
}

export function assertDatabaseEnvironmentIsolation(environment: NodeJS.ProcessEnv = process.env) {
  if (!isHomologationEnvironment(environment)) {
    return;
  }

  const databaseUrl = String(environment.DATABASE_URL || '').trim();
  const expectedProjectRef = String(environment.EXPECTED_DATABASE_PROJECT_REF || '').trim();

  if (!databaseUrl || !expectedProjectRef || !databaseUrlMatchesProjectRef(databaseUrl, expectedProjectRef)) {
    throw new Error('Homologation database isolation check failed.');
  }
}

export function areExternalPaymentsAllowed(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.PAYMENTS_ENABLED === 'false') {
    return false;
  }

  return !isHomologationEnvironment(environment)
    || environment.HOMOLOGATION_PAYMENTS_ENABLED === 'true';
}

export function isEmailDeliveryAllowed(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.EMAIL_ENABLED === 'false') {
    return false;
  }

  if (!isHomologationEnvironment(environment)) {
    return true;
  }

  return environment.EMAIL_ENABLED === 'true'
    && Boolean(environment.HOMOLOGATION_EMAIL_ALLOWLIST?.trim());
}

export function isEmailRecipientAllowed(recipient: string, environment: NodeJS.ProcessEnv = process.env) {
  if (!isEmailDeliveryAllowed(environment)) {
    return false;
  }

  if (!isHomologationEnvironment(environment)) {
    return true;
  }

  const normalizedRecipient = recipient.trim().toLowerCase();
  const allowlist = String(environment.HOMOLOGATION_EMAIL_ALLOWLIST || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return allowlist.includes(normalizedRecipient);
}

export function isGoogleSheetsAllowed(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.GOOGLE_SHEETS_ENABLED !== 'true') {
    return false;
  }

  return !isHomologationEnvironment(environment)
    || environment.HOMOLOGATION_GOOGLE_SHEETS_ENABLED === 'true';
}

export function isCronExecutionAllowed(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.CRON_ENABLED === 'false') {
    return false;
  }

  return !isHomologationEnvironment(environment)
    || environment.HOMOLOGATION_CRON_ENABLED === 'true';
}

export function areOutboundWebhooksAllowed(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.OUTBOUND_WEBHOOKS_ENABLED === 'false') {
    return false;
  }

  return !isHomologationEnvironment(environment)
    || environment.HOMOLOGATION_OUTBOUND_WEBHOOKS_ENABLED === 'true';
}

export function getEnvironmentSafeguards(environment: NodeJS.ProcessEnv = process.env) {
  return {
    appEnvironment: getAppEnvironment(environment),
    databaseProjectRefConfigured: Boolean(environment.EXPECTED_DATABASE_PROJECT_REF?.trim()),
    externalPaymentsAllowed: areExternalPaymentsAllowed(environment),
    emailDeliveryAllowed: isEmailDeliveryAllowed(environment),
    googleSheetsAllowed: isGoogleSheetsAllowed(environment),
    cronExecutionAllowed: isCronExecutionAllowed(environment),
    outboundWebhooksAllowed: areOutboundWebhooksAllowed(environment),
  };
}
