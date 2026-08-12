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
  const appEnvironment = getAppEnvironment(environment);
  if (appEnvironment === 'development') return;

  const databaseUrl = String(environment.DATABASE_URL || '').trim();
  const expectedProjectRef = String(environment.EXPECTED_DATABASE_PROJECT_REF || '').trim();

  if (!databaseUrl || !expectedProjectRef || !databaseUrlMatchesProjectRef(databaseUrl, expectedProjectRef)) {
    throw new Error(`${appEnvironment} database isolation check failed.`);
  }
}

function resolvePaymentFlag(
  environment: NodeJS.ProcessEnv,
  dedicatedName: string,
  legacyName: string,
) {
  const dedicatedValue = environment[dedicatedName];
  return (dedicatedValue === undefined ? environment[legacyName] : dedicatedValue) === 'true';
}

function isHomologationPaymentCapabilityAllowed(
  environment: NodeJS.ProcessEnv,
  dedicatedName: string,
) {
  if (!isHomologationEnvironment(environment)) return true;
  return resolvePaymentFlag(environment, dedicatedName, 'HOMOLOGATION_PAYMENTS_ENABLED');
}

export function arePaymentCreationsAllowed(environment: NodeJS.ProcessEnv = process.env) {
  return resolvePaymentFlag(environment, 'PAYMENT_CREATION_ENABLED', 'PAYMENTS_ENABLED')
    && isHomologationPaymentCapabilityAllowed(environment, 'HOMOLOGATION_PAYMENT_CREATION_ENABLED');
}

export function arePaymentConfirmationsAllowed(environment: NodeJS.ProcessEnv = process.env) {
  return resolvePaymentFlag(environment, 'PAYMENT_CONFIRMATION_ENABLED', 'PAYMENTS_ENABLED')
    && isHomologationPaymentCapabilityAllowed(environment, 'HOMOLOGATION_PAYMENT_CONFIRMATION_ENABLED');
}

// Backwards-compatible alias for callers that still mean "create a new charge".
export function areExternalPaymentsAllowed(environment: NodeJS.ProcessEnv = process.env) {
  return arePaymentCreationsAllowed(environment);
}

export function isEmailDeliveryAllowed(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.EMAIL_ENABLED !== 'true') {
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
  if (environment.CRON_ENABLED !== 'true') {
    return false;
  }

  return !isHomologationEnvironment(environment)
    || environment.HOMOLOGATION_CRON_ENABLED === 'true';
}

export function areOutboundWebhooksAllowed(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.OUTBOUND_WEBHOOKS_ENABLED !== 'true') {
    return false;
  }

  return !isHomologationEnvironment(environment)
    || environment.HOMOLOGATION_OUTBOUND_WEBHOOKS_ENABLED === 'true';
}

export function getEnvironmentSafeguards(environment: NodeJS.ProcessEnv = process.env) {
  const paymentCreationAllowed = arePaymentCreationsAllowed(environment);
  const paymentConfirmationAllowed = arePaymentConfirmationsAllowed(environment);
  return {
    appEnvironment: getAppEnvironment(environment),
    databaseProjectRefConfigured: Boolean(environment.EXPECTED_DATABASE_PROJECT_REF?.trim()),
    externalPaymentsAllowed: paymentCreationAllowed,
    paymentCreationAllowed,
    paymentConfirmationAllowed,
    emailDeliveryAllowed: isEmailDeliveryAllowed(environment),
    googleSheetsAllowed: isGoogleSheetsAllowed(environment),
    cronExecutionAllowed: isCronExecutionAllowed(environment),
    outboundWebhooksAllowed: areOutboundWebhooksAllowed(environment),
  };
}
