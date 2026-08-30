import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { validateRegistration } from '../src/lib/validation.js';
import type { CreateRegistrationResponse, MarketingAttributionTouch, RegistrationFormData, RegistrationStatus } from '../src/types/registration';
import { canUndoCheckIn, canUndoKit, getCheckInConflictMessage, getKitConflictMessage, validateBibAssignment } from './admin-guards.js';
import {
  attachCheckoutToPaymentInPostgres,
  cancelRegistrationInPostgres,
  claimRegistrationEmailInPostgres,
  completeRegistrationEmailInPostgres,
  confirmPaymentInPostgres,
  createAdminSessionInPostgres,
  createPendingRegistrationInPostgres,
  findAdminSessionInPostgres,
  findAdminUserInPostgres,
  expireTemporaryReservationsInPostgres,
  getDatabaseConfigurationIssue,
  getDatabaseRuntimeConfig,
  markPaymentCreationFailedInPostgres,
  getReconciliationDashboardInPostgres,
  getPartnerDashboardInPostgres,
  getPartnerDetailInPostgres,
  exportPartnerRegistrationsInPostgres,
  appendPartnerAuditLogInPostgres,
  appendRemarketingCheckoutReturnInPostgres,
  appendPartnerPaymentStatusAuditInPostgres,
  findPartnerRegistrationBySessionInPostgres,
  listAdminPartnersInPostgres,
  mutatePartnerWithAuditInPostgres,
  PartnerTypeChangeBlockedError,
  listPartnerAuditLogsInPostgres,
  getRegistrationPartnerAuditInPostgres,
  getPartnerMonitoringInPostgres,
  runPartnerConsistencyCheckInPostgres,
  listAdminEventsInPostgres,
  listOperationalAlertsInPostgres,
  synchronizeOperationalAlertsInPostgres,
  updateOperationalAlertInPostgres,
  updateMetaMarketingConsentInPostgres,
  createCriticalOperationalAlertInPostgres,
  persistReconciliationRunInPostgres,
  pingDatabase,
  revokeAdminSessionInPostgres,
  selectLotForRegistrationNumber,
  transaction,
  upsertAdminBootstrapInPostgres,
  usesPostgresDatabase,
  type Database,
  type PartnerRecord,
  type PartnerType,
  type PartnershipLeadRecord,
  type PartnershipLeadStatus,
  type PaymentRecord,
  type RegistrationRecord,
  type PartnerAnalyticsFilters,
} from './database.js';
import { normalizePartnerSlug, partnerTypes, validatePartnerInput } from './partner-management.js';
import { getPartnerAuditEventTitle } from './partner-audit-labels.js';
import { getEmailProvider, isEmailConfigured, sendRegistrationConfirmationEmail, type RegistrationEmailContext } from './email.js';
import {
  buildLegacyEmailSummaryPatch,
  buildEmailDeliveryIdempotencyKey,
  canClaimEmailDeliveryAfterLegacySummary,
  claimEmailDeliveryInMemory,
  completeEmailDeliveryInMemory,
  isLatestEmailDelivery,
  upsertEmailDeliveryOutboxInMemory,
} from './email-delivery-history.js';
import {
  processGoogleSheetSync,
  processGoogleSheetSyncBacklog,
  processQueuedGoogleSheetSyncs,
  getGoogleSheetsConfig,
  createGoogleSheetsClient,
  queueCheckInGoogleSheetSync,
  queueConfirmedPaymentGoogleSheetSync,
  queueRegistrationGoogleSheetSync,
  queueLotSummaryGoogleSheetSync,
  queuePartnershipGoogleSheetSync,
  queueRemarketingGoogleSheetSyncForRegistration,
  reconcileRemarketingGoogleSheetSyncs,
  reconcileConfirmedPaymentsGoogleSheetSync,
} from './google-sheets.js';
import { checkInfinitePayPayment, createInfinitePayCheckout, InfinitePayError } from './infinitepay.js';
import { calculateLotCapacity, selectLotWithAvailability, synchronizeLotProjections } from './lot-capacity.js';
import { detectLocalReconciliationIssues, generateReconciliationReport } from './payment-reconciliation.js';
import { isPaymentWebhookTokenValid } from './payment-webhook-auth.js';
import { buildRemarketingProjections, summarizeRemarketingProjections } from './remarketing.js';
import {
  buildCouponCampaignAuditPayload,
  isVolta10RemarketingAttribution,
  REMARKETING_CAMPAIGN_EVENTS,
  selectCampaignProjections,
  summarizeVolta10RemarketingCampaign,
  VOLTA10_REMARKETING_CAMPAIGN,
  VOLTA10_REMARKETING_SOURCE,
  type RemarketingCampaignManualEvent,
} from './remarketing-campaign.js';
import { buildExecutiveDashboard, buildRegistrationTimeline, detectOperationalAlerts } from './operational-intelligence.js';
import { buildExecutiveMetrics, financialVisibleForRole } from './executive-metrics.js';
import { eventContext, resolveEventScope, scopeDatabaseToEvent, type EventScopeErrorCode } from './event-scope.js';
import { businessDateKey, businessDateKeysEndingToday, businessTodayKey, businessWeekStart } from './business-time.js';
import { createExcelXml, createSimplePdf } from './report-export.js';
import { calculatePartnerPricing } from './partner-discount.js';
import { calculateCouponPricing, normalizeCouponCode } from './coupons.js';
import { readCookie, signPartnerSession, verifyPartnerSession } from './partner-session.js';
import {
  canTrackMetaBrowserPurchase,
  getMetaIntegrationStatus,
  processMetaIntegrationQueue,
  queueMetaCompleteRegistrationEvent,
  queueMetaInitiateCheckoutEvent,
  queueMetaPurchaseEvent,
  recoverMetaIntegrationEvents,
} from './meta-events.js';
import {
  enqueueMetaRegistrationFlow,
  resolveMetaCheckoutFlow,
  resolveMetaRegistrationFlow,
} from './meta-registration-flow.js';
import {
  bindMetaConsentRegistration,
  parseMarketingConsentDecision,
  signMetaConsentSession,
  verifyMetaConsentSession,
} from './meta-consent-session.js';
import { isMarketingConsentGranted } from '../src/lib/privacyConsent.js';
import { getMetaClientContext, normalizeMetaSourceUrl } from './meta-conversions-api.js';
import { isCronAuthorizationValid } from './cron-auth.js';
import {
  arePaymentConfirmationsAllowed,
  arePaymentCreationsAllowed,
  areOutboundWebhooksAllowed,
  getEnvironmentSafeguards,
  isHomologationEnvironment,
  isCronExecutionAllowed,
} from './environment.js';

const port = Number(process.env.API_PORT || 3001);
const defaultAllowedOrigins = [
  'https://funpace.club',
  'https://www.funpace.club',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];
const allowedOrigins = (process.env.ALLOWED_ORIGINS || defaultAllowedOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const apiPublicUrl = (process.env.API_PUBLIC_URL || appUrl).replace(/\/$/, '');
const paymentCreationAllowed = arePaymentCreationsAllowed();
const paymentConfirmationAllowed = arePaymentConfirmationsAllowed();
const paymentRuntimeAllowed = paymentCreationAllowed || paymentConfirmationAllowed;
const paymentProvider = paymentRuntimeAllowed ? process.env.PAYMENT_PROVIDER || '' : '';
const infinitePayHandle = paymentRuntimeAllowed
  ? process.env.INFINITEPAY_HANDLE || process.env.INFINITIPAY_HANDLE || ''
  : '';
const webhookSecret = paymentConfirmationAllowed ? process.env.PAYMENT_WEBHOOK_SECRET || '' : '';
const cronSecret = isCronExecutionAllowed() ? process.env.CRON_SECRET || '' : '';
const partnershipWebhookUrl = areOutboundWebhooksAllowed() ? process.env.PARTNERSHIP_WEBHOOK_URL || '' : '';
const adminApiKey = process.env.ADMIN_API_KEY || 'change-me';
const adminBootstrapEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const adminBootstrapPassword = String(process.env.ADMIN_PASSWORD || '');
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || adminApiKey;
const adminSessionSecretConfigured = adminSessionSecret.length >= 32 && adminSessionSecret !== adminApiKey;
const adminSessionTtlSeconds = Math.max(Number(process.env.ADMIN_SESSION_TTL_SECONDS || 28_800), 900);
const adminCookieName = 'funpace_admin_session';
const partnerCookieName = 'funpace_partner_session';
const metaConsentCookieName = 'funpace_meta_consent';
const metaConsentSessionTtlSeconds = 180 * 24 * 60 * 60;
const metaBrowserPurchaseMaxAgeMinutesInput = Number(process.env.META_BROWSER_PURCHASE_MAX_AGE_MINUTES || 1_440);
const metaBrowserPurchaseMaxAgeMs = Math.min(Math.max(
  Number.isFinite(metaBrowserPurchaseMaxAgeMinutesInput) ? metaBrowserPurchaseMaxAgeMinutesInput : 1_440,
  5,
), 1_440) * 60 * 1000;
const partnerSessionSecret = process.env.PARTNER_SESSION_SECRET || adminSessionSecret;
const partnerSessionTtlInput = Number(process.env.PARTNER_SESSION_TTL_SECONDS || 30 * 60);
const partnerSessionTtlSeconds = Number.isFinite(partnerSessionTtlInput)
  ? Math.min(Math.max(Math.trunc(partnerSessionTtlInput), 5 * 60), 60 * 60)
  : 30 * 60;
type AdminRole = 'administrator' | 'finance' | 'operation';
const isProduction = process.env.NODE_ENV === 'production';
const pendingPaymentTtlMinutesInput = Number(process.env.PENDING_PAYMENT_TTL_MINUTES || 30);
const pendingPaymentTtlMinutes = Number.isFinite(pendingPaymentTtlMinutesInput)
  ? Math.max(pendingPaymentTtlMinutesInput, 1)
  : 30;

const rateLimit = new Map<string, { count: number; resetAt: number }>();
const adminLoginIpRateLimit = new Map<string, { count: number; resetAt: number }>();
const adminLoginUserRateLimit = new Map<string, { count: number; resetAt: number }>();
const partnershipRateLimit = new Map<string, { count: number; resetAt: number }>();
const metaConsentRateLimit = new Map<string, { count: number; resetAt: number }>();

function setCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Webhook-Signature,X-Request-ID');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('X-Frame-Options', 'DENY');

  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function json(res: ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function setPartnerResponseCacheHeaders(res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const vary = String(res.getHeader('Vary') || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!vary.some((item) => item.toLowerCase() === 'cookie')) vary.push('Cookie');
  res.setHeader('Vary', vary.join(', '));
}

function createErrorId() {
  return `err_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

function logRequest(req: IncomingMessage, statusCode: number, message: string) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    method: req.method,
    path: req.url?.split('?')[0],
    statusCode,
    requestId: Array.isArray(req.headers['x-request-id']) ? req.headers['x-request-id'][0] : req.headers['x-request-id'],
    message,
  }));
}

function logServerError(req: IncomingMessage, error: unknown, errorId = createErrorId()) {
  console.error(JSON.stringify({
    at: new Date().toISOString(),
    errorId,
    method: req.method,
    path: req.url?.split('?')[0],
    requestId: Array.isArray(req.headers['x-request-id']) ? req.headers['x-request-id'][0] : req.headers['x-request-id'],
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined,
  }));

  if (usesPostgresDatabase()) {
    void createCriticalOperationalAlertInPostgres({
      dedupeKey: `api-error:${errorId}`,
      alertType: 'api_error',
      title: 'Exceção crítica na API',
      message: error instanceof Error ? error.message.slice(0, 500) : 'Erro desconhecido na API.',
      payload: {
        errorId,
        method: req.method,
        path: req.url?.split('?')[0],
        requestId: Array.isArray(req.headers['x-request-id']) ? req.headers['x-request-id'][0] : req.headers['x-request-id'],
      },
    }).catch(() => undefined);
  }

  return errorId;
}

async function recordOperationalAlert(input: Parameters<typeof synchronizeOperationalAlertsInPostgres>[0][number]) {
  if (!usesPostgresDatabase()) return;
  await synchronizeOperationalAlertsInPostgres([input]).catch((error) => {
    console.error(JSON.stringify({ at: new Date().toISOString(), message: 'operational_alert_persist_failed', error: error instanceof Error ? error.message : String(error) }));
  });
}

function csv(res: ServerResponse, filename: string, content: string) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  res.end(content);
}

function binary(res: ServerResponse, filename: string, contentType: string, content: Buffer | string) {
  res.writeHead(200, { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' });
  res.end(content);
}

type AdminSession = { id: string; actor: string; role: AdminRole; expiresAt: number };

function hashAdminPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const derivedKey = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

function verifyAdminPassword(password: string, passwordHash: string) {
  const [algorithm, salt, storedKey] = String(passwordHash || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !storedKey) {
    return false;
  }

  const derivedBuffer = Buffer.from(scryptSync(password, salt, 64).toString('hex'));
  const storedBuffer = Buffer.from(storedKey);
  return derivedBuffer.length === storedBuffer.length && timingSafeEqual(derivedBuffer, storedBuffer);
}

let adminBootstrapPromise: Promise<void> | null = null;

async function ensureAdminBootstrap() {
  if (!adminBootstrapEmail || !adminBootstrapPassword) {
    return;
  }

  if (!adminBootstrapPromise) {
    adminBootstrapPromise = (usesPostgresDatabase()
      ? upsertAdminBootstrapInPostgres(adminBootstrapEmail, hashAdminPassword(adminBootstrapPassword))
      : transaction((database) => {
      const now = new Date().toISOString();
      const existingUser = database.adminUsers.find((item) => item.email === adminBootstrapEmail);
      const passwordHash = hashAdminPassword(adminBootstrapPassword);

      if (existingUser) {
        existingUser.passwordHash = passwordHash;
        existingUser.role = 'administrator';
        existingUser.updatedAt = now;
        existingUser.disabledAt = null;
        return;
      }

      database.adminUsers.push({
        id: randomUUID(),
        email: adminBootstrapEmail,
        passwordHash,
        role: 'administrator',
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
        disabledAt: null,
      });
    }, { scope: 'admin-auth' })).then(() => {
      console.log(JSON.stringify({ at: new Date().toISOString(), message: 'admin_bootstrap_ensured' }));
    });
  }

  await adminBootstrapPromise;
}

function signAdminSession(session: AdminSession) {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = createHmac('sha256', adminSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function buildAdminCookie(token: string, maxAgeSeconds: number) {
  return `${adminCookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${isProduction ? '; Secure' : ''}`;
}

function buildPartnerCookie(token: string, maxAgeSeconds: number) {
  return `${partnerCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${isProduction ? '; Secure' : ''}`;
}

function buildMetaConsentCookie(token: string, maxAgeSeconds: number) {
  return `${metaConsentCookieName}=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${isProduction ? '; Secure' : ''}`;
}

function appendResponseCookie(res: ServerResponse, cookie: string) {
  const current = res.getHeader('Set-Cookie');
  const cookies = Array.isArray(current) ? current.map(String) : current ? [String(current)] : [];
  res.setHeader('Set-Cookie', [...cookies, cookie]);
}

function readMetaConsentSession(req: IncomingMessage) {
  return verifyMetaConsentSession(
    readCookie(req.headers.cookie, metaConsentCookieName),
    adminSessionSecret,
  );
}

function bindRegistrationToMetaConsentSession(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  if (!adminSessionSecretConfigured) return false;
  const session = bindMetaConsentRegistration(
    readMetaConsentSession(req),
    registrationId,
    Date.now(),
    metaConsentSessionTtlSeconds,
  );
  if (!session) return false;
  appendResponseCookie(
    res,
    buildMetaConsentCookie(signMetaConsentSession(session, adminSessionSecret), metaConsentSessionTtlSeconds),
  );
  return true;
}

function readPartnerSession(req: IncomingMessage) {
  return verifyPartnerSession(readCookie(req.headers.cookie, partnerCookieName), partnerSessionSecret);
}

function readSignedAdminSession(req: IncomingMessage): AdminSession | null {
  const cookie = String(req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${adminCookieName}=`));
  const token = cookie?.slice(adminCookieName.length + 1);
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', adminSessionSecret).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature); const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AdminSession;
    return session.expiresAt > Date.now() && session.actor && session.id ? session : null;
  } catch { return null; }
}

async function readAdminSession(req: IncomingMessage): Promise<AdminSession | null> {
  const signedSession = readSignedAdminSession(req);
  if (!signedSession) return null;

  const storedSession = usesPostgresDatabase()
    ? await findAdminSessionInPostgres(signedSession.id)
    : await transaction(
      (database) => database.adminSessions.find((item) => item.id === signedSession.id) || null,
      { persist: false, scope: 'admin-auth' },
    );

  if (!storedSession || storedSession.revokedAt) {
    return null;
  }

  const storedExpiresAt = new Date(storedSession.expiresAt).getTime();
  if (!Number.isFinite(storedExpiresAt) || storedExpiresAt <= Date.now()) {
    return null;
  }

  if (storedSession.actor !== signedSession.actor || storedSession.role !== signedSession.role || storedExpiresAt !== signedSession.expiresAt) {
    return null;
  }

  return signedSession;
}

async function requireAdmin(req: IncomingMessage, res: ServerResponse, roles?: AdminRole[]) {
  if (isProduction && !adminSessionSecretConfigured) { json(res, 503, { message: 'Configure ADMIN_SESSION_SECRET com pelo menos 32 caracteres.' }); return null; }

  const session = await readAdminSession(req);
  if (session && (!roles || roles.includes(session.role))) {
    return session;
  }

  if (session && roles) { json(res, 403, { message: 'Seu perfil nao possui permissao para esta acao.' }); return null; }

  json(res, 401, { message: 'Acesso administrativo nao autorizado.' });
  return null;
}

function requireAdminDatabase(res: ServerResponse) {
  const configurationIssue = getDatabaseConfigurationIssue();

  if (configurationIssue) {
    json(res, 503, { message: configurationIssue });
    return false;
  }

  if (!usesPostgresDatabase()) {
    json(res, 503, {
      message: 'Painel administrativo exige banco real Supabase/Postgres. Configure DATABASE_PROVIDER=supabase e DATABASE_URL.',
    });
    return false;
  }

  return true;
}

async function handleAdminLogin(req: IncomingMessage, res: ServerResponse) {
  if (!requireJson(req, res)) return;
  if (!requireAdminDatabase(res)) return;
  if (isProduction && !adminSessionSecretConfigured) { json(res, 503, { message: 'Configure ADMIN_SESSION_SECRET com pelo menos 32 caracteres.' }); return; }
  await ensureAdminBootstrap();
  const body = parseJsonBody<{ email?: string; password?: string; actor?: string; key?: string }>(await readBody(req));
  const suppliedEmail = compactText(body?.email || body?.actor, 120).toLowerCase();
  const suppliedPassword = String(body?.password || body?.key || '');
  if (isAdminLoginRateLimited(req, suppliedEmail)) { json(res, 429, { message: 'Muitas tentativas de login. Aguarde alguns minutos.' }); return; }
  const adminUser = usesPostgresDatabase()
    ? await findAdminUserInPostgres(suppliedEmail)
    : await transaction(
      (database) => database.adminUsers.find((item) => item.email === suppliedEmail && !item.disabledAt) || null,
      { persist: false, scope: 'admin-auth' },
    );
  if (!adminUser || !verifyAdminPassword(suppliedPassword, adminUser.passwordHash)) { json(res, 401, { message: 'Credenciais administrativas invalidas.' }); return; }
  resetAdminLoginRateLimit(req, suppliedEmail);
  const session = usesPostgresDatabase()
    ? await (() => {
      const now = new Date().toISOString();
      const nextSession: AdminSession = {
        id: randomUUID(),
        actor: adminUser.email,
        role: adminUser.role,
        expiresAt: Date.now() + adminSessionTtlSeconds * 1000,
      };
      return createAdminSessionInPostgres(adminUser.id, {
        id: nextSession.id,
        actor: nextSession.actor,
        role: nextSession.role,
        createdAt: now,
        expiresAt: new Date(nextSession.expiresAt).toISOString(),
        revokedAt: null,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      }).then((storedSession) => storedSession ? nextSession : null);
    })()
    : await transaction((database) => {
    const storedUser = database.adminUsers.find((item) => item.id === adminUser.id && !item.disabledAt);
    if (!storedUser) {
      return null;
    }

    const now = new Date().toISOString();
    storedUser.lastLoginAt = now;
    storedUser.updatedAt = now;

    const nextSession: AdminSession = {
      id: randomUUID(),
      actor: storedUser.email,
      role: storedUser.role,
      expiresAt: Date.now() + adminSessionTtlSeconds * 1000,
    };

    database.adminSessions.push({
      id: nextSession.id,
      actor: nextSession.actor,
      role: nextSession.role,
      createdAt: now,
      expiresAt: new Date(nextSession.expiresAt).toISOString(),
      revokedAt: null,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
    });

    return nextSession;
    }, { scope: 'admin-auth' });
  if (!session) { json(res, 401, { message: 'Credenciais administrativas invalidas.' }); return; }
  res.setHeader('Set-Cookie', buildAdminCookie(signAdminSession(session), adminSessionTtlSeconds));
  json(res, 200, { actor: session.actor, role: session.role, expiresAt: new Date(session.expiresAt).toISOString() });
}

async function handleAdminLogout(req: IncomingMessage, res: ServerResponse) {
  if (!requireAdminDatabase(res)) return;
  const session = await readAdminSession(req);
  if (session) {
    const revokedAt = new Date().toISOString();
    if (usesPostgresDatabase()) {
      await revokeAdminSessionInPostgres(session.id, revokedAt);
    } else {
      await transaction((database) => {
        const storedSession = database.adminSessions.find((item) => item.id === session.id);
        if (storedSession && !storedSession.revokedAt) {
          storedSession.revokedAt = revokedAt;
        }
      });
    }
  }
  res.setHeader('Set-Cookie', buildAdminCookie('', 0));
  json(res, 200, { ok: true });
}

function getClientIp(req: IncomingMessage) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const value = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.socket.remoteAddress || 'unknown';
  return String(value).split(',')[0].trim() || 'unknown';
}

function getUserAgent(req: IncomingMessage) {
  const userAgent = req.headers['user-agent'];
  if (typeof userAgent === 'string') {
    return userAgent.slice(0, 500);
  }

  return null;
}

function getClientKey(req: IncomingMessage) {
  return getClientIp(req);
}

function isRateLimited(req: IncomingMessage) {
  const key = getClientKey(req);
  const now = Date.now();
  const bucket = rateLimit.get(key);

  if (!bucket || bucket.resetAt < now) {
    rateLimit.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }

  bucket.count += 1;
  return bucket.count > 30;
}

function isPartnershipRateLimited(req: IncomingMessage) {
  const key = getClientKey(req);
  const now = Date.now();
  const bucket = partnershipRateLimit.get(key);

  if (!bucket || bucket.resetAt < now) {
    partnershipRateLimit.set(key, { count: 1, resetAt: now + 60 * 60_000 });
    return false;
  }

  bucket.count += 1;
  return bucket.count > 5;
}

function isMetaConsentRateLimited(req: IncomingMessage) {
  const key = getClientKey(req);
  const now = Date.now();
  const bucket = metaConsentRateLimit.get(key);
  if (!bucket || bucket.resetAt < now) {
    metaConsentRateLimit.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > 20;
}

function hitRateLimitBucket(store: Map<string, { count: number; resetAt: number }>, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = store.get(key);

  if (!bucket || bucket.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  bucket.count += 1;
  return bucket.count > limit;
}

function isAdminLoginRateLimited(req: IncomingMessage, username: string) {
  const ipKey = getClientIp(req);
  const userKey = `${ipKey}:${username.trim().toLowerCase() || 'unknown'}`;
  return hitRateLimitBucket(adminLoginIpRateLimit, ipKey, 10, 5 * 60_000)
    || hitRateLimitBucket(adminLoginUserRateLimit, userKey, 5, 10 * 60_000);
}

function resetAdminLoginRateLimit(req: IncomingMessage, username: string) {
  const ipKey = getClientIp(req);
  adminLoginIpRateLimit.delete(ipKey);
  adminLoginUserRateLimit.delete(`${ipKey}:${username.trim().toLowerCase() || 'unknown'}`);
}

function createAuditLog(
  req: IncomingMessage,
  session: AdminSession | null,
  entry: {
    actor?: string;
    actorRole?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    payload: unknown;
    createdAt?: string;
  },
) {
  return {
    id: randomUUID(),
    actor: entry.actor || session?.actor || 'system',
    actorRole: entry.actorRole ?? session?.role ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    payload: entry.payload,
    sessionId: session?.id || null,
    ipAddress: getClientIp(req),
    userAgent: getUserAgent(req),
    createdAt: entry.createdAt || new Date().toISOString(),
  };
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = '';

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');

      if (body.length > 20_000) {
        reject(new Error('Payload muito grande.'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function requireJson(req: IncomingMessage, res: ServerResponse) {
  const contentType = req.headers['content-type'] || '';

  if (Array.isArray(contentType) || !contentType.includes('application/json')) {
    json(res, 415, { message: 'Content-Type deve ser application/json.' });
    return false;
  }

  return true;
}

function parseJsonBody<T>(rawBody: string) {
  try {
    return JSON.parse(rawBody) as T;
  } catch {
    return null;
  }
}

function cpfHash(cpf: string) {
  return createHash('sha256').update(cpf.replace(/\D/g, '')).digest('hex');
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function maskCpf(cpf: string) {
  const digits = onlyDigits(cpf);

  if (digits.length !== 11) {
    return '***.***.***-**';
  }

  return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
}

function getAge(birthDate: string) {
  const date = new Date(`${birthDate}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
    age -= 1;
  }

  return age;
}

function sanitizeRegistration(input: RegistrationFormData): RegistrationFormData {
  const marketingConsent = isMarketingConsentGranted(input.meta?.marketingConsent);
  return {
    fullName: String(input.fullName || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    cpf: String(input.cpf || '').trim(),
    phone: String(input.phone || '').trim(),
    city: compactText(input.city, 120),
    state: compactText(input.state, 2).toUpperCase(),
    team: compactText(input.team, 120),
    birthDate: String(input.birthDate || '').trim(),
    gender: input.gender || '',
    shirtSize: input.shirtSize || 'M',
    distance: input.distance || '10K',
    emergencyContactName: String(input.emergencyContactName || '').trim(),
    emergencyContactPhone: String(input.emergencyContactPhone || '').trim(),
    termsAccepted: Boolean(input.termsAccepted),
    regulationAccepted: Boolean(input.regulationAccepted),
    privacyAccepted: Boolean(input.privacyAccepted),
    meta: { marketingConsent },
    attribution: input.attribution ? {
      source: compactText(input.attribution.source, 80),
      medium: compactText(input.attribution.medium, 80),
      campaign: compactText(input.attribution.campaign, 120),
      term: compactText(input.attribution.term, 120),
      content: compactText(input.attribution.content, 120),
      utmSource: compactText(input.attribution.utmSource, 80),
      utmMedium: compactText(input.attribution.utmMedium, 80),
      utmCampaign: compactText(input.attribution.utmCampaign, 120),
      referrer: compactText(input.attribution.referrer, 300),
      landingPage: compactText(input.attribution.landingPage, 300),
      fbclid: /^[A-Za-z0-9._-]+$/.test(compactText(input.attribution.fbclid, 180))
        ? compactText(input.attribution.fbclid, 180)
        : undefined,
      firstTouch: sanitizeAttributionTouch(input.attribution.firstTouch),
      lastTouch: sanitizeAttributionTouch(input.attribution.lastTouch),
    } : undefined,
  };
}

function sanitizeAttributionTouch(input: MarketingAttributionTouch | undefined) {
  if (!input || typeof input !== 'object') return undefined;
  const capturedAt = compactText(input.capturedAt, 40);
  const fbclid = compactText(input.fbclid, 180);
  return {
    utmSource: compactText(input.utmSource, 80),
    utmMedium: compactText(input.utmMedium, 80),
    utmCampaign: compactText(input.utmCampaign, 120),
    term: compactText(input.term, 120),
    content: compactText(input.content, 120),
    fbclid: /^[A-Za-z0-9._-]+$/.test(fbclid) ? fbclid : undefined,
    referrer: compactText(input.referrer, 300),
    landingPage: compactText(input.landingPage, 300),
    capturedAt: Number.isNaN(Date.parse(capturedAt)) ? undefined : capturedAt,
  };
}

function sanitizeMetaRegistrationContext(input: RegistrationFormData['meta']) {
  const marketingConsent = adminSessionSecretConfigured && isMarketingConsentGranted(input?.marketingConsent);
  if (!marketingConsent) return { marketingConsent: false };
  const initiatedAt = Number(input.initiatedAt);
  const fbp = compactText(input.fbp, 255);
  const fbc = compactText(input.fbc, 255);
  const fbclidCandidate = compactText(input.fbclid, 180);
  const fbclid = /^[A-Za-z0-9._-]+$/.test(fbclidCandidate) ? fbclidCandidate : '';
  const sourceUrl = compactText(input.sourceUrl, 500);
  return {
    ...(Number.isInteger(initiatedAt) ? { initiatedAt } : {}),
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {}),
    ...(fbclid ? { fbclid } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    marketingConsent: true,
  };
}

async function queueConfirmedMetaPurchase(registrationId: string) {
  try {
    const queued = await queueMetaPurchaseEvent(registrationId);
    if (queued) await processMetaIntegrationQueue(5);
  } catch (error) {
    console.error(JSON.stringify({
      at: new Date().toISOString(),
      provider: 'meta',
      eventName: 'Purchase',
      eventId: `purchase_${registrationId}`,
      registrationId,
      status: 'queue_failed',
      errorCode: error instanceof Error ? error.message.slice(0, 100) : 'META_QUEUE_FAILED',
    }));
  }
}

type PartnershipLeadPayload = {
  companyName?: string;
  contactName?: string;
  contactRole?: string;
  corporateEmail?: string;
  involvementMessage?: string;
  website?: string;
};

function compactText(value: unknown, maxLength: number) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizePartnershipLead(input: PartnershipLeadPayload) {
  return {
    companyName: compactText(input.companyName, 140),
    contactName: compactText(input.contactName, 120),
    contactRole: compactText(input.contactRole, 120),
    corporateEmail: compactText(input.corporateEmail, 180).toLowerCase(),
    involvementMessage: compactText(input.involvementMessage, 2000),
    website: compactText(input.website, 180),
  };
}

function validatePartnershipLead(payload: ReturnType<typeof sanitizePartnershipLead>) {
  const errors: Record<string, string> = {};
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.corporateEmail);

  if (!payload.companyName) {
    errors.companyName = 'Informe o nome da empresa.';
  }

  if (!payload.contactName) {
    errors.contactName = 'Informe o nome do contato.';
  }

  if (!payload.contactRole) {
    errors.contactRole = 'Informe o cargo ou area do contato.';
  }

  if (!emailIsValid) {
    errors.corporateEmail = 'Informe um e-mail corporativo valido.';
  }

  if (payload.involvementMessage.length < 10) {
    errors.involvementMessage = 'Descreva como a empresa gostaria de participar.';
  }

  return errors;
}

function toAdminPartnershipLead(lead: PartnershipLeadRecord) {
  return {
    id: lead.id,
    companyName: lead.companyName,
    contactName: lead.contactName,
    contactRole: lead.contactRole,
    corporateEmail: lead.corporateEmail,
    involvementMessage: lead.involvementMessage,
    status: lead.status,
    source: lead.source,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

async function notifyPartnershipTeam(lead: PartnershipLeadRecord) {
  if (!partnershipWebhookUrl) {
    return;
  }

  try {
    await fetch(partnershipWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'partnership.lead_created',
        lead: toAdminPartnershipLead(lead),
      }),
    });
  } catch (error) {
    console.error(JSON.stringify({
      at: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown partnership notification error',
      message: 'partnership_notification_failed',
    }));
  }
}

function verifyWebhookSignature(rawBody: string, signature: string | undefined) {
  if (!webhookSecret || !signature) {
    return false;
  }

  const expected = createHash('sha256').update(`${rawBody}.${webhookSecret}`).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
}

function getWebhookUrl() {
  const url = new URL('/api/webhooks/payment', apiPublicUrl);

  if (webhookSecret) {
    url.searchParams.set('token', webhookSecret);
  }

  return url.toString();
}

function getRegistrationSuccessUrl(registrationId: string) {
  const url = new URL('/sucesso', appUrl);
  url.searchParams.set('registrationId', registrationId);
  return url.toString();
}

function getRegistrationDescription(distanceName: string, lotName: string) {
  return `Inscricao FunPace Run 2026 - ${distanceName} - ${lotName}`;
}

function getPendingPaymentExpiresAt(createdAt: string) {
  return new Date(new Date(createdAt).getTime() + pendingPaymentTtlMinutes * 60_000).toISOString();
}

function getRegistrationExpiresAt(registration: RegistrationRecord) {
  return registration.expiresAt || getPendingPaymentExpiresAt(registration.createdAt);
}

function releaseRegistrationCapacity(database: Database, registration: RegistrationRecord) {
  void registration;
  synchronizeLotProjections(database);
}

function claimRegistrationCapacity(database: Database, registration: RegistrationRecord) {
  void registration;
  synchronizeLotProjections(database);
}

function ensureRegistrationBibNumber(database: Database, registration: RegistrationRecord) {
  if (registration.bibNumber) return;
  const nextNumber = database.registrations
    .filter((item) => item.eventId === registration.eventId && item.bibNumber)
    .map((item) => Number(String(item.bibNumber).replace(/\D/g, '')))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0) + 1;
  registration.bibNumber = String(nextNumber).padStart(4, '0');
}

function expirePendingPayments(database: Database, now = new Date()) {
  let expiredCount = 0;

  for (const registration of database.registrations) {
    const payment = database.payments.find((item) => item.registrationId === registration.id);

    // Payment confirmation is monotonic. A stale registration must never expire
    // when any persisted payment evidence already proves settlement.
    if (payment?.status === 'paid' || payment?.paidAt || registration.paidAt || registration.confirmedAt) {
      registration.status = 'paid';
      registration.expiresAt = null;
      registration.paidAt ||= payment?.paidAt || now.toISOString();
      registration.confirmedAt ||= registration.paidAt;
      if (registration.couponCode) registration.couponUsedAt ||= registration.paidAt;
      ensureRegistrationBibNumber(database, registration);
      registration.updatedAt = now.toISOString();
      if (payment) {
        payment.status = 'paid';
        payment.expiresAt = null;
      }
      continue;
    }

    if (registration.status !== 'pending_payment') {
      continue;
    }

    const expiresAt = getRegistrationExpiresAt(registration);

    registration.expiresAt = expiresAt;

    if (new Date(expiresAt).getTime() > now.getTime()) {
      continue;
    }

    registration.status = 'expired';
    registration.updatedAt = now.toISOString();
    expiredCount += 1;

    if (payment) {
      payment.status = 'expired';
      payment.updatedAt = now.toISOString();
      payment.expiresAt = payment.expiresAt || expiresAt;
    }

    releaseRegistrationCapacity(database, registration);
  }

  return expiredCount;
}

function findFirstValue(payload: unknown, keys: string[], depth = 0): unknown {
  if (!payload || typeof payload !== 'object' || depth > 4) {
    return undefined;
  }

  const record = payload as Record<string, unknown>;

  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
      return record[key];
    }
  }

  for (const value of Object.values(record)) {
    const found = findFirstValue(value, keys, depth + 1);

    if (found !== undefined && found !== null && found !== '') {
      return found;
    }
  }

  return undefined;
}

function toStringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value).trim()
    : '';
}

function toNumberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeGatewayAmount(value: unknown) {
  const parsed = toNumberValue(value);

  if (parsed === null) {
    return null;
  }

  return Number.isInteger(parsed) ? parsed : Math.round(parsed * 100);
}

export function toPaymentProviderStatus(event: {
  status?: string;
  paid?: boolean;
  amount?: number | string;
  paid_amount?: number | string;
  settledAt?: string;
} | null): RegistrationStatus {
  if (!event) {
    return 'pending_payment';
  }

  const status = String(event.status || '').trim().toLowerCase();
  const paidStatuses = new Set(['paid', 'approved', 'confirmed', 'completed', 'captured', 'settled', 'success', 'succeeded', 'received', 'recebido']);
  const failedStatuses = new Set(['payment_failed', 'failed', 'declined', 'denied', 'refused', 'rejected']);
  const cancelledStatuses = new Set(['cancelled', 'canceled', 'voided']);

  if (paidStatuses.has(status) || event.paid === true) {
    return 'paid';
  }

  const amount = normalizeGatewayAmount(event.amount);
  const paidAmount = normalizeGatewayAmount(event.paid_amount);

  if (amount !== null && paidAmount !== null && paidAmount >= amount) {
    return 'paid';
  }

  if (String(event.settledAt || '').trim()) {
    return 'paid';
  }

  if (cancelledStatuses.has(status)) {
    return 'cancelled';
  }

  if (status === 'refunded') {
    return 'refunded';
  }

  if (status === 'expired') {
    return 'expired';
  }

  if (failedStatuses.has(status)) {
    return 'payment_failed';
  }

  return 'pending_payment';
}

export function resolvePaymentTransition(current: RegistrationStatus, incoming: RegistrationStatus): RegistrationStatus {
  return current === 'paid' && incoming !== 'paid' ? 'paid' : incoming;
}

type NormalizedPaymentWebhook = {
  registrationId: string;
  providerEventId: string;
  providerTransactionId: string;
  providerPaymentId: string;
  eventType: string;
  gatewayStatus: string;
  paymentMethod: string;
  amountCents: number | null;
  paidAmountCents: number | null;
  receiptUrl: string;
  nextStatus: RegistrationStatus;
};

export function normalizePaymentWebhook(rawEvent: unknown): NormalizedPaymentWebhook | null {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null;
  }

  const registrationId = toStringValue(findFirstValue(rawEvent, [
    'registrationId',
    'registration_id',
    'order_nsu',
    'orderNsu',
    'order_id',
    'orderId',
    'external_id',
    'externalId',
    'reference_id',
    'referenceId',
  ]));
  const providerTransactionId = toStringValue(findFirstValue(rawEvent, [
    'transaction_nsu',
    'transactionNsu',
    'transaction_id',
    'transactionId',
    'transaction_uuid',
    'payment_id',
    'paymentId',
  ]));
  const providerPaymentId = toStringValue(findFirstValue(rawEvent, [
    'invoice_slug',
    'invoiceSlug',
    'slug',
    'checkout_slug',
    'checkoutSlug',
    'invoice_id',
    'invoiceId',
    'link_id',
    'linkId',
  ]));
  const providerEventId = toStringValue(findFirstValue(rawEvent, [
    'providerEventId',
    'event_id',
    'eventId',
    'id',
  ])) || providerTransactionId || providerPaymentId;
  const eventType = toStringValue(findFirstValue(rawEvent, ['eventType', 'event_type', 'type'])) || 'infinitepay.payment_status_changed';
  const gatewayStatus = toStringValue(findFirstValue(rawEvent, ['status', 'payment_status', 'paymentStatus', 'transaction_status', 'transactionStatus', 'invoice_status', 'invoiceStatus']));
  const amountCents = normalizeGatewayAmount(findFirstValue(rawEvent, ['amount', 'amount_cents', 'amountCents', 'total_amount', 'totalAmount', 'value']));
  const paidAmountCents = normalizeGatewayAmount(findFirstValue(rawEvent, ['paid_amount', 'paidAmount', 'paid_amount_cents', 'received_amount', 'receivedAmount']));
  const paidValue = findFirstValue(rawEvent, ['paid', 'is_paid', 'isPaid']);
  const settledAt = toStringValue(findFirstValue(rawEvent, ['paid_at', 'paidAt', 'received_at', 'receivedAt', 'settled_at', 'settledAt']));
  const paid = paidValue === true || String(paidValue).toLowerCase() === 'true';
  const nextStatus = toPaymentProviderStatus({
    status: gatewayStatus,
    paid,
    amount: amountCents ?? undefined,
    paid_amount: paidAmountCents ?? undefined,
    settledAt,
  });

  return {
    registrationId,
    providerEventId,
    providerTransactionId,
    providerPaymentId,
    eventType,
    gatewayStatus,
    paymentMethod: toStringValue(findFirstValue(rawEvent, ['payment_method', 'paymentMethod', 'method', 'payment_type', 'paymentType', 'capture_method'])),
    amountCents,
    paidAmountCents,
    receiptUrl: toStringValue(findFirstValue(rawEvent, ['receipt_url', 'receiptUrl'])),
    nextStatus,
  };
}

export function validateInfinitePayApproval(event: NormalizedPaymentWebhook | null) {
  if (!event) return 'invalid_payload';
  if (!event.registrationId) return 'missing_order_nsu';
  if (!event.providerTransactionId) return 'missing_transaction_nsu';
  if (!event.providerPaymentId) return 'missing_invoice_slug';
  if (event.amountCents === null || event.amountCents <= 0) return 'invalid_amount';
  if (event.nextStatus !== 'paid') return 'not_paid';
  return null;
}

type PendingCheckout = CreateRegistrationResponse & {
  statusCode: number;
  amountCents?: number;
  description?: string;
  shouldCreateCheckout?: boolean;
};

async function markPaymentCreationFailed(registrationId: string) {
  if (usesPostgresDatabase()) {
    await markPaymentCreationFailedInPostgres(registrationId);
    return;
  }

  await transaction((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);
    const payment = database.payments.find((item) => item.registrationId === registrationId);
    const now = new Date().toISOString();

    if (registration?.status === 'pending_payment') {
      registration.status = 'payment_failed';
      registration.updatedAt = now;
      releaseRegistrationCapacity(database, registration);
    }

    if (payment) {
      payment.status = 'payment_failed';
      payment.updatedAt = now;
    }
  }, { scope: 'checkout' });
}

function findPaymentMethod(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['payment_method', 'paymentMethod', 'method', 'payment_type', 'paymentType', 'capture_method']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  for (const nested of Object.values(record)) {
    const found = findPaymentMethod(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

export async function processRegistrationEmail(registrationId: string, options: { force?: boolean; contextKey?: string | null } = {}) {
  const provider = getEmailProvider();
  const now = new Date().toISOString();

  if (!isEmailConfigured()) {
    await transaction((database) => {
      const registration = database.registrations.find((item) => item.id === registrationId);

      if (!registration) {
        return;
      }

      database.auditLogs.push({
        id: randomUUID(),
        actor: 'system',
        action: 'email.confirmation.skipped',
        entityType: 'registration',
        entityId: registration.id,
        payload: {
          provider,
          email: registration.payload.email,
          reason: 'email provider not configured',
        },
        createdAt: now,
      });
    }, { scope: 'checkout' });

    console.log(JSON.stringify({
      at: now,
      message: 'registration_email_skipped',
      kind: 'confirmation',
      provider,
      registrationId,
      reason: 'email provider not configured',
    }));
    return { ok: false, skipped: true, provider, error: 'Email provider not configured.' };
  }

  const context = usesPostgresDatabase()
    ? await claimRegistrationEmailInPostgres(registrationId, provider, options)
    : await transaction<(RegistrationEmailContext & { deliveryId: string }) | null>((database) => {
      const registration = database.registrations.find((item) => item.id === registrationId);

      if (!registration) {
        return null;
      }

      if (registration.status !== 'paid') {
        return null;
      }

      const event = database.events.find((item) => item.id === registration.eventId);
      const distance = database.distances.find((item) => item.id === registration.distanceId);
      const lot = database.lots.find((item) => item.id === registration.lotId) || null;
      const payment = database.payments.find((item) => item.registrationId === registration.id) || null;

      if (!event || !distance) {
        database.auditLogs.push({
          id: randomUUID(),
          actor: 'system',
          action: 'email.confirmation.failed',
          entityType: 'registration',
          entityId: registration.id,
          payload: {
            provider,
            email: registration.payload.email,
            reason: 'registration email context missing',
          },
          createdAt: now,
        });
        return null;
      }


      const emailDeliveries = database.emailDeliveries || (database.emailDeliveries = []);
      const idempotencyKey = buildEmailDeliveryIdempotencyKey({
        registrationId: registration.id,
        kind: 'confirmation',
        recipientEmail: registration.payload.email,
        contextKey: options.contextKey,
      });
      const existingDelivery = emailDeliveries.some((item) => item.idempotencyKey === idempotencyKey);
      if (!canClaimEmailDeliveryAfterLegacySummary({
        legacySentAt: registration.confirmationEmailSentAt,
        force: options.force,
        contextKey: options.contextKey,
        existingDelivery,
      })) return null;
      const deliveryClaim = claimEmailDeliveryInMemory(emailDeliveries, {
        registrationId: registration.id,
        kind: 'confirmation',
        recipientEmail: registration.payload.email,
        provider,
        contextKey: options.contextKey,
        metadata: { source: 'registration_confirmation' },
      }, now);
      if (deliveryClaim.outcome !== 'claimed') return null;
      const delivery = deliveryClaim.delivery;
      registration.confirmationEmailLastAttemptAt = now;

      database.auditLogs.push({
        id: randomUUID(),
        actor: 'system',
        action: 'email.confirmation.attempted',
        entityType: 'registration',
        entityId: registration.id,
        payload: {
          provider,
          email: registration.payload.email,
          deliveryId: delivery.id,
        },
        createdAt: now,
      });

      return {
        deliveryId: delivery.id,
        registration: { ...registration, payload: { ...registration.payload } },
        event: { ...event },
        distanceName: distance.name,
        lot: lot ? { ...lot } : null,
        paymentMethod: findPaymentMethod(payment?.gatewayPayload) || payment?.gatewayStatus || null,
        deliveryKey: `confirmation/${registration.id}/${delivery.id}`,
      };
    }, { scope: 'checkout' });

  if (!context) {
    return null;
  }

  let result;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      result = await sendRegistrationConfirmationEmail(context);
    } catch (error) {
      result = {
        ok: false,
        provider,
        error: error instanceof Error ? error.message : 'Unknown email error',
      };
    }

    if (result.ok || attempt === maxAttempts) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }

  if (result.ok && !result.providerMessageId) {
    result = { ok: false, provider: result.provider, error: 'Email provider did not return a message id.' };
  }

  const completedAt = new Date().toISOString();

  const emailSheetSync = usesPostgresDatabase()
    ? await completeRegistrationEmailInPostgres(registrationId, context.deliveryId, result)
    : await transaction((database) => {
      const registration = database.registrations.find((item) => item.id === registrationId);

      if (!registration) {
        return null;
      }

      const delivery = database.emailDeliveries?.find((item) => item.id === context.deliveryId);
      if (!delivery) throw new Error('Email delivery not found for completion.');
      completeEmailDeliveryInMemory(delivery, result, completedAt);
      if (isLatestEmailDelivery(database.emailDeliveries || [], delivery.id)) {
        Object.assign(registration, buildLegacyEmailSummaryPatch(result, completedAt));
      }

      database.auditLogs.push({
        id: randomUUID(),
        actor: 'system',
        action: result.ok ? 'email.confirmation.sent' : 'email.confirmation.failed',
        entityType: 'registration',
        entityId: registration.id,
        payload: {
          deliveryId: context.deliveryId,
          provider: result.provider,
          email: registration.payload.email,
          providerMessageId: result.providerMessageId || null,
          error: result.ok ? null : result.error || 'Email send failed',
        },
        createdAt: completedAt,
      });
      return upsertEmailDeliveryOutboxInMemory(database.googleSheetSyncs, context.deliveryId, completedAt);
    }, { scope: 'checkout' });

  if (!result.ok) await recordOperationalAlert({
    dedupeKey: `resend:${registrationId}`, severity: 'critical', alertType: 'resend_error',
    title: 'Erro no Resend', message: result.error || 'Falha no envio do e-mail de confirmação.', entityType: 'registration', entityId: registrationId,
  });
  if (emailSheetSync && getGoogleSheetsConfig().enabled) await processGoogleSheetSync(emailSheetSync.id);

  console.log(JSON.stringify({
    at: completedAt,
    message: result.ok ? 'registration_email_sent' : 'registration_email_failed',
    kind: 'confirmation',
    provider: result.provider,
    registrationId,
    email: context.registration.payload.email,
    providerMessageId: result.providerMessageId,
    error: result.ok ? undefined : result.error,
  }));

  return result;
}

async function processPaymentConfirmationEmail(req: IncomingMessage, registrationId: string) {
  try {
    return await processRegistrationEmail(registrationId);
  } catch (error) {
    logServerError(req, error);
    return null;
  }
}

function resolvePublicPartnerContext(database: Database, partnerId?: string, slug?: string) {
  const partner = database.partners.find((item) => !item.deletedAt
    && (partnerId ? item.id === partnerId : item.slug === normalizePartnerSlug(slug || '')));
  if (!partner || partner.status !== 'active') return null;
  const event = database.events.find((item) => item.slug === 'funpace-run-2026' && item.status === 'published');
  if (!event) return null;
  const lot = selectLotWithAvailability(database.lots, database.registrations, event.id);
  if (!lot) return null;
  const pricing = calculatePartnerPricing(lot.priceCents, partner);
  return pricing ? {
    id: partner.id,
    name: partner.name,
    slug: partner.slug,
    partnerType: partner.partnerType,
    resolutionStatus: 'approved' as const,
    discountPercentage: pricing.discountPercentage,
    discountAmountCents: pricing.discountAmountCents,
    originalPriceCents: pricing.originalPriceCents,
    finalPriceCents: pricing.finalPriceCents,
  } : null;
}

function toPublicPartnerContext(context: NonNullable<ReturnType<typeof resolvePublicPartnerContext>>) {
  const { id: _id, ...publicContext } = context;
  return publicContext;
}

async function handleActivatePartnerLink(req: IncomingMessage, res: ServerResponse, rawSlug: string) {
  setPartnerResponseCacheHeaders(res);
  if (!requireAdminDatabase(res)) return;
  const slug = normalizePartnerSlug(rawSlug);
  const database = await transaction((current) => current, { persist: false, scope: 'availability' });
  const existing = database.partners.find((partner) => partner.slug === slug);
  const context = resolvePublicPartnerContext(database, undefined, slug);
  if (!context) {
    const reason = !existing ? 'slug_not_found' : existing.deletedAt ? 'partner_removed' : existing.status !== 'active' ? 'partner_inactive' : 'invalid_discount_or_unavailable';
    const publicMessage = reason === 'slug_not_found'
      ? 'Link de parceiro invalido.'
      : reason === 'partner_removed'
        ? 'Este link de parceiro foi removido.'
        : reason === 'partner_inactive'
          ? 'Este parceiro esta inativo no momento.'
          : 'Este beneficio esta temporariamente indisponivel.';
    await appendPartnerAuditLogInPostgres({ partnerId: existing?.id || null, action: 'partner.link_rejected', metadata: { slug, reason, partnerType: existing?.partnerType || null, partner_type: existing?.partnerType || null }, ipAddress: getClientIp(req), userAgent: getUserAgent(req) });
    await recordOperationalAlert({ dedupeKey: `partner-link-rejected:${slug}:${new Date().toISOString().slice(0, 10)}`, severity: existing ? 'critical' : 'warning', alertType: existing ? 'inactive_partner_access' : 'invalid_partner_slug', title: existing ? 'Parceiro inativo recebeu acesso' : 'Slug de parceiro inexistente', message: existing ? `O link /p/${slug} foi acessado enquanto o parceiro estava indisponivel.` : `Tentativa de acesso ao link inexistente /p/${slug}.`, entityType: 'partner', entityId: existing?.id || slug, payload: { slug, reason } });
    res.setHeader('Set-Cookie', buildPartnerCookie('', 0));
    json(res, existing ? 410 : 404, {
      message: publicMessage,
    });
    return;
  }
  const previousSession = readPartnerSession(req);
  const isReplacement = Boolean(previousSession && (previousSession.partnerId !== context.id || previousSession.slug !== context.slug));
  if (isReplacement && previousSession) {
    const persisted = usesPostgresDatabase()
      ? await findPartnerRegistrationBySessionInPostgres({ correlationId: previousSession.correlationId, accessAuditId: previousSession.accessAuditId })
      : null;
    if (persisted) {
      await appendPartnerAuditLogInPostgres({
        partnerId: context.id,
        action: 'partner.session_replacement_blocked',
        registrationId: persisted.registrationId,
        oldData: { partnerId: previousSession.partnerId, partnerType: previousSession.partnerType || persisted.partnerType },
        newData: { requestedPartnerId: context.id, requestedPartnerType: context.partnerType },
        metadata: { reason: 'registration_already_persisted', correlationId: previousSession.correlationId || null, previousPartnerId: previousSession.partnerId, requestedPartnerId: context.id, partnerType: context.partnerType, partner_type: context.partnerType },
        ipAddress: getClientIp(req), userAgent: getUserAgent(req),
      });
      json(res, 409, { message: 'A inscricao existente permanece vinculada ao beneficio identificado anteriormente.' });
      return;
    }
  }
  const eventId = database.events.find((item) => item.slug === 'funpace-run-2026')?.id || null;
  const correlationId = isReplacement || !previousSession?.correlationId ? randomUUID() : previousSession.correlationId;
  const auditMetadata = { correlationId, partnerType: context.partnerType, partner_type: context.partnerType };
  const accessAuditId = await appendPartnerAuditLogInPostgres({ partnerId: context.id, action: 'partner.link_accessed', eventId, newData: { slug: context.slug, link: `/p/${context.slug}`, partnerType: context.partnerType }, metadata: auditMetadata, ipAddress: getClientIp(req), userAgent: getUserAgent(req) });
  await appendPartnerAuditLogInPostgres({ partnerId: context.id, action: 'partner.resolution_approved', eventId, newData: { slug: context.slug, partnerType: context.partnerType }, metadata: auditMetadata, ipAddress: getClientIp(req), userAgent: getUserAgent(req) });
  if (isReplacement && previousSession) {
    await appendPartnerAuditLogInPostgres({ partnerId: context.id, action: 'partner.session_replaced', eventId, oldData: { partnerId: previousSession.partnerId, slug: previousSession.slug, partnerType: previousSession.partnerType || null }, newData: { partnerId: context.id, slug: context.slug, partnerType: context.partnerType }, metadata: { ...auditMetadata, previousCorrelationId: previousSession.correlationId || null }, ipAddress: getClientIp(req), userAgent: getUserAgent(req) });
  }
  const now = Date.now();
  const token = signPartnerSession({ partnerId: context.id, slug: context.slug, partnerType: context.partnerType, issuedAt: now, expiresAt: now + partnerSessionTtlSeconds * 1000, correlationId, accessAuditId }, partnerSessionSecret);
  await appendPartnerAuditLogInPostgres({ partnerId: context.id, action: 'partner.session_created', eventId, newData: { slug: context.slug, partnerType: context.partnerType, expiresAt: now + partnerSessionTtlSeconds * 1000 }, metadata: auditMetadata, ipAddress: getClientIp(req), userAgent: getUserAgent(req) });
  res.setHeader('Set-Cookie', buildPartnerCookie(token, partnerSessionTtlSeconds));
  json(res, 200, { partner: toPublicPartnerContext(context) });
}

async function handlePartnerSession(req: IncomingMessage, res: ServerResponse) {
  setPartnerResponseCacheHeaders(res);
  if (!requireAdminDatabase(res)) return;
  const session = readPartnerSession(req);
  if (!session) { json(res, 200, { partner: null }); return; }
  const database = await transaction((current) => current, { persist: false, scope: 'availability' });
  const context = resolvePublicPartnerContext(database, session.partnerId);
  if (!context || context.slug !== session.slug || (session.partnerType && context.partnerType !== session.partnerType)) {
    res.setHeader('Set-Cookie', buildPartnerCookie('', 0));
    json(res, 200, { partner: null }); return;
  }
  json(res, 200, { partner: toPublicPartnerContext(context) });
}

function handleClearPartnerSession(res: ServerResponse) {
  setPartnerResponseCacheHeaders(res);
  res.setHeader('Set-Cookie', buildPartnerCookie('', 0));
  json(res, 200, { partner: null });
}

async function handleMetaMarketingConsent(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (!requireJson(req, res)) return;
  if (isMetaConsentRateLimited(req)) {
    json(res, 429, { message: 'Muitas atualizacoes de consentimento. Aguarde um minuto.' });
    return;
  }
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  if ((origin && !allowedOrigins.includes(origin)) || (isProduction && !origin)) {
    json(res, 403, { message: 'Origem nao autorizada.' });
    return;
  }
  if (!usesPostgresDatabase()) {
    json(res, 503, { message: 'Persistencia de consentimento indisponivel.' });
    return;
  }
  if (isProduction && !adminSessionSecretConfigured) {
    json(res, 503, { message: 'Persistencia segura de consentimento indisponivel.' });
    return;
  }

  const body = parseJsonBody<unknown>(await readBody(req));
  const marketing = parseMarketingConsentDecision(body);
  if (marketing === null) {
    json(res, 422, { message: 'Decisao de consentimento invalida.' });
    return;
  }

  const rawToken = readCookie(req.headers.cookie, metaConsentCookieName);
  if (!rawToken) {
    res.writeHead(204);
    res.end();
    return;
  }
  const session = verifyMetaConsentSession(rawToken, adminSessionSecret);
  if (!session) {
    appendResponseCookie(res, buildMetaConsentCookie('', 0));
    json(res, 401, { message: 'Vinculo de consentimento invalido ou expirado.' });
    return;
  }

  const result = await updateMetaMarketingConsentInPostgres(session.registrationIds, marketing);
  logRequest(req, 200, marketing ? 'marketing_consent_granted' : 'marketing_consent_revoked');
  json(res, 200, { ok: true, updated: result.updatedRegistrations, blockedEvents: result.blockedEvents });
}

function buildDurableMetaContext(req: IncomingMessage, meta: ReturnType<typeof sanitizeMetaRegistrationContext>) {
  if (!isMarketingConsentGranted(meta.marketingConsent)) return {};
  const client = getMetaClientContext(req, meta);
  return {
    ...(client.clientIpAddress ? { client_ip_address: client.clientIpAddress } : {}),
    ...(client.clientUserAgent ? { client_user_agent: client.clientUserAgent } : {}),
    ...(client.fbp ? { fbp: client.fbp } : {}),
    ...(client.fbc ? { fbc: client.fbc } : {}),
    ...('fbclid' in meta && meta.fbclid ? { fbclid: meta.fbclid } : {}),
    event_source_url: normalizeMetaSourceUrl('sourceUrl' in meta ? meta.sourceUrl : undefined, '/'),
    captured_at: new Date().toISOString(),
  };
}

async function handleValidateCoupon(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (!requireJson(req, res)) return;
  if (isRateLimited(req)) {
    json(res, 429, { message: 'Muitas tentativas. Aguarde um minuto e tente novamente.' });
    return;
  }
  const body = parseJsonBody<{ code?: unknown; partnerBenefitRequested?: boolean }>(await readBody(req));
  const code = normalizeCouponCode(body?.code);
  if (!code) {
    json(res, 422, { message: 'Informe um cupom.' });
    return;
  }
  if (body?.partnerBenefitRequested === true && readPartnerSession(req)) {
    json(res, 409, { message: 'O cupom não pode ser combinado com outro desconto.' });
    return;
  }

  const database = await transaction((current) => current, { persist: false, scope: 'availability' });
  const event = database.events.find((item) => item.slug === 'funpace-run-2026' && item.status === 'published');
  const lot = event ? selectLotWithAvailability(database.lots, database.registrations, event.id) : null;
  const pricing = lot ? calculateCouponPricing(lot.priceCents, code) : null;
  if (!pricing) {
    json(res, 422, { message: 'Cupom inválido.' });
    return;
  }
  json(res, 200, pricing);
}

async function recordRemarketingCheckoutReturn(
  req: IncomingMessage,
  registrationId: string,
  attribution: RegistrationFormData['attribution'],
) {
  if (!registrationId || !isVolta10RemarketingAttribution(attribution)) return;
  if (usesPostgresDatabase()) {
    await appendRemarketingCheckoutReturnInPostgres(createAuditLog(req, null, {
      action: 'remarketing.checkout_returned',
      entityType: 'registration',
      entityId: registrationId,
      payload: {
        campaign: VOLTA10_REMARKETING_CAMPAIGN,
        source: VOLTA10_REMARKETING_SOURCE,
        personKey: null,
      },
    }));
    return;
  }
  await transaction((database) => {
    const alreadyRecorded = database.auditLogs.some((log) => log.action === 'remarketing.checkout_returned'
      && log.entityId === registrationId
      && (log.payload as Record<string, unknown> | null)?.campaign === VOLTA10_REMARKETING_CAMPAIGN);
    if (alreadyRecorded) return;
    const projection = buildRemarketingProjections(database).find((item) => item.registrationIds.includes(registrationId));
    database.auditLogs.push(createAuditLog(req, null, {
      action: 'remarketing.checkout_returned',
      entityType: 'registration',
      entityId: registrationId,
      payload: {
        campaign: VOLTA10_REMARKETING_CAMPAIGN,
        source: VOLTA10_REMARKETING_SOURCE,
        personKey: projection?.personKey || null,
      },
    }));
  }, { scope: 'checkout' });
}

async function handleCreateRegistration(req: IncomingMessage, res: ServerResponse) {
  const startedAt = Date.now();
  const requestId = Array.isArray(req.headers['x-request-id']) ? req.headers['x-request-id'][0] : req.headers['x-request-id'] || null;
  const logStage = (stage: string, extra: Record<string, unknown> = {}) => {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      message: 'registration_checkout_stage',
      requestId,
      stage,
      elapsedMs: Date.now() - startedAt,
      ...extra,
    }));
  };

  logStage('request_started');

  if (!requireJson(req, res)) {
    return;
  }

  const databaseConfigurationIssue = getDatabaseConfigurationIssue();

  if (databaseConfigurationIssue) {
    logRequest(req, 503, 'registration_database_not_configured');
    json(res, 503, {
      message: 'Inscricoes temporariamente indisponiveis. Nossa equipe ja foi acionada para concluir a configuracao do banco de dados.',
    });
    return;
  }

  if (isRateLimited(req)) {
    json(res, 429, { message: 'Muitas tentativas. Aguarde um minuto e tente novamente.' });
    return;
  }

  const rawBody = await readBody(req);
  logStage('body_read', { bodyLength: rawBody.length });
  const parsedBody = parseJsonBody<RegistrationFormData>(rawBody);

  if (!parsedBody) {
    json(res, 400, { message: 'JSON invalido.' });
    return;
  }

  const metaContext = sanitizeMetaRegistrationContext(parsedBody.meta);
  const payload = sanitizeRegistration({ ...parsedBody, meta: metaContext });
  const durableMetaContext = buildDurableMetaContext(req, metaContext);
  const checkoutRequested = parsedBody.checkoutRequested === true;
  const errors = validateRegistration(payload);
  logStage('payload_validated', { valid: Object.keys(errors).length === 0 });

  if (Object.keys(errors).length > 0) {
    json(res, 422, { message: 'Dados de inscricao invalidos.', errors });
    return;
  }

  const hash = cpfHash(payload.cpf);
  const presentedPartnerSession = readPartnerSession(req);
  const partnerSession = parsedBody.partnerBenefitRequested === true ? presentedPartnerSession : null;
  const requestedCouponCode = normalizeCouponCode(parsedBody.couponCode);
  if (parsedBody.couponCode && !calculateCouponPricing(100, requestedCouponCode)) {
    json(res, 422, { message: 'Cupom inválido.' });
    return;
  }
  if (requestedCouponCode && partnerSession) {
    json(res, 409, { message: 'O cupom não pode ser combinado com outro desconto.' });
    return;
  }

  logStage('registration_persist_started', { databaseProvider: usesPostgresDatabase() ? 'postgres' : 'json' });
  let response: PendingCheckout;
  try {
    response = usesPostgresDatabase()
    ? await createPendingRegistrationInPostgres({
      payload,
      metaContext: durableMetaContext,
      cpfHash: hash,
      paymentProvider: paymentProvider || 'not_configured',
      expiresAt: getPendingPaymentExpiresAt(new Date().toISOString()),
      description: getRegistrationDescription,
      partnerId: partnerSession?.partnerId || null,
      partnerSlug: partnerSession?.slug || null,
      partnerType: partnerSession?.partnerType || null,
      correlationId: partnerSession?.correlationId || null,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
      accessAuditId: partnerSession?.accessAuditId || null,
      couponCode: requestedCouponCode || null,
    })
    : await transaction<PendingCheckout>((database) => {
    expirePendingPayments(database);

    const event = database.events.find((item) => item.slug === 'funpace-run-2026' && item.status === 'published');

    if (!event) {
      return {
        statusCode: 409,
        success: false,
        registrationId: '',
        paymentId: null,
        registrationStatus: 'cancelled',
        checkoutStatus: 'not_configured',
        checkoutUrl: null,
        message: 'Evento indisponivel para inscricoes.',
      };
    }

    const existing = database.registrations.find((item) => (
      item.eventId === event.id && item.cpfHash === hash && ['pending_payment', 'paid'].includes(item.status)
    ));

    if (existing?.status === 'pending_payment') {
      const existingPayment = database.payments.find((item) => item.registrationId === existing.id);
      const isStalePending = existing.amountCents !== (existing.finalPriceCents ?? existing.amountCents)
        || !existingPayment
        || existingPayment.amountCents !== (existing.finalPriceCents ?? existing.amountCents);

      if (isStalePending) {
        existing.status = 'expired';
        existing.updatedAt = new Date().toISOString();
        existing.expiresAt ||= existing.updatedAt;

        if (existingPayment) {
          existingPayment.status = 'expired';
          existingPayment.checkoutUrl = null;
          existingPayment.providerPaymentId = null;
          existingPayment.updatedAt = existing.updatedAt;
          existingPayment.expiresAt ||= existing.updatedAt;
        }
        releaseRegistrationCapacity(database, existing);
      }
    }

    const activeExisting = database.registrations.find((item) => (
      item.eventId === event.id && item.cpfHash === hash && ['pending_payment', 'paid'].includes(item.status)
    ));

    if (activeExisting) {
      const payment = database.payments.find((item) => item.registrationId === activeExisting.id);
      const existingDistance = database.distances.find((item) => item.id === activeExisting.distanceId);
      const existingLot = database.lots.find((item) => item.id === activeExisting.lotId);
      const requestedCouponDiffers = activeExisting.status === 'pending_payment'
        && (activeExisting.couponCode || '') !== requestedCouponCode;
      if (requestedCouponDiffers) {
        if (activeExisting.partnerId && requestedCouponCode) {
          return {
            statusCode: 409, success: false, registrationId: activeExisting.id, paymentId: payment?.id || null,
            registrationStatus: activeExisting.status, checkoutStatus: payment?.checkoutUrl ? 'created' : 'not_configured',
            checkoutUrl: payment?.checkoutUrl || null,
            message: 'O cupom não pode ser combinado com outro desconto.',
          };
        }
        const repricedCoupon = calculateCouponPricing(existingLot?.priceCents || activeExisting.originalPriceCents || activeExisting.amountCents, requestedCouponCode);
        const repricedAmountCents = repricedCoupon?.finalPriceCents ?? existingLot?.priceCents ?? activeExisting.originalPriceCents ?? activeExisting.amountCents;
        const repricedAt = new Date().toISOString();
        database.auditLogs.push(createAuditLog(req, null, {
          action: repricedCoupon ? 'coupon.applied' : 'coupon.removed', entityType: 'registration', entityId: activeExisting.id,
          payload: { previousCouponCode: activeExisting.couponCode || null, previousAmountCents: activeExisting.amountCents, ...(repricedCoupon || { finalPriceCents: repricedAmountCents }), ...(repricedCoupon ? buildCouponCampaignAuditPayload(repricedCoupon.code) : {}) },
          createdAt: repricedAt,
        }));
        activeExisting.amountCents = repricedAmountCents;
        activeExisting.discountPercentage = repricedCoupon?.discountPercentage || 0;
        activeExisting.discountAmountCents = repricedCoupon?.discountAmountCents || 0;
        activeExisting.originalPriceCents = repricedCoupon?.originalPriceCents ?? repricedAmountCents;
        activeExisting.finalPriceCents = repricedAmountCents;
        activeExisting.couponCode = repricedCoupon?.code || null;
        activeExisting.couponAppliedAt = repricedCoupon ? repricedAt : null;
        activeExisting.couponUsedAt = null;
        activeExisting.updatedAt = repricedAt;
        if (payment) {
          payment.amountCents = repricedAmountCents;
          payment.providerPaymentId = null;
          payment.checkoutUrl = null;
          payment.gatewayStatus = null;
          payment.gatewayTransactionId = null;
          payment.gatewayPayload = null;
          payment.updatedAt = repricedAt;
        }
      }
      const shouldCreateCheckout = activeExisting.status === 'pending_payment' && !payment?.checkoutUrl;
      const response: CreateRegistrationResponse = {
        success: activeExisting.status !== 'paid',
        registrationId: activeExisting.id,
        paymentId: payment?.id || null,
        registrationStatus: activeExisting.status,
        checkoutStatus: payment?.checkoutUrl ? 'created' : 'not_configured',
        checkoutUrl: payment?.checkoutUrl || null,
        expiresAt: activeExisting.expiresAt || null,
        message: activeExisting.status === 'paid'
          ? 'Ja existe uma inscricao paga para este CPF.'
          : shouldCreateCheckout
            ? 'Inscricao recuperada. Preparando um novo acesso ao checkout.'
            : 'Ja existe uma inscricao aguardando pagamento para este CPF.',
        partner: activeExisting.partnerId ? {
          name: activeExisting.partnerName || '',
          partnerType: activeExisting.partnerType || 'sports_advisory',
          discountPercentage: activeExisting.discountPercentage || 0,
          discountAmountCents: activeExisting.discountAmountCents || 0,
          originalPriceCents: activeExisting.originalPriceCents ?? activeExisting.amountCents,
          finalPriceCents: activeExisting.finalPriceCents ?? activeExisting.amountCents,
        } : null,
        coupon: activeExisting.couponCode ? {
          code: activeExisting.couponCode,
          discountPercentage: activeExisting.discountPercentage || 0,
          discountAmountCents: activeExisting.discountAmountCents || 0,
          originalPriceCents: activeExisting.originalPriceCents ?? activeExisting.amountCents,
          finalPriceCents: activeExisting.finalPriceCents ?? activeExisting.amountCents,
          appliedAt: activeExisting.couponAppliedAt || null,
          usedAt: activeExisting.couponUsedAt || null,
        } : null,
      };

      return {
        ...response,
        statusCode: activeExisting.status === 'paid' ? 409 : 200,
        amountCents: shouldCreateCheckout ? activeExisting.amountCents : undefined,
        description: shouldCreateCheckout
          ? getRegistrationDescription(existingDistance?.name || activeExisting.payload.distance, existingLot?.name || activeExisting.lotId)
          : undefined,
        shouldCreateCheckout,
      };
    }

    const distance = database.distances.find((item) => item.eventId === event.id && item.name === payload.distance && item.status === 'active');
    const activeLot = selectLotWithAvailability(database.lots, database.registrations, event.id);

    if (!distance || !activeLot) {
      return {
        statusCode: 409,
        success: false,
        registrationId: '',
        paymentId: null,
        registrationStatus: 'cancelled',
        checkoutStatus: 'not_configured',
        checkoutUrl: null,
        message: 'Distancia ou lote indisponivel.',
      };
    }

    const distanceSold = database.registrations.filter((item) => (
      item.distanceId === distance.id && ['pending_payment', 'paid'].includes(item.status)
    )).length;

    if (distanceSold >= distance.capacity) {
      return {
        statusCode: 409,
        success: false,
        registrationId: '',
        paymentId: null,
        registrationStatus: 'cancelled',
        checkoutStatus: 'not_configured',
        checkoutUrl: null,
        message: 'Vagas esgotadas para esta distancia.',
      };
    }

    const now = new Date().toISOString();
    const expiresAt = getPendingPaymentExpiresAt(now);
    const partner = partnerSession
      ? database.partners.find((item) => item.id === partnerSession.partnerId
        && item.slug === partnerSession.slug
        && (!partnerSession.partnerType || item.partnerType === partnerSession.partnerType))
      : null;
    const partnerPricing = calculatePartnerPricing(activeLot.priceCents, partner);
    const couponPricing = partnerPricing ? null : calculateCouponPricing(activeLot.priceCents, requestedCouponCode);
    const registration: RegistrationRecord = {
      id: randomUUID(),
      eventId: event.id,
      distanceId: distance.id,
      lotId: activeLot.id,
      cpfHash: hash,
      status: 'pending_payment',
      amountCents: couponPricing?.finalPriceCents ?? partnerPricing?.finalPriceCents ?? activeLot.priceCents,
      payload,
      metaContext: durableMetaContext,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      paidAt: null,
      confirmedAt: null,
      confirmationEmailSentAt: null,
      confirmationEmailLastAttemptAt: null,
      confirmationEmailProvider: null,
      confirmationEmailId: null,
      confirmationEmailError: null,
      partnerId: partnerPricing?.partnerId || null,
      partnerName: partnerPricing?.partnerName || null,
      partnerType: partnerPricing ? partner?.partnerType || 'sports_advisory' : null,
      partnerLink: partnerPricing ? `/p/${partnerSession?.slug || ''}` : null,
      partnerIdentifiedAt: partnerPricing ? now : null,
      discountPercentage: couponPricing?.discountPercentage || partnerPricing?.discountPercentage || 0,
      discountAmountCents: couponPricing?.discountAmountCents || partnerPricing?.discountAmountCents || 0,
      originalPriceCents: activeLot.priceCents,
      finalPriceCents: couponPricing?.finalPriceCents ?? partnerPricing?.finalPriceCents ?? activeLot.priceCents,
      couponCode: couponPricing?.code || null,
      couponAppliedAt: couponPricing ? now : null,
      couponUsedAt: null,
    };
    const payment: PaymentRecord = {
      id: randomUUID(),
      registrationId: registration.id,
      provider: paymentProvider || 'not_configured',
      status: 'pending_payment',
      amountCents: registration.amountCents,
      providerPaymentId: null,
      checkoutUrl: null,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      paidAt: null,
      gatewayStatus: null,
      gatewayTransactionId: null,
      gatewayPayload: null,
    };

    database.registrations.push(registration);
    database.payments.push(payment);
    claimRegistrationCapacity(database, registration);
    database.auditLogs.push(createAuditLog(req, null, {
      action: 'lot.reservation.created', entityType: 'registration', entityId: registration.id,
      payload: { lotId: activeLot.id, lotName: activeLot.name, expiresAt }, createdAt: now,
    }));
    if (couponPricing) {
      database.auditLogs.push(createAuditLog(req, null, {
        action: 'coupon.applied', entityType: 'registration', entityId: registration.id,
        payload: { ...couponPricing, ...buildCouponCampaignAuditPayload(couponPricing.code) }, createdAt: now,
      }));
    }

    return {
      statusCode: 201,
      success: true,
      registrationId: registration.id,
      paymentId: payment.id,
      registrationStatus: registration.status,
      checkoutStatus: 'not_configured',
      checkoutUrl: null,
      expiresAt,
      message: paymentProvider === 'infinitepay'
        ? 'Inscricao criada. Redirecionando para o checkout InfinitePay.'
        : 'Inscricao pre-criada. Configure um adaptador de pagamento real para gerar checkout.',
      amountCents: registration.amountCents,
      description: getRegistrationDescription(distance.name, activeLot.name),
      shouldCreateCheckout: true,
      partner: partnerPricing ? {
        name: partnerPricing.partnerName,
        partnerType: partner?.partnerType || 'sports_advisory',
        discountPercentage: partnerPricing.discountPercentage,
        discountAmountCents: partnerPricing.discountAmountCents,
        originalPriceCents: partnerPricing.originalPriceCents,
        finalPriceCents: partnerPricing.finalPriceCents,
      } : null,
      coupon: couponPricing ? { ...couponPricing, appliedAt: now, usedAt: null } : null,
    };
  }, { scope: 'checkout' });
  } catch (error) {
    if (partnerSession?.partnerId) {
      await appendPartnerAuditLogInPostgres({ partnerId: partnerSession.partnerId, action: 'partner.persistence_failed', metadata: { slug: partnerSession.slug, correlationId: partnerSession.correlationId || null, partnerType: partnerSession.partnerType || null, partner_type: partnerSession.partnerType || null, error: error instanceof Error ? error.message.slice(0, 500) : String(error) }, ipAddress: getClientIp(req), userAgent: getUserAgent(req) }).catch(() => undefined);
      await recordOperationalAlert({ dedupeKey: `partner-persistence:${partnerSession.partnerId}:${new Date().toISOString().slice(0,13)}`, severity: 'critical', alertType: 'partner_persistence_failure', title: 'Falha na persistencia do parceiro', message: 'A inscricao nao conseguiu persistir os dados da assessoria.', entityType: 'partner', entityId: partnerSession.partnerId, payload: { slug: partnerSession.slug } });
    }
    throw error;
  }
  logStage('registration_persist_finished', {
    statusCode: response.statusCode,
    registrationId: response.registrationId || null,
    registrationStatus: response.registrationStatus,
    checkoutStatus: response.checkoutStatus,
  });
  const registrationWasCreated = response.statusCode === 201;
  const registrationCommittedForConsent = Boolean(response.registrationId && response.success);
  const metaFlow = resolveMetaRegistrationFlow({
    registrationId: response.registrationId,
    statusCode: response.statusCode,
    success: response.success,
    marketingConsent: metaContext?.marketingConsent,
  });
  if (response.registrationId && response.success) {
    await recordRemarketingCheckoutReturn(req, response.registrationId, payload.attribution).catch((error) => {
      console.error(JSON.stringify({
        at: new Date().toISOString(),
        message: 'remarketing_checkout_return_audit_failed',
        registrationId: response.registrationId,
        error: error instanceof Error ? error.message.slice(0, 300) : 'Unknown error',
      }));
    });
  }
  response.completeRegistrationEventId = metaFlow.completeRegistrationEventId;
  response.checkoutEnabled = Boolean(
    paymentCreationAllowed
    && paymentProvider === 'infinitepay'
    && infinitePayHandle,
  );
  response.checkoutSimulated = false;
  response.paymentProviderCalled = false;
  response.attemptId = null;

  const metaQueue = await enqueueMetaRegistrationFlow(metaFlow, {
    queueCompleteRegistration: (eventId) => queueMetaCompleteRegistrationEvent(
      req,
      response.registrationId,
      eventId,
      metaContext,
    ),
  });
  let metaEventsQueued = metaQueue.completeRegistrationQueued;
  for (const failure of metaQueue.failures) {
    console.error(JSON.stringify({
      at: new Date().toISOString(),
      provider: 'meta',
      eventName: failure.eventName,
      registrationId: response.registrationId,
      status: 'queue_failed',
      errorCode: failure.error instanceof Error
        ? failure.error.message.slice(0, 100)
        : 'META_QUEUE_FAILED',
    }));
  }

  if (
    response.shouldCreateCheckout
    && paymentCreationAllowed
    && paymentProvider === 'infinitepay'
    && response.amountCents
    && response.description
  ) {
    if (!infinitePayHandle) {
      logStage('checkout_skipped_missing_handle', { registrationId: response.registrationId });
      await markPaymentCreationFailed(response.registrationId);
      response.statusCode = 503;
      response.success = false;
      response.registrationStatus = 'payment_failed';
      response.checkoutStatus = 'not_configured';
      response.checkoutUrl = null;
      response.message = 'Gateway de pagamento indisponivel. Tente novamente em instantes.';
    } else {
      try {
        logStage('checkout_create_started', {
          registrationId: response.registrationId,
          amountCents: response.amountCents,
        });
        response.paymentProviderCalled = true;
        const checkout = await createInfinitePayCheckout({
          handle: infinitePayHandle,
          orderNsu: response.registrationId,
          amountCents: response.amountCents,
          description: response.description,
          redirectUrl: getRegistrationSuccessUrl(response.registrationId),
          webhookUrl: getWebhookUrl(),
          customer: payload,
        });
        logStage('checkout_create_finished', {
          registrationId: response.registrationId,
          checkoutUrlPresent: Boolean(checkout.checkoutUrl),
          providerPaymentId: checkout.providerPaymentId || null,
        });

        if (usesPostgresDatabase()) {
          logStage('checkout_persist_started', { registrationId: response.registrationId, persistMode: 'postgres' });
          await attachCheckoutToPaymentInPostgres({
            registrationId: response.registrationId,
            providerPaymentId: checkout.providerPaymentId,
            checkoutUrl: checkout.checkoutUrl,
            raw: checkout.raw,
          });
        } else {
          logStage('checkout_persist_started', { registrationId: response.registrationId, persistMode: 'json' });
          await transaction((database) => {
            const payment = database.payments.find((item) => item.registrationId === response.registrationId);

            if (payment) {
              payment.provider = 'infinitepay';
              payment.providerPaymentId = checkout.providerPaymentId;
              payment.checkoutUrl = checkout.checkoutUrl;
              payment.updatedAt = new Date().toISOString();
            }

            database.paymentEvents.push({
              id: randomUUID(),
              paymentId: payment?.id || '',
              providerEventId: checkout.providerPaymentId || response.registrationId,
              eventType: 'infinitepay.checkout_created',
              payload: checkout.raw,
              receivedAt: new Date().toISOString(),
            });
          }, { scope: 'checkout' });
        }
        logStage('checkout_persist_finished', { registrationId: response.registrationId });

        response.checkoutStatus = 'created';
        response.checkoutUrl = checkout.checkoutUrl;
        const checkoutMetaFlow = resolveMetaCheckoutFlow({
          registrationId: response.registrationId,
          checkoutPersisted: true,
          checkoutReferencePresent: Boolean(checkout.checkoutUrl?.trim() || checkout.providerPaymentId?.trim()),
          marketingConsent: metaContext?.marketingConsent,
        });
        response.attemptId = checkoutMetaFlow.initiateCheckoutEventId;
        if (checkoutMetaFlow.shouldQueueInitiateCheckout && checkoutMetaFlow.initiateCheckoutEventId) {
          try {
            const queued = await queueMetaInitiateCheckoutEvent(
              req,
              response.registrationId,
              checkoutMetaFlow.initiateCheckoutEventId,
              Math.floor(startedAt / 1000),
              metaContext,
            );
            metaEventsQueued = queued || metaEventsQueued;
          } catch (error) {
            console.error(JSON.stringify({
              at: new Date().toISOString(),
              provider: 'meta',
              eventName: 'InitiateCheckout',
              registrationId: response.registrationId,
              status: 'queue_failed',
              errorCode: error instanceof Error ? error.message.slice(0, 100) : 'META_QUEUE_FAILED',
            }));
          }
        }
      } catch (error) {
        logStage('checkout_create_failed', {
          registrationId: response.registrationId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        const errorId = logServerError(req, error);
        await markPaymentCreationFailed(response.registrationId);
        response.statusCode = 502;
        response.success = false;
        response.registrationStatus = 'payment_failed';
        response.checkoutStatus = 'not_configured';
        response.checkoutUrl = null;
        response.message = error instanceof InfinitePayError
          ? `Nao foi possivel criar o checkout InfinitePay. Tente novamente em instantes. Codigo: ${errorId}.`
          : `Erro no gateway de pagamento. Tente novamente em instantes. Codigo: ${errorId}.`;
      }
    }
  }

  if (
    checkoutRequested
    && isHomologationEnvironment()
    && !paymentCreationAllowed
  ) {
    response.message = 'Pagamento externo desabilitado em homologacao.';
  }

  const { statusCode, amountCents: _amountCents, description: _description, shouldCreateCheckout: _shouldCreateCheckout, ...payloadResponse } = response;

  const googleSheetSync = registrationWasCreated && response.registrationId
    ? await queueRegistrationGoogleSheetSync(response.registrationId)
    : null;
  const remarketingSheetSync = registrationWasCreated && response.registrationId
    ? await queueRemarketingGoogleSheetSyncForRegistration(response.registrationId)
    : null;
  const lotSheetSync = registrationWasCreated ? await queueLotSummaryGoogleSheetSync() : null;

  // Vercel may suspend a serverless invocation as soon as the response finishes.
  // Complete the isolated Meta outbox attempt first, while keeping any provider
  // failure unable to change the registration or the response below.
  if (metaEventsQueued) await processMetaIntegrationQueue(5).catch(() => undefined);

  logStage('response_ready', {
    statusCode,
    registrationId: response.registrationId || null,
    checkoutStatus: response.checkoutStatus,
  });
  logRequest(req, statusCode, response.registrationId ? 'registration_processed' : 'registration_rejected');
  if (registrationCommittedForConsent && usesPostgresDatabase()) {
    bindRegistrationToMetaConsentSession(req, res, response.registrationId);
  }
  if (presentedPartnerSession) appendResponseCookie(res, buildPartnerCookie('', 0));
  json(res, statusCode, payloadResponse);

  // The durable outbox is created before the response. External I/O starts only
  // after the participant has received the checkout result.
  if (googleSheetSync) {
    await processGoogleSheetSync(googleSheetSync.id);
  }
  if (remarketingSheetSync) await processGoogleSheetSync(remarketingSheetSync.id);
  if (lotSheetSync) await processGoogleSheetSync(lotSheetSync.id);
}

async function handleCreatePartnership(req: IncomingMessage, res: ServerResponse) {
  if (!requireJson(req, res)) {
    return;
  }

  const databaseConfigurationIssue = getDatabaseConfigurationIssue();

  if (databaseConfigurationIssue) {
    logRequest(req, 503, 'partnership_database_not_configured');
    json(res, 503, {
      message: 'Envio temporariamente indisponivel. Nossa equipe ja foi acionada para concluir a configuracao do banco de dados.',
    });
    return;
  }

  if (isPartnershipRateLimited(req)) {
    json(res, 429, { message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    return;
  }

  const rawBody = await readBody(req);
  const parsedBody = parseJsonBody<PartnershipLeadPayload>(rawBody);

  if (!parsedBody) {
    json(res, 400, { message: 'JSON invalido.' });
    return;
  }

  const payload = sanitizePartnershipLead(parsedBody);

  if (payload.website) {
    json(res, 201, {
      id: '',
      message: 'Proposta enviada com sucesso. Nossa equipe entrara em contato em breve.',
    });
    return;
  }

  const errors = validatePartnershipLead(payload);

  if (Object.keys(errors).length > 0) {
    json(res, 422, { message: 'Dados da proposta invalidos.', errors });
    return;
  }

  const lead = await transaction<PartnershipLeadRecord>((database) => {
    const now = new Date().toISOString();
    const nextLead: PartnershipLeadRecord = {
      id: randomUUID(),
      companyName: payload.companyName,
      contactName: payload.contactName,
      contactRole: payload.contactRole,
      corporateEmail: payload.corporateEmail,
      involvementMessage: payload.involvementMessage,
      status: 'new',
      source: 'site',
      createdAt: now,
      updatedAt: now,
    };

    database.partnershipLeads.push(nextLead);
    return nextLead;
  });

  await notifyPartnershipTeam(lead);
  const partnershipSync = await queuePartnershipGoogleSheetSync(lead.id);
  logRequest(req, 201, 'partnership_lead_created');
  json(res, 201, {
    id: lead.id,
    message: 'Proposta enviada com sucesso. Nossa equipe entrara em contato em breve.',
  });
  if (partnershipSync) await processGoogleSheetSync(partnershipSync.id);
}

async function handlePaymentWebhook(req: IncomingMessage, res: ServerResponse) {
  const processingStartedAt = Date.now();
  if (!paymentConfirmationAllowed) {
    json(res, 503, { success: false, message: 'Confirmacoes de pagamento desabilitadas neste ambiente.' });
    return;
  }

  if (!requireJson(req, res)) {
    return;
  }

  const rawBody = await readBody(req);
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const receivedToken = url.searchParams.get('token') || '';

  // InfinitePay does not document a webhook signature. The secret URL blocks
  // unsolicited traffic; financial authenticity is established below through
  // the provider's server-to-server payment_check endpoint.
  if (!webhookSecret) {
    console.error(JSON.stringify({ at: new Date().toISOString(), message: 'payment_webhook_secret_missing' }));
    await recordOperationalAlert({ dedupeKey: 'webhook:secret-missing', severity: 'critical', alertType: 'webhook_failure', title: 'Webhook indisponível', message: 'PAYMENT_WEBHOOK_SECRET não configurado.', entityType: 'system', entityId: 'webhook' });
    json(res, 503, { success: false, message: 'Webhook indisponivel.' });
    return;
  }

  if (!isPaymentWebhookTokenValid(receivedToken, webhookSecret)) {
    await recordOperationalAlert({ dedupeKey: `webhook:unauthorized:${new Date().toISOString().slice(0, 13)}`, severity: 'warning', alertType: 'webhook_failure', title: 'Webhook não autorizado', message: 'Tentativa recebida com token inválido.', entityType: 'system', entityId: 'webhook' });
    json(res, 401, { message: 'Webhook nao autorizado.' });
    return;
  }

  const event = parseJsonBody<unknown>(rawBody);
  const normalizedEvent = normalizePaymentWebhook(event);

  console.log(JSON.stringify({
    at: new Date().toISOString(),
    message: 'payment_webhook_received',
    provider: 'infinitepay',
    path: url.pathname,
    authorizedBy: 'secret_url',
    normalized: normalizedEvent,
  }));

  if (!normalizedEvent) {
    await recordOperationalAlert({ dedupeKey: `webhook:invalid:${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`, severity: 'warning', alertType: 'webhook_failure', title: 'Payload de webhook inválido', message: 'InfinitePay enviou payload que não pôde ser normalizado.', entityType: 'system', entityId: 'webhook' });
    json(res, 422, { message: 'Webhook invalido.' });
    return;
  }

  if (usesPostgresDatabase() && normalizedEvent.nextStatus === 'paid') {
    if (validateInfinitePayApproval(normalizedEvent)) {
      json(res, 400, { success: false, message: 'Identificadores do pagamento incompletos.' });
      return;
    }

    const verificationStartedAt = Date.now();
    const gatewayCheck = await checkInfinitePayPayment({
      handle: infinitePayHandle,
      orderNsu: normalizedEvent.registrationId,
      transactionNsu: normalizedEvent.providerTransactionId,
      slug: normalizedEvent.providerPaymentId,
    });
    const verificationElapsedMs = Date.now() - verificationStartedAt;

    if (!gatewayCheck.paid) {
      console.error(JSON.stringify({
        at: new Date().toISOString(), message: 'payment_webhook_not_verified',
        registrationId: normalizedEvent.registrationId,
        transactionId: normalizedEvent.providerTransactionId,
        verificationElapsedMs,
      }));
      await recordOperationalAlert({ dedupeKey: `infinitepay:not-verified:${normalizedEvent.providerTransactionId}`, severity: 'critical', alertType: 'infinitepay_error', title: 'Pagamento não verificado', message: 'Webhook de aprovação não foi confirmado pelo payment_check.', entityType: 'registration', entityId: normalizedEvent.registrationId });
      json(res, 400, { success: false, message: 'Pagamento nao confirmado pela InfinitePay.' });
      return;
    }

    if (gatewayCheck.amountCents !== null && normalizedEvent.amountCents !== null
      && gatewayCheck.amountCents !== normalizedEvent.amountCents) {
      await recordOperationalAlert({
        dedupeKey: `payment-amount-mismatch:${normalizedEvent.registrationId}:${normalizedEvent.providerTransactionId}`,
        severity: 'critical', alertType: 'payment_amount_mismatch', title: 'Divergencia no valor do pagamento',
        message: 'O valor recebido no webhook diverge do valor confirmado pelo payment_check.',
        entityType: 'registration', entityId: normalizedEvent.registrationId,
        payload: { providerTransactionId: normalizedEvent.providerTransactionId },
      });
      json(res, 400, { success: false, message: 'Valor do webhook diverge da InfinitePay.' });
      return;
    }

    const result = await confirmPaymentInPostgres({
      registrationId: normalizedEvent.registrationId,
      providerEventId: normalizedEvent.providerEventId || normalizedEvent.providerTransactionId || normalizedEvent.providerPaymentId,
      providerPaymentId: normalizedEvent.providerPaymentId,
      providerTransactionId: normalizedEvent.providerTransactionId,
      eventType: normalizedEvent.eventType,
      gatewayStatus: 'verified_paid',
      amountCents: gatewayCheck.amountCents ?? normalizedEvent.amountCents,
      payload: { webhook: event, verification: gatewayCheck.raw },
      auditAction: 'payment.webhook_processed',
      auditMetadata: {
        paymentMethod: normalizedEvent.paymentMethod || null,
        webhookReceivedAt: new Date(processingStartedAt).toISOString(),
        verificationElapsedMs,
      },
    });
    if (result.error === 'not_found') { json(res, 400, { success: false, message: 'Pedido nao encontrado.' }); return; }
    if (result.error === 'amount_mismatch') {
      await recordOperationalAlert({
        dedupeKey: `payment-amount-mismatch:${result.registrationId || normalizedEvent.registrationId}:${normalizedEvent.providerTransactionId}`,
        severity: 'critical', alertType: 'payment_amount_mismatch', title: 'Divergencia no valor do pagamento',
        message: 'O valor verificado nao coincide com o pagamento e o snapshot financeiro persistidos.',
        entityType: 'registration', entityId: result.registrationId || normalizedEvent.registrationId,
        payload: { paymentId: result.paymentId || null, providerTransactionId: normalizedEvent.providerTransactionId },
      });
      json(res, 400, { success: false, message: 'Valor do pagamento divergente.' }); return;
    }
    if (result.error === 'stale_checkout') { json(res, 409, { success: false, message: 'Checkout expirado por mudanca de lote.' }); return; }
    if (result.duplicated) {
      await recordOperationalAlert({
        dedupeKey: `webhook-duplicate:${normalizedEvent.providerEventId || normalizedEvent.providerTransactionId || normalizedEvent.providerPaymentId}`,
        severity: 'info', alertType: 'webhook_duplicate', title: 'Webhook duplicado',
        message: 'Evento repetido recebido e descartado pela proteção idempotente.',
        entityType: 'registration', entityId: result.registrationId,
        payload: { transactionId: normalizedEvent.providerTransactionId, paymentId: result.paymentId },
      });
    }
    const processingElapsedMs = Date.now() - processingStartedAt;
    json(res, 200, { success: true, message: null, duplicated: result.duplicated || undefined });
    console.log(JSON.stringify({
      at: new Date().toISOString(), message: 'payment_webhook_completed',
      registrationId: result.registrationId, transactionId: normalizedEvent.providerTransactionId,
      duplicated: Boolean(result.duplicated), verificationElapsedMs, processingElapsedMs,
    }));

    // The financial transaction is already committed and the provider has its
    // response. Post-processing remains idempotent and can be recovered by cron.
    const googleSheetSyncs = result.registrationId && result.paymentId
      ? await queueConfirmedPaymentGoogleSheetSync(result.registrationId, result.paymentId)
      : [];
    await Promise.allSettled([
      result.registrationId ? processPaymentConfirmationEmail(req, result.registrationId) : Promise.resolve(),
      processQueuedGoogleSheetSyncs(googleSheetSyncs),
      result.registrationId ? queueConfirmedMetaPurchase(result.registrationId) : Promise.resolve(),
    ]);
    return;
  }

  const result = await transaction<{ statusCode: number; payload: unknown; registrationId?: string; paymentId?: string; nextStatus?: RegistrationStatus }>((database) => {
    expirePendingPayments(database);

    const paymentByGatewayId = database.payments.find((item) => (
      Boolean(normalizedEvent.providerPaymentId) && item.providerPaymentId === normalizedEvent.providerPaymentId
    ) || (
      Boolean(normalizedEvent.providerTransactionId)
      && (item.gatewayTransactionId === normalizedEvent.providerTransactionId || item.providerPaymentId === normalizedEvent.providerTransactionId)
    ));
    const registration = database.registrations.find((item) => (
      Boolean(normalizedEvent.registrationId) && item.id === normalizedEvent.registrationId
    ) || (
      paymentByGatewayId && item.id === paymentByGatewayId.registrationId
    ));

    if (!registration) {
      const orphanEventId = normalizedEvent.providerEventId || normalizedEvent.providerTransactionId || normalizedEvent.providerPaymentId || randomUUID();
      if (!database.paymentEvents.some((item) => item.providerEventId === orphanEventId)) {
        database.paymentEvents.push({ id: randomUUID(), paymentId: '', providerEventId: orphanEventId, eventType: 'infinitepay.orphan', payload: event, receivedAt: new Date().toISOString() });
        database.auditLogs.push({ id: randomUUID(), actor: 'system', action: 'payment.orphan_received', entityType: 'payment', entityId: orphanEventId, payload: { registrationId: normalizedEvent.registrationId || null, providerTransactionId: normalizedEvent.providerTransactionId || null }, createdAt: new Date().toISOString() });
      }
      console.error(JSON.stringify({
        at: new Date().toISOString(),
        message: 'payment_webhook_registration_not_found',
        provider: 'infinitepay',
        registrationId: normalizedEvent.registrationId || null,
        providerPaymentId: normalizedEvent.providerPaymentId || null,
        providerTransactionId: normalizedEvent.providerTransactionId || null,
      }));

      return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    }

    const payment = database.payments.find((item) => item.registrationId === registration.id);
    const lot = database.lots.find((item) => item.id === registration.lotId);
    const now = new Date().toISOString();
    const providerEventId = normalizedEvent.providerEventId || normalizedEvent.providerTransactionId || normalizedEvent.providerPaymentId || '';
    // Never downgrade a confirmed payment because of a delayed/stale event.
    const nextStatus = resolvePaymentTransition(registration.status, normalizedEvent.nextStatus);

    if (
      registration.status !== 'paid'
      && (!lot || lot.status !== 'active' || (registration.originalPriceCents ?? registration.amountCents) !== lot.priceCents)
    ) {
      if (payment) {
        payment.gatewayStatus = 'stale_checkout';
        payment.gatewayTransactionId = normalizedEvent.providerTransactionId || payment.gatewayTransactionId || null;
        payment.gatewayPayload = event;
        payment.updatedAt = now;
      }
      database.auditLogs.push({
        id: randomUUID(), actor: 'system', action: 'payment.stale_checkout', entityType: 'registration', entityId: registration.id,
        payload: { lotId: registration.lotId, amountCents: registration.amountCents, receivedAmountCents: normalizedEvent.amountCents }, createdAt: now,
      });
      return { statusCode: 409, payload: { message: 'Checkout expirado por mudanca de lote.' } };
    }

    if (normalizedEvent.amountCents !== null && normalizedEvent.amountCents !== registration.amountCents) {
      if (payment) {
        payment.gatewayStatus = normalizedEvent.gatewayStatus || 'amount_mismatch';
        payment.gatewayTransactionId = normalizedEvent.providerTransactionId || payment.gatewayTransactionId || null;
        payment.gatewayPayload = event;
        payment.updatedAt = now;
      }
      if (!providerEventId || !database.paymentEvents.some((item) => item.providerEventId === providerEventId)) {
        database.paymentEvents.push({
          id: randomUUID(), paymentId: payment?.id || '', providerEventId: providerEventId || randomUUID(),
          eventType: 'infinitepay.amount_mismatch', payload: event, receivedAt: now,
        });
      }
      database.auditLogs.push({
        id: randomUUID(), actor: 'system', action: 'payment.amount_mismatch', entityType: 'registration', entityId: registration.id,
        payload: { expectedAmountCents: registration.amountCents, receivedAmountCents: normalizedEvent.amountCents, providerEventId: providerEventId || null }, createdAt: now,
      });
      return { statusCode: 400, payload: { message: 'Valor do pagamento divergente.' } };
    }

    const isDuplicatedEvent = Boolean(providerEventId && database.paymentEvents.some((item) => item.providerEventId === providerEventId));

    if (isDuplicatedEvent && !(nextStatus === 'paid' && registration.status !== 'paid')) {
      console.log(JSON.stringify({
        at: now,
        message: 'payment_webhook_duplicate',
        provider: 'infinitepay',
        registrationId: registration.id,
        providerEventId,
        status: registration.status,
      }));

      return { statusCode: 200, payload: { ok: true, duplicated: true }, registrationId: registration.id, paymentId: payment?.id, nextStatus };
    }

    const previousStatus = registration.status;
    registration.status = nextStatus;
    registration.updatedAt = now;

    if (nextStatus === 'paid') {
      registration.expiresAt = null;
      registration.paidAt = registration.paidAt || now;
      registration.confirmedAt = registration.confirmedAt || now;
      if (registration.couponCode) registration.couponUsedAt ||= now;
      ensureRegistrationBibNumber(database, registration);

    }

    if (payment) {
      payment.provider = 'infinitepay';
      payment.providerPaymentId = normalizedEvent.providerPaymentId || normalizedEvent.providerTransactionId || payment.providerPaymentId;
      payment.status = nextStatus;
      payment.updatedAt = now;
      payment.paidAt = nextStatus === 'paid' ? payment.paidAt || now : payment.paidAt || null;
      payment.expiresAt = nextStatus === 'paid' ? null : payment.expiresAt;
      payment.gatewayStatus = normalizedEvent.gatewayStatus || nextStatus;
      payment.gatewayTransactionId = normalizedEvent.providerTransactionId || payment.gatewayTransactionId || null;
      payment.gatewayPayload = event;
    }
    synchronizeLotProjections(database);

    if (!isDuplicatedEvent) {
      database.paymentEvents.push({
        id: randomUUID(),
        paymentId: payment?.id || '',
        providerEventId: providerEventId || randomUUID(),
        eventType: normalizedEvent.eventType,
        payload: event,
        receivedAt: now,
      });
    }

    database.auditLogs.push({
      id: randomUUID(),
      actor: 'system',
      action: 'payment.webhook_processed',
      entityType: 'registration',
      entityId: registration.id,
      payload: {
        provider: 'infinitepay',
        providerEventId: providerEventId || null,
        providerPaymentId: normalizedEvent.providerPaymentId || null,
        providerTransactionId: normalizedEvent.providerTransactionId || null,
        previousStatus,
        nextStatus,
      },
      createdAt: now,
    });

    console.log(JSON.stringify({
      at: now,
      message: 'payment_webhook_processed',
      provider: 'infinitepay',
      registrationId: registration.id,
      paymentId: payment?.id || null,
      providerEventId: providerEventId || null,
      providerPaymentId: normalizedEvent.providerPaymentId || null,
      providerTransactionId: normalizedEvent.providerTransactionId || null,
      previousStatus,
      nextStatus,
    }));

    return { statusCode: 200, payload: { ok: true, duplicated: isDuplicatedEvent || undefined }, registrationId: registration.id, paymentId: payment?.id, nextStatus };
  }, { scope: 'checkout' });

  if (result.statusCode === 200 && result.registrationId && result.nextStatus && result.nextStatus !== 'paid') {
    await appendPartnerPaymentStatusAuditInPostgres(result.registrationId, result.nextStatus, { provider: 'infinitepay' });
  }
  const googleSheetSyncs = result.statusCode === 200 && result.nextStatus === 'paid' && result.registrationId && result.paymentId
    ? await queueConfirmedPaymentGoogleSheetSync(result.registrationId, result.paymentId)
    : [];

  if (result.statusCode === 200 && result.nextStatus === 'paid' && result.registrationId) {
    await processPaymentConfirmationEmail(req, result.registrationId);
    json(res, result.statusCode, result.payload);
    await processQueuedGoogleSheetSyncs(googleSheetSyncs);
    return;
  }

  json(res, result.statusCode, result.payload);
}

async function handleGetRegistration(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const id = url.pathname.split('/').at(-1) || '';
  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'registration-status' });
  const registration = database.registrations.find((item) => item.id === id);

  if (!registration) {
    json(res, 404, { message: 'Inscricao nao encontrada.' });
    return;
  }
  const payment = database.payments.find((item) => item.registrationId === registration.id);
  const event = database.events.find((item) => item.id === registration.eventId);
  const registrationIsClosed = ['cancelled', 'refunded'].includes(registration.status);
  const paymentProvesPaid = !registrationIsClosed && (payment?.status === 'paid' || Boolean(payment?.paidAt));
  const effectivePaidAt = registration.paidAt || payment?.paidAt || registration.confirmedAt || null;
  const effectiveRegistrationStatus = paymentProvesPaid ? 'paid' : registration.status;
  const consentSession = adminSessionSecretConfigured ? readMetaConsentSession(req) : null;
  const registrationBoundToBrowser = consentSession?.registrationIds.includes(registration.id) === true;

  res.setHeader('Cache-Control', 'private, no-store');
  json(res, 200, {
    registrationId: registration.id,
    eventId: registration.eventId,
    eventName: event?.name || '',
    status: effectiveRegistrationStatus,
    paymentStatus: payment?.status || registration.status,
    amountCents: registration.amountCents,
    distanceId: registration.distanceId,
    lotId: registration.lotId,
    createdAt: registration.createdAt,
    updatedAt: registration.updatedAt,
    expiresAt: registration.expiresAt || null,
    paidAt: effectivePaidAt,
    confirmedAt: registration.confirmedAt || (paymentProvesPaid ? payment?.paidAt || null : null),
    partner: registration.partnerId ? {
      name: registration.partnerName || '',
      partnerType: registration.partnerType || 'sports_advisory',
      discountPercentage: registration.discountPercentage || 0,
      discountAmountCents: registration.discountAmountCents || 0,
      originalPriceCents: registration.originalPriceCents ?? registration.amountCents,
      finalPriceCents: registration.finalPriceCents ?? registration.amountCents,
    } : null,
    coupon: registration.couponCode ? {
      code: registration.couponCode,
      discountPercentage: registration.discountPercentage || 0,
      discountAmountCents: registration.discountAmountCents || 0,
      originalPriceCents: registration.originalPriceCents ?? registration.amountCents,
      finalPriceCents: registration.finalPriceCents ?? registration.amountCents,
      appliedAt: registration.couponAppliedAt || null,
      usedAt: registration.couponUsedAt || null,
    } : null,
    gatewayStatus: payment?.gatewayStatus || null,
    gatewayTransactionId: payment?.gatewayTransactionId || payment?.providerPaymentId || null,
    confirmationEmailSentAt: registration.confirmationEmailSentAt || null,
    metaPurchaseEligible: canTrackMetaBrowserPurchase(
      effectiveRegistrationStatus,
      payment?.status || registration.status,
      effectivePaidAt,
      registration.marketingConsent === true,
      registration.marketingConsentUpdatedAt || null,
      registrationBoundToBrowser,
      Date.now(),
      metaBrowserPurchaseMaxAgeMs,
    ),
  });
}

async function handleGetAvailability(_req: IncomingMessage, res: ServerResponse) {
  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'availability' });
  const event = database.events.find((item) => item.slug === 'funpace-run-2026');

  if (!event) {
    json(res, 404, { message: 'Evento nao encontrado.' });
    return;
  }

  const lots = database.lots
    .filter((item) => item.eventId === event.id)
    .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0))
    .map((lot) => {
      const capacity = calculateLotCapacity(lot, database.registrations);
      return ({
      id: lot.id,
      name: lot.name,
      priceCents: lot.priceCents,
      capacity: lot.capacity,
      soldCount: capacity.confirmed,
      confirmed: capacity.confirmed,
      temporaryReservations: capacity.temporaryReservations,
      occupied: capacity.occupied,
      remaining: capacity.available,
      available: capacity.available,
      status: capacity.available === 0 ? 'sold_out' : lot.status,
    }); });
  const distances = database.distances
    .filter((item) => item.eventId === event.id)
    .map((distance) => {
      const soldCount = database.registrations.filter((registration) => (
        registration.distanceId === distance.id && ['pending_payment', 'paid'].includes(registration.status)
      )).length;

      return {
        id: distance.id,
        name: distance.name,
        capacity: distance.capacity,
        soldCount,
        remaining: Math.max(distance.capacity - soldCount, 0),
        status: distance.status,
      };
    });

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  json(res, 200, { event, lots, distances });
}

async function handleHealth(req: IncomingMessage, res: ServerResponse) {
  const startedAt = Date.now();
  const checks = {
    appUrl: Boolean(appUrl),
    apiPublicUrl: Boolean(apiPublicUrl),
    allowedOrigins,
    databaseProvider: process.env.DATABASE_PROVIDER || 'auto',
    databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
    paymentProvider: paymentProvider || 'not_configured',
    infinitePayHandleConfigured: Boolean(process.env.INFINITEPAY_HANDLE),
    infinitePayLegacyHandleConfigured: Boolean(process.env.INFINITIPAY_HANDLE),
    infinitePayEffectiveHandleConfigured: Boolean(infinitePayHandle),
    webhookSecretConfigured: Boolean(webhookSecret),
    adminApiKeyConfigured: Boolean(adminApiKey && adminApiKey !== 'change-me'),
    safeguards: getEnvironmentSafeguards(),
  };

  try {
    const database = await pingDatabase();

    const statusCode = database.ok ? 200 : 503;

    json(res, statusCode, {
      ok: database.ok,
      service: 'funpace-run-api',
      elapsedMs: Date.now() - startedAt,
      database,
      checks,
      databaseRuntime: getDatabaseRuntimeConfig(),
    });
    logRequest(req, statusCode, database.ok ? 'health_ok' : 'health_database_not_configured');
  } catch (error) {
    const errorId = logServerError(req, error);
    json(res, 503, {
      ok: false,
      service: 'funpace-run-api',
      elapsedMs: Date.now() - startedAt,
      database: { ok: false },
      checks,
      databaseRuntime: getDatabaseRuntimeConfig(),
      message: 'Banco de dados indisponivel.',
      errorId,
    });
  }
}

async function getAdminRows(url: URL) {
  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'admin-registrations' });
  const lotId = url.searchParams.get('lotId') || '';
  const distanceId = url.searchParams.get('distanceId') || '';
  const status = url.searchParams.get('status') || '';
  const gender = url.searchParams.get('gender') || '';
  const paymentFilter = url.searchParams.get('payment') || '';
  const reportType = url.searchParams.get('reportType') || '';
  const dateFrom = url.searchParams.get('dateFrom') || '';
  const dateTo = url.searchParams.get('dateTo') || '';
  const city = (url.searchParams.get('city') || '').trim().toLowerCase();
  const team = (url.searchParams.get('team') || '').trim().toLowerCase();
  const shirtSize = (url.searchParams.get('shirtSize') || '').trim().toUpperCase();
  const bibNumber = (url.searchParams.get('bibNumber') || '').trim().toLowerCase();
  const sheetStatus = url.searchParams.get('sheetStatus') || '';
  const sortBy = url.searchParams.get('sortBy') || 'createdAt';
  const sortOrder = url.searchParams.get('sortOrder') === 'asc' ? 1 : -1;
  const query = (url.searchParams.get('q') || '').trim().toLowerCase();

  return database.registrations
    .filter((registration) => !lotId || registration.lotId === lotId)
    .filter((registration) => !distanceId || registration.distanceId === distanceId)
    .filter((registration) => !status || registration.status === status)
    .filter((registration) => !gender || registration.payload.gender === gender)
    .filter((registration) => !city || registration.payload.city?.toLowerCase().includes(city))
    .filter((registration) => !team || registration.payload.team?.toLowerCase().includes(team))
    .filter((registration) => !shirtSize || registration.payload.shirtSize === shirtSize)
    .filter((registration) => !bibNumber || registration.bibNumber?.toLowerCase().includes(bibNumber))
    .filter((registration) => {
      if (!query) {
        return true;
      }

      const digitQuery = onlyDigits(query);
      return (
        registration.payload.fullName.toLowerCase().includes(query)
        || registration.payload.email.toLowerCase().includes(query)
        || registration.payload.phone.includes(query)
        || registration.payload.cpf.includes(query)
        || registration.payload.city?.toLowerCase().includes(query)
        || registration.payload.team?.toLowerCase().includes(query)
        || registration.bibNumber?.toLowerCase().includes(query)
        || (digitQuery.length > 0 && onlyDigits(registration.payload.cpf).includes(digitQuery))
      );
    })
    .map((registration) => toAdminRow(database, registration))
    .filter((row) => {
      if (reportType === 'kits' && row.kitStatus !== 'delivered') return false;
      if (reportType === 'checkins' && row.checkInStatus !== 'checked_in') return false;
      if (reportType === 'paid' && row.status !== 'paid') return false;
      if (reportType === 'pending' && row.status !== 'pending_payment') return false;
      if (sheetStatus === 'unsynchronized' && !['pending', 'processing', 'failed', 'not_queued'].includes(row.googleSheetsStatus)) return false;
      if (paymentFilter && row.paymentProvider !== paymentFilter && row.paymentMethod !== paymentFilter && row.paymentStatus !== paymentFilter) return false;
      const referenceDate = reportType === 'kits'
        ? (row.kitDeliveredAt || '')
        : reportType === 'checkins'
          ? (row.checkInAt || '')
          : row.createdAt;
      const day = referenceDate ? referenceDate.slice(0, 10) : '';
      if (dateFrom && (!day || day < dateFrom)) return false;
      if (dateTo && (!day || day > dateTo)) return false;
      return true;
    })
    .sort((a, b) => {
      const allowedSorts: Record<string, keyof typeof a> = { createdAt: 'createdAt', fullName: 'fullName', status: 'status', amountCents: 'amountCents', bibNumber: 'bibNumber' };
      const field = allowedSorts[sortBy] || 'createdAt';
      const left = a[field] ?? ''; const right = b[field] ?? '';
      return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'pt-BR')) * sortOrder;
    });
}

function toAdminRow(database: Database, registration: RegistrationRecord) {
  const distance = database.distances.find((item) => item.id === registration.distanceId);
  const lot = database.lots.find((item) => item.id === registration.lotId);
  const payment = database.payments.find((item) => item.registrationId === registration.id);
  const checkIn = database.checkIns.find((item) => item.registrationId === registration.id);
  const kitDelivery = database.kitDeliveries.find((item) => item.registrationId === registration.id);
  const paymentEvents = payment ? database.paymentEvents.filter((item) => item.paymentId === payment.id) : [];
  const paymentMethod = toStringValue(findFirstValue(payment?.gatewayPayload, ['payment_method', 'paymentMethod', 'method', 'payment_type', 'paymentType']));
  const registrationIsClosed = ['cancelled', 'refunded'].includes(registration.status);
  const paymentProvesPaid = !registrationIsClosed && (payment?.status === 'paid' || Boolean(payment?.paidAt));
  const statusMismatch = paymentProvesPaid && registration.status !== 'paid';
  const hasPaymentDivergence = statusMismatch || paymentEvents.some((item) => item.eventType === 'infinitepay.amount_mismatch');
  const effectiveStatus = paymentProvesPaid ? 'paid' : registration.status;
  const sheetSync = database.googleSheetSyncs.find((item) => item.entityType === 'registration' && item.entityId === registration.id && item.sheetName === 'registrations');

  return {
    id: registration.id,
    fullName: registration.payload.fullName,
    email: registration.payload.email,
    cpfMasked: maskCpf(registration.payload.cpf),
    phone: registration.payload.phone,
    birthDate: registration.payload.birthDate,
    age: getAge(registration.payload.birthDate),
    gender: registration.payload.gender,
    emergencyContactName: registration.payload.emergencyContactName,
    emergencyContactPhone: registration.payload.emergencyContactPhone,
    city: registration.payload.city || null,
    state: registration.payload.state || null,
    team: registration.payload.team || null,
    bibNumber: registration.bibNumber || null,
    checkInStatus: checkIn ? 'checked_in' : 'not_started',
    checkInAt: checkIn?.checkedInAt || null,
    checkInBy: checkIn?.checkedInBy || null,
    kitStatus: kitDelivery ? 'delivered' : 'not_delivered',
    kitDeliveredAt: kitDelivery?.deliveredAt || null,
    kitDeliveredBy: kitDelivery?.deliveredBy || null,
    distance: distance?.name || registration.distanceId,
    distanceId: registration.distanceId,
    lot: lot?.name || registration.lotId,
    lotId: registration.lotId,
    shirtSize: registration.payload.shirtSize,
    status: effectiveStatus,
    paymentStatus: payment?.status || registration.status,
    paymentProvider: payment?.provider || null,
    providerPaymentId: payment?.providerPaymentId || null,
    amountCents: registration.amountCents,
    partnerId: registration.partnerId || null,
    partnerName: registration.partnerName || null,
    partnerType: registration.partnerType || null,
    partnerLink: registration.partnerLink || null,
    partnerIdentifiedAt: registration.partnerIdentifiedAt || null,
    discountPercentage: registration.discountPercentage || 0,
    discountAmountCents: registration.discountAmountCents || 0,
    originalPriceCents: registration.originalPriceCents ?? registration.amountCents,
    finalPriceCents: registration.finalPriceCents ?? registration.amountCents,
    couponCode: registration.couponCode || null,
    couponAppliedAt: registration.couponAppliedAt || null,
    couponUsedAt: registration.couponUsedAt || null,
    createdAt: registration.createdAt,
    updatedAt: registration.updatedAt,
    expiresAt: registration.expiresAt || null,
    paidAt: registration.paidAt || payment?.paidAt || null,
    confirmedAt: registration.confirmedAt || null,
    gatewayStatus: payment?.gatewayStatus || null,
    gatewayTransactionId: payment?.gatewayTransactionId || null,
    paymentMethod: paymentMethod || null,
    hasPaymentDivergence,
    googleSheetsStatus: sheetSync?.status || 'not_queued',
    googleSheetsSynchronizedAt: sheetSync?.synchronizedAt || null,
    confirmationEmailSentAt: registration.confirmationEmailSentAt || null,
    confirmationEmailProvider: registration.confirmationEmailProvider || null,
    confirmationEmailId: registration.confirmationEmailId || null,
    confirmationEmailError: registration.confirmationEmailError || null,
  };
}

async function handleAdminPaymentDetails(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  if (!await requireAdmin(req, res, ['administrator', 'finance']) || !requireAdminDatabase(res)) return;
  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'admin-registrations' });
  const registration = database.registrations.find((item) => item.id === registrationId);
  const payment = database.payments.find((item) => item.registrationId === registrationId);
  if (!registration || !payment) { json(res, 404, { message: 'Pagamento nao encontrado.' }); return; }
  json(res, 200, {
    payment: toAdminRow(database, registration),
    gatewayPayload: payment.gatewayPayload || null,
    events: database.paymentEvents.filter((item) => item.paymentId === payment.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
  });
}

async function getAdminPaymentRows(url: URL) {
  const database = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
  const query = (url.searchParams.get('q') || '').trim().toLowerCase();
  const status = url.searchParams.get('status') || '';
  const method = (url.searchParams.get('method') || '').trim().toLowerCase();
  const dateFrom = url.searchParams.get('dateFrom') || '';
  const dateTo = url.searchParams.get('dateTo') || '';
  const rows = database.registrations.map((item) => toAdminRow(database, item)).filter((row) => {
    if (status === 'divergent' && !row.hasPaymentDivergence) return false;
    if (status === 'manual' && row.gatewayStatus !== 'manual_reconciled_paid') return false;
    if (status === 'email' && !(row.status === 'paid' && !row.confirmationEmailSentAt)) return false;
    if (status && !['divergent', 'manual', 'email'].includes(status) && row.status !== status) return false;
    if (method && !String(row.paymentMethod || '').toLowerCase().includes(method)) return false;
    const date = (row.paidAt || row.createdAt).slice(0, 10);
    if (dateFrom && date < dateFrom) return false;
    if (dateTo && date > dateTo) return false;
    if (query && ![row.fullName, row.email, row.id, row.gatewayTransactionId || '', row.providerPaymentId || '', row.bibNumber || ''].some((value) => value.toLowerCase().includes(query))) return false;
    return true;
  }).sort((a, b) => (b.paidAt || b.createdAt).localeCompare(a.paidAt || a.createdAt));
  const orphans = database.paymentEvents.filter((item) => item.eventType === 'infinitepay.orphan').sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return { rows, orphans };
}

async function handleAdminPayments(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res, ['administrator', 'finance']) || !requireAdminDatabase(res)) return;
  const { rows, orphans } = await getAdminPaymentRows(url);
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') || 25), 1), 100);
  const totalPages = Math.max(Math.ceil(rows.length / pageSize), 1);
  const page = Math.min(Math.max(Number(url.searchParams.get('page') || 1), 1), totalPages);
  json(res, 200, { payments: rows.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total: rows.length, totalPages }, orphanEvents: orphans });
}

async function handleAdminPaymentsCsv(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res, ['administrator', 'finance']) || !requireAdminDatabase(res)) return;
  const { rows } = await getAdminPaymentRows(url);
  const headers = ['inscricao', 'atleta', 'email', 'status_sistema', 'status_gateway', 'metodo', 'transacao', 'cupom', 'valor_original', 'percentual_desconto', 'valor_desconto', 'valor_final', 'cupom_aplicado_em', 'cupom_utilizado_em', 'pago_em', 'email_confirmacao', 'divergente'];
  const lines = rows.map((row) => [row.id, row.fullName, row.email, row.status, row.gatewayStatus, row.paymentMethod, row.gatewayTransactionId || row.providerPaymentId, row.couponCode, ((row.originalPriceCents ?? row.amountCents) / 100).toFixed(2), row.discountPercentage || 0, ((row.discountAmountCents || 0) / 100).toFixed(2), (row.amountCents / 100).toFixed(2), row.couponAppliedAt, row.couponUsedAt, row.paidAt, row.confirmationEmailSentAt, row.hasPaymentDivergence ? 'sim' : 'nao'].map(escapeCsv).join(','));
  csv(res, 'funpace-run-pagamentos.csv', [headers.join(','), ...lines].join('\n'));
}

async function handleAdminOrphanLink(req: IncomingMessage, res: ServerResponse, eventId: string) {
  const adminSession = await requireAdmin(req, res, ['administrator', 'finance']);
  if (!adminSession || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const body = parseJsonBody<{ registrationId?: string; reason?: string }>(await readBody(req));
  const registrationId = body?.registrationId?.trim() || ''; const reason = body?.reason?.trim() || '';
  if (!registrationId || reason.length < 5) { json(res, 400, { message: 'Informe a inscricao e um motivo com pelo menos 5 caracteres.' }); return; }
  const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {
    const event = database.paymentEvents.find((item) => item.id === eventId && item.eventType === 'infinitepay.orphan');
    const registration = database.registrations.find((item) => item.id === registrationId);
    const payment = database.payments.find((item) => item.registrationId === registrationId);
    if (!event) return { statusCode: 404, payload: { message: 'Evento orfao nao encontrado.' } };
    if (!registration || !payment) return { statusCode: 404, payload: { message: 'Inscricao ou pagamento nao encontrado.' } };
    const normalized = normalizePaymentWebhook(event.payload);
    if (normalized && normalized.amountCents !== null && normalized.amountCents !== registration.amountCents) return { statusCode: 409, payload: { message: 'O valor do evento diverge da inscricao informada.' } };
    const now = new Date().toISOString(); event.paymentId = payment.id; event.eventType = 'infinitepay.orphan_linked';
    payment.gatewayPayload = event.payload; payment.gatewayStatus = normalized?.gatewayStatus || payment.gatewayStatus; payment.gatewayTransactionId = normalized?.providerTransactionId || payment.gatewayTransactionId; payment.updatedAt = now;
    database.auditLogs.push(createAuditLog(req, adminSession, { action: 'payment.orphan_linked', entityType: 'registration', entityId: registrationId, payload: { reason, eventId, providerEventId: event.providerEventId }, createdAt: now }));
    return { statusCode: 200, payload: { ok: true } };
  }, { scope: 'checkout' });
  json(res, result.statusCode, result.payload);
}

async function handleAdminPaymentReconcile(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  const adminSession = await requireAdmin(req, res, ['administrator', 'finance']);
  if (!adminSession || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const rawBody = await readBody(req);
  const body = parseJsonBody<{ reason?: string }>(rawBody);
  const reason = body?.reason?.trim() || '';
  if (reason.length < 5) { json(res, 400, { message: 'Informe um motivo com pelo menos 5 caracteres.' }); return; }
  const snapshot = await transaction((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);
    const payment = database.payments.find((item) => item.registrationId === registrationId);
    return registration && payment ? { registration, payment } : null;
  }, { persist: false, scope: 'checkout' });
  if (!snapshot) { json(res, 404, { message: 'Pagamento nao encontrado.' }); return; }
  if (!snapshot.payment.gatewayTransactionId || !snapshot.payment.providerPaymentId) {
    json(res, 409, { message: 'Pagamento sem transaction_nsu ou invoice_slug. Vincule o evento do gateway antes de reconciliar.' }); return;
  }

  let gatewayCheck;
  try {
    gatewayCheck = await checkInfinitePayPayment({
      handle: infinitePayHandle,
      orderNsu: registrationId,
      transactionNsu: snapshot.payment.gatewayTransactionId,
      slug: snapshot.payment.providerPaymentId,
    });
  } catch (error) {
    const status = error instanceof InfinitePayError ? error.statusCode || 502 : 502;
    json(res, status, { message: error instanceof Error ? error.message : 'Falha ao consultar a InfinitePay.' }); return;
  }
  if (!gatewayCheck.paid) { json(res, 409, { message: 'A InfinitePay ainda nao confirmou este pagamento.' }); return; }
  if (gatewayCheck.amountCents !== null && gatewayCheck.amountCents !== snapshot.registration.amountCents) {
    json(res, 409, { message: 'O valor confirmado pela InfinitePay diverge da inscricao.' }); return;
  }

  const confirmed = await confirmPaymentInPostgres({
    registrationId,
    providerEventId: snapshot.payment.gatewayTransactionId,
    providerPaymentId: snapshot.payment.providerPaymentId,
    providerTransactionId: snapshot.payment.gatewayTransactionId,
    eventType: 'infinitepay.admin_verified',
    gatewayStatus: 'verified_paid',
    amountCents: gatewayCheck.amountCents,
    payload: gatewayCheck.raw,
    auditAction: 'payment.gateway_reconciled',
    actor: adminSession.actor,
  });
  if (confirmed.error) {
    json(res, confirmed.statusCode, {
      message: confirmed.error === 'not_found'
        ? 'Pagamento nao encontrado.'
        : confirmed.error === 'stale_checkout'
          ? 'Checkout expirado por mudanca de lote.'
          : 'Valor divergente.',
    });
    return;
  }
  const refreshed = await transaction((database) => database, { persist: false, scope: 'admin-registrations' });
  const refreshedRegistration = refreshed.registrations.find((item) => item.id === registrationId)!;
  const googleSheetSyncs = confirmed.paymentId
    ? await queueConfirmedPaymentGoogleSheetSync(registrationId, confirmed.paymentId)
    : [];
  await processPaymentConfirmationEmail(req, registrationId);
  json(res, 200, { registration: toAdminRow(refreshed, refreshedRegistration) });
  await Promise.allSettled([
    processQueuedGoogleSheetSyncs(googleSheetSyncs),
    queueConfirmedMetaPurchase(registrationId),
  ]);
}

async function handlePaymentConfirmation(req: IncomingMessage, res: ServerResponse) {
  if (!paymentConfirmationAllowed) {
    json(res, 503, { message: 'Confirmacoes de pagamento desabilitadas neste ambiente.' });
    return;
  }

  if (!requireJson(req, res)) return;
  const body = parseJsonBody<{ orderNsu?: string; transactionNsu?: string; slug?: string }>(await readBody(req));
  const orderNsu = compactText(body?.orderNsu, 100);
  const transactionNsu = compactText(body?.transactionNsu, 160);
  const slug = compactText(body?.slug, 160);
  if (!orderNsu || !transactionNsu || !slug) { json(res, 400, { message: 'Dados do retorno da InfinitePay incompletos.' }); return; }

  const check = await checkInfinitePayPayment({ handle: infinitePayHandle, orderNsu, transactionNsu, slug });
  if (!check.paid) { json(res, 202, { status: 'pending_payment' }); return; }

  if (usesPostgresDatabase()) {
    const confirmed = await confirmPaymentInPostgres({
      registrationId: orderNsu,
      providerEventId: transactionNsu,
      providerPaymentId: slug,
      providerTransactionId: transactionNsu,
      eventType: 'infinitepay.redirect_verified',
      gatewayStatus: 'verified_paid',
      amountCents: check.amountCents,
      payload: check.raw,
      auditAction: 'payment.redirect_reconciled',
    });
    if (confirmed.error === 'not_found') { json(res, 404, { message: 'Inscricao nao encontrada.' }); return; }
    if (confirmed.error === 'amount_mismatch') {
      await recordOperationalAlert({ dedupeKey: `payment-amount-mismatch:${orderNsu}:${transactionNsu}`, severity: 'critical', alertType: 'payment_amount_mismatch', title: 'Divergencia no valor do pagamento', message: 'A confirmacao de retorno diverge do snapshot financeiro persistido.', entityType: 'registration', entityId: orderNsu, payload: { paymentId: confirmed.paymentId || null, providerTransactionId: transactionNsu } });
      json(res, 409, { message: 'Valor do pagamento divergente.' }); return;
    }
    if (confirmed.error === 'stale_checkout') { json(res, 409, { message: 'Checkout expirado por mudanca de lote.' }); return; }
    const googleSheetSyncs = confirmed.registrationId && confirmed.paymentId
      ? await queueConfirmedPaymentGoogleSheetSync(confirmed.registrationId, confirmed.paymentId)
      : [];
    if (confirmed.registrationId) {
      await processPaymentConfirmationEmail(req, confirmed.registrationId);
    }
    json(res, 200, { status: 'paid' });
    await Promise.allSettled([
      processQueuedGoogleSheetSyncs(googleSheetSyncs),
      queueConfirmedMetaPurchase(confirmed.registrationId || orderNsu),
    ]);
    return;
  }

  const result = await transaction<{ statusCode: number; status?: RegistrationStatus; registrationId?: string; paymentId?: string; payload: unknown }>((database) => {
    const registration = database.registrations.find((item) => item.id === orderNsu);
    const payment = database.payments.find((item) => item.registrationId === orderNsu);
    if (!registration || !payment) return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    if (check.amountCents !== null && check.amountCents !== registration.amountCents) return { statusCode: 409, payload: { message: 'Valor do pagamento divergente.' } };
    const now = new Date().toISOString();
    const previousStatus = registration.status;
    registration.status = 'paid'; registration.paidAt ||= now; registration.confirmedAt ||= now; if (registration.couponCode) registration.couponUsedAt ||= now; registration.expiresAt = null; ensureRegistrationBibNumber(database, registration); registration.updatedAt = now;
    payment.status = 'paid'; payment.provider = 'infinitepay'; payment.providerPaymentId = slug; payment.gatewayTransactionId = transactionNsu; payment.gatewayStatus = 'verified_paid'; payment.gatewayPayload = check.raw; payment.paidAt ||= now; payment.expiresAt = null; payment.updatedAt = now;
    claimRegistrationCapacity(database, registration);
    database.auditLogs.push({ id: randomUUID(), actor: 'system', action: 'payment.redirect_reconciled', entityType: 'registration', entityId: orderNsu, payload: { previousStatus, transactionNsu, invoiceSlug: slug }, createdAt: now });
    return { statusCode: 200, status: 'paid', registrationId: orderNsu, paymentId: payment.id, payload: { status: 'paid' } };
  }, { scope: 'checkout' });
  const googleSheetSyncs = result.statusCode === 200 && result.registrationId && result.paymentId
    ? await queueConfirmedPaymentGoogleSheetSync(result.registrationId, result.paymentId)
    : [];
  if (result.statusCode === 200 && result.registrationId) {
    await processPaymentConfirmationEmail(req, result.registrationId);
    json(res, result.statusCode, result.payload);
    await processQueuedGoogleSheetSyncs(googleSheetSyncs);
    return;
  }

  json(res, result.statusCode, result.payload);
}

function isAuthorizedCron(req: IncomingMessage) {
  const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  return isCronAuthorizationValid(cronSecret, authorization);
}

async function handleMetaRecovery(req: IncomingMessage, res: ServerResponse) {
  if (!isAuthorizedCron(req)) {
    json(res, cronSecret ? 401 : 503, { message: cronSecret ? 'Nao autorizado.' : 'CRON_SECRET nao configurado.' });
    return;
  }
  const startedAt = Date.now();
  const result = await recoverMetaIntegrationEvents();
  json(res, 200, { success: true, ...result, elapsedMs: Date.now() - startedAt });
}

async function persistCurrentReconciliation(triggerSource: string, mode: 'dry_run' | 'apply', createdBy: string) {
  const startedAt = new Date().toISOString();
  const database = await transaction((current) => current, { persist: false, scope: 'checkout' });
  const issues = detectLocalReconciliationIssues(database);
  const report = generateReconciliationReport(issues);
  const completedAt = new Date().toISOString();
  if (usesPostgresDatabase()) {
    await persistReconciliationRunInPostgres({
      id: randomUUID(), triggerSource, mode,
      checkedCount: database.payments.length,
      correctedCount: 0,
      manualReviewCount: report.manualReviewRequired,
      errorCount: 0,
      summary: report,
      startedAt, completedAt, createdBy, issues,
    });
  }
  return { ...report, checkedCount: database.payments.length, startedAt, completedAt };
}

async function handleAdminReconciliation(req: IncomingMessage, res: ServerResponse, execute: boolean) {
  const session = await requireAdmin(req, res, ['administrator', 'finance']);
  if (!session || !requireAdminDatabase(res)) return;
  if (!execute) {
    json(res, 200, await getReconciliationDashboardInPostgres());
    return;
  }
  const body = parseJsonBody<{ mode?: 'dry_run' | 'apply' }>(await readBody(req)) || {};
  const mode = body.mode === 'apply' ? 'apply' : 'dry_run';
  // Only gateway-proven changes are ever applied by the recovery flow. This run
  // classifies ambiguous history and deliberately leaves it untouched.
  const report = await persistCurrentReconciliation('admin', mode, session.actor);
  json(res, 200, { success: true, mode, correctedCount: 0, ...report });
}

async function handlePaymentRecovery(req: IncomingMessage, res: ServerResponse) {
  if (!isAuthorizedCron(req)) {
    json(res, cronSecret ? 401 : 503, { message: cronSecret ? 'Nao autorizado.' : 'CRON_SECRET nao configurado.' });
    return;
  }

  const startedAt = Date.now();
  const expiredReservations = usesPostgresDatabase() ? await expireTemporaryReservationsInPostgres() : 0;
  const database = await transaction((current) => current, { persist: false, scope: 'checkout' });
  const recoverable = database.payments.filter((payment) => {
    const registration = database.registrations.find((item) => item.id === payment.registrationId);
    return registration
      && registration.status !== 'paid'
      && Boolean(payment.gatewayTransactionId)
      && Boolean(payment.providerPaymentId)
      && payment.provider === 'infinitepay';
  }).slice(0, 5);

  const summary = { checked: 0, confirmed: 0, alreadyPending: 0, errors: 0, emailsRecovered: 0, expiredReservations };

  for (const payment of recoverable) {
    const registration = database.registrations.find((item) => item.id === payment.registrationId)!;
    summary.checked += 1;
    try {
      const check = await checkInfinitePayPayment({
        handle: infinitePayHandle,
        orderNsu: registration.id,
        transactionNsu: payment.gatewayTransactionId!,
        slug: payment.providerPaymentId!,
      });
      if (!check.paid) { summary.alreadyPending += 1; continue; }
      const confirmed = await confirmPaymentInPostgres({
        registrationId: registration.id,
        providerEventId: payment.gatewayTransactionId!,
        providerPaymentId: payment.providerPaymentId!,
        providerTransactionId: payment.gatewayTransactionId!,
        eventType: 'infinitepay.automatic_recovery',
        gatewayStatus: 'verified_paid',
        amountCents: check.amountCents,
        payload: { verification: check.raw, recovery: true },
        auditAction: 'payment.automatically_recovered',
        auditMetadata: { recoveryStartedAt: new Date(startedAt).toISOString() },
      });
      if (confirmed.error) { summary.errors += 1; continue; }
      summary.confirmed += confirmed.duplicated ? 0 : 1;
      if (confirmed.paymentId) {
        const tasks = await queueConfirmedPaymentGoogleSheetSync(registration.id, confirmed.paymentId);
        await processQueuedGoogleSheetSyncs(tasks);
      }
      if (confirmed.registrationId) await queueConfirmedMetaPurchase(confirmed.registrationId);
    } catch (error) {
      summary.errors += 1;
      console.error(JSON.stringify({
        at: new Date().toISOString(), message: 'payment_automatic_recovery_failed',
        registrationId: registration.id, transactionId: payment.gatewayTransactionId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }));
    }
  }

  const refreshed = await transaction((current) => current, { persist: false, scope: 'checkout' });
  const missingEmails = refreshed.registrations
    .filter((registration) => registration.status === 'paid' && !registration.confirmationEmailSentAt)
    .slice(0, 10);
  for (const registration of missingEmails) {
    try {
      const result = await processPaymentConfirmationEmail(req, registration.id);
      if (result?.ok) summary.emailsRecovered += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(JSON.stringify({
        at: new Date().toISOString(), message: 'email_automatic_recovery_failed', registrationId: registration.id,
        error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined,
      }));
    }
  }

  console.log(JSON.stringify({ at: new Date().toISOString(), message: 'payment_recovery_completed', ...summary, elapsedMs: Date.now() - startedAt }));
  const reconciliation = await persistCurrentReconciliation('cron', 'apply', 'system:cron');
  const partnerConsistency = await runPartnerConsistencyCheckInPostgres('system:cron');
  const metaRecovery = await recoverMetaIntegrationEvents().catch((error) => ({
    error: error instanceof Error ? error.message.slice(0, 100) : 'META_RECOVERY_FAILED',
  }));
  json(res, 200, { success: true, ...summary, reconciliation, partnerConsistency, meta: metaRecovery, elapsedMs: Date.now() - startedAt });
}

async function handleGoogleSheetsRecovery(req: IncomingMessage, res: ServerResponse) {
  if (!isAuthorizedCron(req)) {
    json(res, cronSecret ? 401 : 503, { message: cronSecret ? 'Nao autorizado.' : 'CRON_SECRET nao configurado.' });
    return;
  }

  const startedAt = Date.now();
  const confirmedPayments = await reconcileConfirmedPaymentsGoogleSheetSync();
  const remarketing = await reconcileRemarketingGoogleSheetSyncs(25);
  if (remarketing.enabled && !remarketing.rolloutEnabled) {
    console.warn(JSON.stringify({
      at: new Date().toISOString(),
      message: 'google_sheets_remarketing_disabled',
      enabled: remarketing.enabled,
      remarketingEnabled: remarketing.rolloutEnabled,
      configurationIssue: remarketing.configurationIssue,
    }));
  } else if (remarketing.rolloutEnabled) {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      message: 'google_sheets_remarketing_reconciliation',
      candidates: remarketing.candidates,
      pendingReconciliation: remarketing.pendingReconciliation,
      queued: remarketing.queued,
      unchanged: remarketing.unchanged,
    }));
  }
  const result = await processGoogleSheetSyncBacklog(10);
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    message: 'google_sheets_backlog_processed',
    ...result,
    remarketing,
    confirmedPayments,
    elapsedMs: Date.now() - startedAt,
  }));
  json(res, result.configurationIssue ? 503 : 200, {
    success: !result.configurationIssue,
    ...result,
    remarketing,
    confirmedPayments,
    elapsedMs: Date.now() - startedAt,
  });
}

const EVENT_SCOPE_ERROR_MESSAGE: Record<EventScopeErrorCode, string> = {
  EVENT_NOT_FOUND: 'Evento nao encontrado.',
  NO_PUBLISHED_EVENT: 'Nenhum evento publicado para exibir no dashboard.',
  EVENT_SCOPE_AMBIGUOUS: 'Ha mais de um evento publicado. Informe eventId para escolher.',
};

// ADMIN-002 Stage 4B: resolve which event a dashboard request is scoped to.
// Returns the scoped database + public event context, or writes a 400 and
// returns null (never a silent fallback, never a 500, never a leak).
function resolveDashboardEventScope(res: ServerResponse, database: Database, url: URL) {
  const resolution = resolveEventScope(database.events, {
    eventId: url.searchParams.get('eventId'),
    eventSlug: url.searchParams.get('eventSlug') || url.searchParams.get('event'),
  });
  if ('code' in resolution) {
    json(res, 400, { code: resolution.code, message: EVENT_SCOPE_ERROR_MESSAGE[resolution.code] });
    return null;
  }
  return {
    event: resolution.event,
    scoped: scopeDatabaseToEvent(database, resolution.event.id),
    context: eventContext(resolution.event),
  };
}

async function handleAdminSummary(req: IncomingMessage, res: ServerResponse, url: URL) {
  const session = await requireAdmin(req, res);
  if (!session) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  // ADMIN-002 Stage 1 RBAC: financial visibility is administrator/finance only.
  // `operation` keeps the endpoint for operational counts but receives no
  // revenue / ticket / manual financial counters / financial series.
  const financialVisible = financialVisibleForRole(session.role);

  const fullDatabase = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'admin-registrations' });
  const eventScope = resolveDashboardEventScope(res, fullDatabase, url);
  if (!eventScope) return;
  const database = eventScope.scoped;
  const now = new Date();
  // Business numbers come from the single canonical engine — no parallel formulas.
  const metrics = buildExecutiveMetrics(database, now);
  const paid = database.registrations.filter((item) => item.status === 'paid');
  const pending = database.registrations.filter((item) => item.status === 'pending_payment');
  const revenueCents = metrics.financial.grossRevenueCents;
  const averageTicketCents = metrics.financial.averageTicketCents;
  const checkIns = database.checkIns.length;
  const kitDeliveries = database.kitDeliveries.length;
  // Calendar windows are business-local (America/Porto_Velho), same authority
  // as the executive engine — no second UTC calculation.
  const todayKey = businessTodayKey(now);
  const weekStart = businessWeekStart(now); // Monday 00:00 business-local, as an instant
  const paidWithoutEmail = paid.filter((item) => !item.confirmationEmailSentAt).length;
  const manualReconciledPayments = database.payments.filter((item) => item.gatewayStatus === 'manual_reconciled_paid').length;
  const confirmationEmailsSent = paid.filter((item) => item.confirmationEmailSentAt).length;
  const confirmationEmailsFailed = paid.filter((item) => item.confirmationEmailError).length;
  const confirmationEmailsAttention = paid.filter((item) => !item.confirmationEmailSentAt || item.confirmationEmailError).length;
  const todayRegistrations = database.registrations.filter((item) => businessDateKey(item.createdAt) === todayKey).length;
  const weekRegistrations = database.registrations.filter((item) => new Date(item.createdAt) >= weekStart).length;
  const todayRevenueCents = metrics.financial.todayRevenueCents;
  const revenueInstant = (item: (typeof paid)[number]) => item.paidAt || item.confirmedAt || item.createdAt;
  const daily = businessDateKeysEndingToday(now, 7).map((key) => {
    const items = database.registrations.filter((item) => businessDateKey(item.createdAt) === key);
    const paidItems = paid.filter((item) => businessDateKey(revenueInstant(item)) === key);
    return { label: key.slice(5), count: items.length, amountCents: paidItems.reduce((total, item) => total + item.amountCents, 0) };
  });
  const byStatus = database.registrations.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const byDistance = database.distances.map((distance) => ({
    id: distance.id,
    name: distance.name,
    capacity: distance.capacity,
    total: database.registrations.filter((registration) => registration.distanceId === distance.id).length,
    paid: database.registrations.filter((registration) => registration.distanceId === distance.id && registration.status === 'paid').length,
    pending: database.registrations.filter((registration) => registration.distanceId === distance.id && registration.status === 'pending_payment').length,
  }));
  const shirtSizes = Object.entries(database.registrations.reduce<Record<string, number>>((accumulator, registration) => {
    accumulator[registration.payload.shirtSize] = (accumulator[registration.payload.shirtSize] || 0) + 1;
    return accumulator;
  }, {})).map(([size, total]) => ({ size, total }));
  const lots = database.lots
    .slice()
    .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0))
    .map((lot) => {
      const capacity = calculateLotCapacity(lot, database.registrations);
      return ({
      id: lot.id,
      name: lot.name,
      capacity: lot.capacity,
      soldCount: capacity.confirmed,
      confirmed: capacity.confirmed,
      temporaryReservations: capacity.temporaryReservations,
      occupied: capacity.occupied,
      remaining: capacity.available,
      available: capacity.available,
      priceCents: lot.priceCents,
      status: capacity.available === 0 ? 'sold_out' : lot.status,
    }); });

  json(res, 200, {
    event: eventScope.context,
    totals: {
      registrations: database.registrations.length,
      paid: paid.length,
      pending: pending.length,
      uniquePeople: metrics.registrations.uniquePeople,
      uniquePaidPeople: metrics.registrations.uniquePaidPeople,
      participantConversionRate: metrics.registrations.participantConversionRate,
      financialVisible,
      revenueCents: financialVisible ? revenueCents : 0,
      averageTicketCents: financialVisible ? averageTicketCents : 0,
      todayRevenueCents: financialVisible ? todayRevenueCents : 0,
      manualReconciledPayments: financialVisible ? manualReconciledPayments : 0,
      checkIns,
      kitDeliveries,
      paidWithoutEmail,
      confirmationEmailsSent,
      confirmationEmailsFailed,
      confirmationEmailsAttention,
      todayRegistrations,
      weekRegistrations,
    },
    byStatus,
    byDistance,
    lots,
    shirtSizes,
    daily: financialVisible ? daily : daily.map((point) => ({ ...point, amountCents: 0 })),
  });
}

async function handleAdminMetaIntegrationStatus(req: IncomingMessage, res: ServerResponse) {
  const session = await requireAdmin(req, res, ['administrator']);
  if (!session || !requireAdminDatabase(res)) return;
  json(res, 200, await getMetaIntegrationStatus());
}

// ADMIN-002 Stage 4B: event list for the executive dashboard selector.
// Same RBAC as the dashboard itself; non-sensitive metadata only.
async function handleAdminEvents(req: IncomingMessage, res: ServerResponse) {
  if (!await requireAdmin(req, res, ['administrator', 'finance']) || !requireAdminDatabase(res)) return;
  json(res, 200, { events: await listAdminEventsInPostgres() });
}

async function refreshOperationalAlerts(database: Database) {
  const detected = detectOperationalAlerts(database);
  if (usesPostgresDatabase() && detected.length) await synchronizeOperationalAlertsInPostgres(detected);
  return usesPostgresDatabase() ? listOperationalAlertsInPostgres() : [];
}

async function handleAdminExecutiveDashboard(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res, ['administrator', 'finance']) || !requireAdminDatabase(res)) return;
  const fullDatabase = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
  // ADMIN-002 Stage 4B: every panel is scoped to one event (resolved explicitly).
  const eventScope = resolveDashboardEventScope(res, fullDatabase, url);
  if (!eventScope) return;
  // Dashboard GETs are polled. Persisting the same alerts on every poll made
  // concurrent requests contend on identical rows and hold DB connections
  // until the statement timeout. Alert detection/persistence stays in the
  // dedicated alerts endpoint and operational flows.
  const alerts = await listOperationalAlertsInPostgres();
  const reconciliation = await getReconciliationDashboardInPostgres();
  json(res, 200, {
    event: eventScope.context,
    ...buildExecutiveDashboard(fullDatabase, new Date(), { eventId: eventScope.event.id }),
    // ADMIN-002 Stage 4B: alerts and reconciliation are NOT event-scoped yet
    // (no event_id on run-operational-alerts / run-payment-reconciliations, no
    // migration in this stage). Declared explicitly so the client never reads
    // them as belonging to the selected event.
    alerts: {
      scope: 'all-events' as const,
      active: alerts.filter((alert) => alert.status !== 'resolved').length,
      critical: alerts.filter((alert) => alert.status !== 'resolved' && alert.severity === 'critical').length,
      recent: alerts.slice(0, 10),
    },
    reconciliation: {
      scope: 'all-events' as const,
      manualReviewRequired: reconciliation.issues.filter((issue) => issue.resolutionStatus === 'manual_review_required').length,
      lastRun: reconciliation.runs[0] || null,
    },
  });
}

async function handleAdminAlerts(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res, ['administrator', 'finance']) || !requireAdminDatabase(res)) return;
  const database = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
  await refreshOperationalAlerts(database);
  const alerts = await listOperationalAlertsInPostgres({
    status: url.searchParams.get('status') || '', severity: url.searchParams.get('severity') || '', type: url.searchParams.get('type') || '',
  });
  json(res, 200, { alerts, totals: {
    open: alerts.filter((alert) => alert.status === 'open').length,
    acknowledged: alerts.filter((alert) => alert.status === 'acknowledged').length,
    resolved: alerts.filter((alert) => alert.status === 'resolved').length,
    critical: alerts.filter((alert) => alert.status !== 'resolved' && alert.severity === 'critical').length,
  } });
}

async function handleAdminAlertUpdate(req: IncomingMessage, res: ServerResponse, alertId: string) {
  const session = await requireAdmin(req, res, ['administrator', 'finance']);
  if (!session || !requireAdminDatabase(res)) return;
  const body = parseJsonBody<{ status?: 'acknowledged' | 'resolved'; resolution?: string }>(await readBody(req));
  if (!body || !['acknowledged', 'resolved'].includes(body.status || '') || String(body.resolution || '').trim().length < 5) {
    json(res, 422, { message: 'Informe status e resolução com pelo menos cinco caracteres.' }); return;
  }
  const alert = await updateOperationalAlertInPostgres({
    id: alertId, status: body.status!, resolution: String(body.resolution).trim(), actor: session.actor, actorRole: session.role,
    sessionId: session.id, ipAddress: getClientIp(req), userAgent: getUserAgent(req),
  });
  if (!alert) { json(res, 404, { message: 'Alerta não encontrado.' }); return; }
  json(res, 200, { alert });
}

async function handleAdminMonitoring(req: IncomingMessage, res: ServerResponse) {
  if (!await requireAdmin(req, res, ['administrator', 'finance']) || !requireAdminDatabase(res)) return;
  const startedAt = Date.now();
  const databaseStartedAt = Date.now();
  const databaseHealth = await pingDatabase();
  const databaseLatencyMs = Date.now() - databaseStartedAt;
  const database = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
  const sheets = getGoogleSheetsConfig();
  const lastWebhook = database.paymentEvents.filter((event) => event.eventType.includes('infinitepay')).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  const failedSheets = database.googleSheetSyncs.filter((sync) => sync.status === 'failed').length;
  const emailFailures = database.registrations.filter((registration) => Boolean(registration.confirmationEmailError)).length;
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  // Monitoring is polled together with the dashboard. It must remain read-only;
  // alert synchronization has its own endpoint and a non-blocking DB lock.
  const alerts = await listOperationalAlertsInPostgres();
  json(res, 200, {
    generatedAt: new Date().toISOString(),
    services: [
      { id: 'api', label: 'API', status: 'operational', latencyMs: Date.now() - startedAt, detail: 'FunPace API respondendo' },
      { id: 'database', label: 'Banco / Supabase', status: databaseHealth.ok ? 'operational' : 'down', latencyMs: databaseLatencyMs, detail: databaseHealth.provider },
      { id: 'infinitepay', label: 'InfinitePay', status: paymentProvider === 'infinitepay' && infinitePayHandle ? 'configured' : 'down', latencyMs: null, detail: 'Verificação ativa por payment_check' },
      { id: 'resend', label: 'Resend', status: isEmailConfigured() ? emailFailures ? 'degraded' : 'configured' : 'down', latencyMs: null, detail: `${emailFailures} falha(s) registrada(s)` },
      { id: 'google_sheets', label: 'Google Sheets', status: sheets.enabled && !sheets.configurationIssue ? failedSheets ? 'degraded' : 'configured' : sheets.enabled ? 'down' : 'disabled', latencyMs: null, detail: sheets.configurationIssue || `${failedSheets} falha(s)` },
      { id: 'webhook', label: 'Webhook', status: webhookSecret ? 'configured' : 'down', latencyMs: null, detail: lastWebhook ? `Último evento ${lastWebhook.receivedAt}` : 'Nenhum evento registrado' },
      { id: 'vercel', label: 'Vercel', status: process.env.VERCEL ? 'operational' : 'local', latencyMs: null, detail: process.env.VERCEL_REGION || 'ambiente local' },
    ],
    metrics: {
      responseTimeMs: Date.now() - startedAt, databaseQueryMs: databaseLatencyMs,
      memoryUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)), memoryRssMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
      cpuUserMs: Number((cpu.user / 1000).toFixed(1)), cpuSystemMs: Number((cpu.system / 1000).toFixed(1)), uptimeSeconds: Math.round(process.uptime()),
      errors: alerts.filter((alert) => alert.status !== 'resolved' && alert.severity === 'critical').length,
      webhooks: database.paymentEvents.filter((event) => event.eventType.includes('infinitepay')).length,
      payments: database.payments.length,
      emailsSent: database.registrations.filter((registration) => registration.confirmationEmailSentAt).length,
    },
  });
}

async function handleAdminEventConfig(req: IncomingMessage, res: ServerResponse) {
  if (!await requireAdmin(req, res, ['administrator']) || !requireAdminDatabase(res)) return;
  const database = await transaction((current) => current, { persist: false });
  const event = database.events[0] || null;
  const now = Date.now();
  const activeLot = database.lots.find((item) => item.status === 'active');
  const scheduledLot = database.lots.find((item) => item.status === 'scheduled' && new Date(item.startsAt).getTime() > now);
  const activeDistances = database.distances.filter((item) => item.status === 'active').length;
  const availableDistances = database.distances.filter((item) => item.status !== 'inactive').length;
  const salesAvailability: 'available' | 'scheduled' | 'closed' = event?.status !== 'published'
    ? 'closed'
    : activeLot && activeDistances > 0
      ? 'available'
      : scheduledLot
        ? 'scheduled'
        : 'closed';
  const databaseHealth = await pingDatabase();
  json(res, 200, {
    event,
    distances: database.distances,
    lots: database.lots,
    health: {
      database: databaseHealth,
      email: {
        configured: isEmailConfigured(),
        enabled: isEmailConfigured(),
        provider: getEmailProvider(),
      },
      gateway: {
        configured: Boolean(paymentProvider && infinitePayHandle),
        provider: paymentProvider || 'not_configured',
        handle: infinitePayHandle || null,
      },
      sales: {
        eventStatus: event?.status || 'draft',
        registrationAvailability: salesAvailability,
        activeLotId: activeLot?.id || null,
        activeLotName: activeLot?.name || null,
        activeDistances,
        availableDistances,
      },
    },
  });
}

async function handleAdminEventUpdate(req: IncomingMessage, res: ServerResponse) {
  const adminSession = await requireAdmin(req, res, ['administrator']);
  if (!adminSession || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const body = parseJsonBody<{ reason?: string; changes?: Record<string, unknown> }>(await readBody(req)); const reason = body?.reason?.trim() || '';
  if (reason.length < 5) { json(res, 400, { message: 'Informe um motivo com pelo menos 5 caracteres.' }); return; }
  const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {
    const event = database.events[0]; if (!event) return { statusCode: 404, payload: { message: 'Evento nao encontrado.' } };
    const allowed = ['name', 'date', 'startTime', 'locationName', 'city', 'state', 'status'] as const; const before: Record<string, unknown> = {}; const after: Record<string, unknown> = {};
    for (const field of allowed) { if (body?.changes?.[field] === undefined) continue; const value = compactText(body.changes[field], field === 'state' ? 2 : 160); if (value === event[field]) continue; before[field] = event[field]; after[field] = value; (event as unknown as Record<string, unknown>)[field] = value; }
    if (!event.name || !event.date || !event.city || !event.state) return { statusCode: 400, payload: { message: 'Nome, data, cidade e UF sao obrigatorios.' } };
    if (!['draft', 'published', 'closed'].includes(event.status) || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) || !/^[A-Z]{2}$/.test(event.state.toUpperCase())) return { statusCode: 400, payload: { message: 'Status, data ou UF invalido.' } };
    event.state = event.state.toUpperCase();
    const now = new Date().toISOString(); database.auditLogs.push(createAuditLog(req, adminSession, { action: 'event.updated', entityType: 'event', entityId: event.id, payload: { reason, before, after }, createdAt: now }));
    return { statusCode: 200, payload: { event } };
  }); json(res, result.statusCode, result.payload);
}

async function handleAdminDistanceUpdate(req: IncomingMessage, res: ServerResponse, distanceId: string) {
  const adminSession = await requireAdmin(req, res, ['administrator']);
  if (!adminSession || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const body = parseJsonBody<{ reason?: string; capacity?: number; status?: string }>(await readBody(req)); const reason = body?.reason?.trim() || '';
  if (reason.length < 5) { json(res, 400, { message: 'Informe um motivo com pelo menos 5 caracteres.' }); return; }
  const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {
    const distance = database.distances.find((item) => item.id === distanceId); if (!distance) return { statusCode: 404, payload: { message: 'Distancia nao encontrada.' } };
    const occupied = database.registrations.filter((item) => item.distanceId === distanceId && ['pending_payment', 'paid'].includes(item.status)).length;
    const capacity = Math.floor(Number(body?.capacity)); if (!Number.isFinite(capacity) || capacity < occupied) return { statusCode: 409, payload: { message: `A capacidade nao pode ser menor que ${occupied} vagas ocupadas.` } };
    if (!['active', 'inactive', 'sold_out'].includes(body?.status || '')) return { statusCode: 400, payload: { message: 'Status de distancia invalido.' } };
    const before = { capacity: distance.capacity, status: distance.status }; distance.capacity = capacity; distance.status = body!.status as typeof distance.status;
    database.auditLogs.push(createAuditLog(req, adminSession, { action: 'distance.updated', entityType: 'distance', entityId: distanceId, payload: { reason, before, after: { capacity, status: distance.status } }, createdAt: new Date().toISOString() }));
    return { statusCode: 200, payload: { distance } };
  }); json(res, result.statusCode, result.payload);
}

async function handleAdminLotUpdate(req: IncomingMessage, res: ServerResponse, lotId: string) {
  const adminSession = await requireAdmin(req, res, ['administrator']);
  if (!adminSession || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const body = parseJsonBody<{ reason?: string; name?: string; capacity?: number; priceCents?: number; status?: string; startsAt?: string; endsAt?: string }>(await readBody(req)); const reason = body?.reason?.trim() || '';
  if (reason.length < 5) { json(res, 400, { message: 'Informe um motivo com pelo menos 5 caracteres.' }); return; }
  const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {
    const lot = database.lots.find((item) => item.id === lotId); if (!lot) return { statusCode: 404, payload: { message: 'Lote nao encontrado.' } };
    const capacity = Math.floor(Number(body?.capacity)); const priceCents = Math.floor(Number(body?.priceCents));
    if (!Number.isFinite(capacity) || capacity < lot.soldCount) return { statusCode: 409, payload: { message: `A capacidade nao pode ser menor que ${lot.soldCount} vagas ocupadas.` } };
    if (!Number.isFinite(priceCents) || priceCents < 0) return { statusCode: 400, payload: { message: 'Preco invalido.' } };
    if (!['active', 'inactive', 'sold_out', 'scheduled', 'closed'].includes(body?.status || '')) return { statusCode: 400, payload: { message: 'Status de lote invalido.' } };
    if (body?.status === 'active' && database.lots.some((item) => item.id !== lotId && item.eventId === lot.eventId && item.status === 'active')) return { statusCode: 409, payload: { message: 'Ja existe outro lote ativo. Encerre-o antes de ativar este lote.' } };
    if (body?.startsAt && body?.endsAt && body.startsAt >= body.endsAt) return { statusCode: 400, payload: { message: 'O encerramento deve ser posterior ao inicio.' } };
    const before = { ...lot }; lot.name = compactText(body?.name, 100) || lot.name; lot.capacity = capacity; lot.priceCents = priceCents; lot.status = body!.status as typeof lot.status; lot.startsAt = body?.startsAt || ''; lot.endsAt = body?.endsAt || '';
    database.auditLogs.push(createAuditLog(req, adminSession, { action: 'lot.updated', entityType: 'lot', entityId: lotId, payload: { reason, before, after: lot }, createdAt: new Date().toISOString() }));
    return { statusCode: 200, payload: { lot } };
  }); json(res, result.statusCode, result.payload);
}

async function handleAdminSystemCheck(req: IncomingMessage, res: ServerResponse, target: 'email' | 'gateway') {
  if (!await requireAdmin(req, res, ['administrator']) || !requireAdminDatabase(res)) return;

  const database = await transaction((current) => current, { persist: false });
  const event = database.events[0] || null;
  const activeLot = database.lots.find((item) => item.status === 'active') || null;
  const activeDistances = database.distances.filter((item) => item.status === 'active');

  if (target === 'email') {
    const checks = [
      { label: 'Provider', ok: getEmailProvider() !== 'not_configured', detail: getEmailProvider() },
      { label: 'Configuracao', ok: isEmailConfigured(), detail: isEmailConfigured() ? 'Email pronto para uso.' : 'Faltam credenciais ou remetente.' },
      { label: 'Evento base', ok: Boolean(event?.name && event?.date), detail: event ? `${event.name} em ${event.date}` : 'Evento nao encontrado.' },
    ];
    const ok = checks.every((item) => item.ok);
    json(res, 200, { ok, target, summary: ok ? 'Email configurado para operacao.' : 'Email com pendencias de configuracao.', checks });
    return;
  }

  const checks = [
    { label: 'Provider', ok: Boolean(paymentProvider), detail: paymentProvider || 'Nao configurado' },
    { label: 'Handle', ok: Boolean(infinitePayHandle), detail: infinitePayHandle || 'Nao configurado' },
    { label: 'Evento publicado', ok: event?.status === 'published', detail: event?.status || 'Evento ausente' },
    { label: 'Lote ativo', ok: Boolean(activeLot), detail: activeLot?.name || 'Nenhum lote ativo' },
    { label: 'Distancias ativas', ok: activeDistances.length > 0, detail: `${activeDistances.length} ativa(s)` },
  ];
  const ok = checks.every((item) => item.ok);
  json(res, 200, { ok, target, summary: ok ? 'Gateway pronto para gerar vendas.' : 'Gateway com pendencias operacionais.', checks });
}

type AdminActionRequest = {
  notes?: string;
};

async function handleAdminCheckIn(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  const adminSession = await requireAdmin(req, res, ['administrator', 'operation']);
  if (!adminSession) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  if (!requireJson(req, res)) {
    return;
  }

  const rawBody = await readBody(req);
  const payload = parseJsonBody<AdminActionRequest>(rawBody) || {};
  const actor = adminSession.actor;
  const now = new Date().toISOString();

  const result = await transaction((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);

    if (!registration) {
      return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    }

    if (registration.status !== 'paid') {
      return { statusCode: 409, payload: { message: 'Check-in permitido apenas para inscricoes pagas.' } };
    }

    const existing = database.checkIns.find((item) => item.registrationId === registration.id);

    if (existing) {
      return {
        statusCode: 409,
        payload: {
          message: getCheckInConflictMessage({ actor: existing.checkedInBy || null, at: existing.checkedInAt || null }),
          registration: toAdminRow(database, registration),
        },
      };
    } else {
      database.checkIns.push({
        id: randomUUID(),
        registrationId: registration.id,
        status: 'checked_in',
        checkedInAt: now,
        checkedInBy: actor,
        notes: payload.notes?.trim() || null,
      });
    }

    database.auditLogs.push(createAuditLog(req, adminSession, {
      actor,
      action: 'registration.check_in',
      entityType: 'registration',
      entityId: registration.id,
      payload: { notes: payload.notes?.trim() || null },
      createdAt: now,
    }));

    return { statusCode: 200, payload: { registration: toAdminRow(database, registration) } };
  });

  const googleSheetSync = result.statusCode === 200
    ? await queueCheckInGoogleSheetSync(registrationId)
    : null;
  json(res, result.statusCode, result.payload);
  if (googleSheetSync) await processGoogleSheetSync(googleSheetSync.id);
}

async function handleAdminKitDelivery(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  const adminSession = await requireAdmin(req, res, ['administrator', 'operation']);
  if (!adminSession) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  if (!requireJson(req, res)) {
    return;
  }

  const rawBody = await readBody(req);
  const payload = parseJsonBody<AdminActionRequest>(rawBody) || {};
  const actor = adminSession.actor;
  const now = new Date().toISOString();

  const result = await transaction((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);

    if (!registration) {
      return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    }

    if (registration.status !== 'paid') {
      return { statusCode: 409, payload: { message: 'Entrega de kit permitida apenas para inscricoes pagas.' } };
    }

    const existing = database.kitDeliveries.find((item) => item.registrationId === registration.id);

    if (existing) {
      return {
        statusCode: 409,
        payload: {
          message: getKitConflictMessage({ actor: existing.deliveredBy || null, at: existing.deliveredAt || null }),
          registration: toAdminRow(database, registration),
        },
      };
    } else {
      database.kitDeliveries.push({
        id: randomUUID(),
        registrationId: registration.id,
        status: 'delivered',
        deliveredAt: now,
        deliveredBy: actor,
        notes: payload.notes?.trim() || null,
      });
    }

    database.auditLogs.push(createAuditLog(req, adminSession, {
      actor,
      action: 'registration.kit_delivered',
      entityType: 'registration',
      entityId: registration.id,
      payload: { notes: payload.notes?.trim() || null },
      createdAt: now,
    }));

    return { statusCode: 200, payload: { registration: toAdminRow(database, registration) } };
  });

  const googleSheetSync = result.statusCode === 200
    ? await queueCheckInGoogleSheetSync(registrationId)
    : null;
  json(res, result.statusCode, result.payload);
  if (googleSheetSync) await processGoogleSheetSync(googleSheetSync.id);
}

async function handleAdminRegistrationMaintenance(req: IncomingMessage, res: ServerResponse, registrationId: string, action: string) {
  const roles: AdminRole[] = action === 'send-email' ? ['administrator', 'finance'] : action === 'cancel' ? ['administrator'] : ['administrator', 'operation'];
  const adminSession = await requireAdmin(req, res, roles);
  if (!adminSession || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const body = parseJsonBody<{ reason?: string }>(await readBody(req)) || {};
  const reason = body.reason?.trim() || '';
  if (['cancel', 'undo-check-in', 'undo-kit'].includes(action) && reason.length < 5) { json(res, 400, { message: 'Informe um motivo com pelo menos 5 caracteres.' }); return; }
  if (action === 'send-email') {
    const database = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
    const registration = database.registrations.find((item) => item.id === registrationId);
    if (!registration || registration.status !== 'paid') { json(res, 409, { message: 'Reenvio permitido apenas para inscricoes pagas.' }); return; }
    if (registration.confirmationEmailSentAt) {
      json(res, 200, { registration: toAdminRow(database, registration), message: 'Email de confirmacao ja registrado. Nenhum novo envio foi realizado.' });
      return;
    }
    const emailResult = await processRegistrationEmail(registrationId);
    const refreshed = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
    const refreshedRegistration = refreshed.registrations.find((item) => item.id === registrationId)!;
    if (!emailResult?.ok) {
      json(res, 502, {
        message: `Nao foi possivel enviar o email: ${emailResult?.error || refreshedRegistration.confirmationEmailError || 'falha desconhecida'}`,
        registration: toAdminRow(refreshed, refreshedRegistration),
      });
      return;
    }
    json(res, 200, { registration: toAdminRow(refreshed, refreshedRegistration), message: 'Email de confirmacao enviado com sucesso.' }); return;
  }
  if (action === 'cancel' && usesPostgresDatabase()) {
    const cancelResult = await cancelRegistrationInPostgres({
      registrationId,
      actor: adminSession.actor,
      actorRole: adminSession.role,
      reason,
      sessionId: adminSession.id,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
    });
    if (cancelResult.status === 'not_found') { json(res, 404, { message: 'Inscricao nao encontrada.' }); return; }
    if (cancelResult.status === 'already_closed') { json(res, 409, { message: 'Inscricao ja encerrada.' }); return; }
    const refreshed = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
    const refreshedRegistration = refreshed.registrations.find((item) => item.id === registrationId)!;
    const googleSheetSync = await queueRegistrationGoogleSheetSync(registrationId);
    json(res, 200, { registration: toAdminRow(refreshed, refreshedRegistration), message: 'Inscricao cancelada com sucesso.' });
    if (googleSheetSync) await processGoogleSheetSync(googleSheetSync.id);
    return;
  }
  const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);
    if (!registration) return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    const now = new Date().toISOString(); const actor = adminSession.actor;
    if (action === 'cancel') {
      if (['cancelled', 'refunded'].includes(registration.status)) return { statusCode: 409, payload: { message: 'Inscricao ja encerrada.' } };
      registration.status = 'cancelled'; registration.updatedAt = now;
      const payment = database.payments.find((item) => item.registrationId === registrationId); if (payment) { payment.status = 'cancelled'; payment.updatedAt = now; }
      releaseRegistrationCapacity(database, registration);
    } else if (action === 'undo-check-in') {
      const undoCheckInMessage = canUndoCheckIn(database.checkIns.some((item) => item.registrationId === registrationId));
      if (undoCheckInMessage) {
        return { statusCode: 409, payload: { message: undoCheckInMessage } };
      }
      database.checkIns = database.checkIns.filter((item) => item.registrationId !== registrationId);
    } else if (action === 'undo-kit') {
      const undoKitMessage = canUndoKit(database.kitDeliveries.some((item) => item.registrationId === registrationId));
      if (undoKitMessage) {
        return { statusCode: 409, payload: { message: undoKitMessage } };
      }
      database.kitDeliveries = database.kitDeliveries.filter((item) => item.registrationId !== registrationId);
    }
    database.auditLogs.push(createAuditLog(req, adminSession, { actor, action: `registration.${action}`, entityType: 'registration', entityId: registrationId, payload: { reason }, createdAt: now }));
    return { statusCode: 200, payload: { registration: toAdminRow(database, registration) } };
  });
  const registrationGoogleSheetSync = result.statusCode === 200 && action === 'cancel'
    ? await queueRegistrationGoogleSheetSync(registrationId)
    : null;
  const googleSheetSync = result.statusCode === 200 && ['undo-check-in', 'undo-kit'].includes(action)
    ? await queueCheckInGoogleSheetSync(registrationId)
    : null;
  json(res, result.statusCode, result.payload);
  if (registrationGoogleSheetSync) await processGoogleSheetSync(registrationGoogleSheetSync.id);
  if (googleSheetSync) await processGoogleSheetSync(googleSheetSync.id);
}

async function handleAdminRegistrationUpdate(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  const adminSession = await requireAdmin(req, res, ['administrator']);
  if (!adminSession || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const body = parseJsonBody<{ reason?: string; changes?: Partial<RegistrationFormData> }>(await readBody(req));
  const reason = body?.reason?.trim() || '';
  if (reason.length < 5) { json(res, 400, { message: 'Informe um motivo com pelo menos 5 caracteres.' }); return; }
  const allowedFields = ['fullName', 'email', 'phone', 'birthDate', 'gender', 'shirtSize', 'emergencyContactName', 'emergencyContactPhone', 'city', 'state', 'team'] as const;
  const changes = body?.changes || {};
  const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);
    if (!registration) return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    const before: Record<string, unknown> = {}; const after: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (changes[field] === undefined) continue;
      let value: unknown = changes[field];
      if (typeof value === 'string') value = compactText(value, field === 'state' ? 2 : 180);
      if (field === 'email') value = String(value).toLowerCase();
      if (field === 'state') value = String(value).toUpperCase();
      if (value === registration.payload[field]) continue;
      before[field] = registration.payload[field]; after[field] = value;
      (registration.payload as unknown as Record<string, unknown>)[field] = value;
    }
    if (!String(registration.payload.fullName).trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registration.payload.email)) return { statusCode: 400, payload: { message: 'Nome e email valido sao obrigatorios.' } };
    if (!['female', 'male'].includes(registration.payload.gender) || !['P', 'M', 'G', 'GG'].includes(registration.payload.shirtSize)) return { statusCode: 400, payload: { message: 'Sexo ou tamanho de camisa invalido.' } };
    const birthDate = registration.payload.birthDate ? new Date(`${registration.payload.birthDate}T00:00:00`) : null;
    const emergencyPhoneDigits = onlyDigits(registration.payload.emergencyContactPhone);
    if (onlyDigits(registration.payload.phone).length < 10 || (emergencyPhoneDigits.length > 0 && emergencyPhoneDigits.length < 10)) return { statusCode: 400, payload: { message: 'Telefones devem conter DDD e numero validos.' } };
    if (registration.payload.state && !/^[A-Z]{2}$/.test(registration.payload.state)) return { statusCode: 400, payload: { message: 'UF invalida.' } };
    if (birthDate && (Number.isNaN(birthDate.getTime()) || birthDate > new Date() || birthDate.getFullYear() < new Date().getFullYear() - 100)) return { statusCode: 400, payload: { message: 'Data de nascimento invalida.' } };
    if (!Object.keys(after).length) return { statusCode: 400, payload: { message: 'Nenhuma alteracao foi informada.' } };
    const now = new Date().toISOString(); registration.updatedAt = now;
    database.auditLogs.push(createAuditLog(req, adminSession, { action: 'registration.updated', entityType: 'registration', entityId: registrationId, payload: { reason, before, after }, createdAt: now }));
    return { statusCode: 200, payload: { registration: toAdminRow(database, registration) } };
  });
  json(res, result.statusCode, result.payload);
}

async function handleAdminRegistrationDetails(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  const session = await requireAdmin(req, res);
  if (!session || !requireAdminDatabase(res)) return;
  const database = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
  const registration = database.registrations.find((item) => item.id === registrationId);
  if (!registration) { json(res, 404, { message: 'Inscricao nao encontrada.' }); return; }
  const payment = database.payments.find((item) => item.registrationId === registrationId);
  const partnerAuditLogs = session.role === 'administrator' ? await getRegistrationPartnerAuditInPostgres(registrationId) : [];
  const partnerTimeline = partnerAuditLogs.map((log) => {
    const metadata = log.metadata as Record<string, unknown>;
    const partnerType = (metadata.partnerType || metadata.partner_type || registration.partnerType) as PartnerType | null;
    return { id: `partner:${log.id}`, type: log.action, title: getPartnerAuditEventTitle(log.action, partnerType), occurredAt: log.createdAt, actor: log.userId || 'system', origin: 'partner_audit', severity: /failed|declined|rejected|issue|mismatch/i.test(log.action) ? 'critical' as const : /approved|applied/i.test(log.action) ? 'success' as const : 'info' as const, details: { partnerName: log.partnerName, partnerType, oldData: log.oldData, newData: log.newData, ...metadata } };
  });
  json(res, 200, {
    registration: toAdminRow(database, registration),
    auditLogs: database.auditLogs.filter((item) => item.entityId === registrationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    paymentEvents: payment ? database.paymentEvents.filter((item) => item.paymentId === payment.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)) : [],
    partnerAuditLogs,
    partnerHistory: session.role === 'administrator' && registration.partnerId ? { partnerId: registration.partnerId, partnerName: registration.partnerName || '', partnerType: registration.partnerType || 'sports_advisory', partnerLink: registration.partnerLink || '', discountPercentage: registration.discountPercentage || 0, identifiedAt: registration.partnerIdentifiedAt || registration.createdAt, paidAt: registration.paidAt || payment?.paidAt || null, responsibleUser: partnerAuditLogs.find((log) => log.userId)?.userId || null } : null,
    timeline: [...buildRegistrationTimeline(database, registrationId), ...partnerTimeline].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
  });
}

async function handleAdminBibNumber(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  const adminSession = await requireAdmin(req, res, ['administrator', 'operation']);
  if (!adminSession || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const body = parseJsonBody<{ bibNumber?: string; reason?: string }>(await readBody(req));
  const bibNumber = compactText(body?.bibNumber, 20).toUpperCase(); const reason = body?.reason?.trim() || '';
  if (!/^[A-Z0-9-]{1,20}$/.test(bibNumber) || reason.length < 5) { json(res, 400, { message: 'Numero de peito invalido ou motivo insuficiente.' }); return; }
  const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {
    const registration = database.registrations.find((item) => item.id === registrationId);
    if (!registration) return { statusCode: 404, payload: { message: 'Inscricao nao encontrada.' } };
    const event = database.events.find((item) => item.id === registration.eventId);
    const lot = database.lots.find((item) => item.id === registration.lotId);
    const bibAssignmentError = validateBibAssignment({
      registrationStatus: registration.status,
      eventStatus: event?.status || null,
      lotStatus: lot?.status || null,
      currentBibNumber: registration.bibNumber || null,
      nextBibNumber: bibNumber,
      isBibTaken: database.registrations.some((item) => item.eventId === registration.eventId && item.id !== registrationId && item.bibNumber === bibNumber),
    });
    if (bibAssignmentError) return { statusCode: 409, payload: { message: bibAssignmentError } };
    const previous = registration.bibNumber || null; const now = new Date().toISOString(); registration.bibNumber = bibNumber; registration.updatedAt = now;
    database.auditLogs.push(createAuditLog(req, adminSession, { action: 'registration.bib_assigned', entityType: 'registration', entityId: registrationId, payload: { reason, previous, bibNumber }, createdAt: now }));
    return { statusCode: 200, payload: { registration: toAdminRow(database, registration) } };
  });
  json(res, result.statusCode, result.payload);
}

async function handleAdminRegistrations(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res)) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  const rows = await getAdminRows(url);
  const requestedPage = Math.max(Number.parseInt(url.searchParams.get('page') || '1', 10) || 1, 1);
  const pageSize = url.searchParams.has('pageSize')
    ? Math.min(Math.max(Number.parseInt(url.searchParams.get('pageSize') || '25', 10) || 25, 1), 200)
    : Math.max(rows.length, 1);
  const total = rows.length;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(requestedPage, totalPages);
  json(res, 200, { registrations: rows.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total, totalPages } });
}

async function handleAdminGoogleSheetsStatus(req: IncomingMessage, res: ServerResponse) {
  if (!await requireAdmin(req, res, ['administrator', 'operation']) || !requireAdminDatabase(res)) return;
  const database = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
  const config = getGoogleSheetsConfig();
  const counts = { pending: 0, processing: 0, synchronized: 0, failed: 0 };
  for (const item of database.googleSheetSyncs) counts[item.status] += 1;
  const last = database.googleSheetSyncs.filter((item) => item.synchronizedAt).sort((a, b) => (b.synchronizedAt || '').localeCompare(a.synchronizedAt || ''))[0];
  const remarketingProjections = buildRemarketingProjections(database);
  const remarketingSummary = summarizeRemarketingProjections(remarketingProjections);
  const remarketingTasks = database.googleSheetSyncs.filter((item) => item.entityType === 'remarketing');
  const remarketingBacklog = remarketingTasks.filter((item) => ['pending', 'processing', 'failed'].includes(item.status));
  const volta10Campaign = summarizeVolta10RemarketingCampaign(database);
  const oldest = (status: 'pending' | 'processing') => database.googleSheetSyncs
    .filter((item) => item.status === status)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0]?.updatedAt || null;
  const staleBefore = Date.now() - 5 * 60_000;
  json(res, 200, {
    enabled: config.enabled,
    configured: config.enabled && !config.configurationIssue,
    configurationIssue: config.configurationIssue,
    counts,
    lastSynchronizedAt: last?.synchronizedAt || null,
    backlog: {
      oldestPendingAt: oldest('pending'),
      oldestProcessingAt: oldest('processing'),
      staleProcessing: database.googleSheetSyncs.filter((item) => item.status === 'processing' && item.lastAttemptAt && new Date(item.lastAttemptAt).getTime() <= staleBefore).length,
      permanentFailures: database.googleSheetSyncs.filter((item) => item.status === 'failed' && item.lastError?.startsWith('PERMANENT:')).length,
      retryableFailures: database.googleSheetSyncs.filter((item) => item.status === 'failed' && !item.lastError?.startsWith('PERMANENT:')).length,
    },
    remarketing: {
      totalLeads: remarketingSummary.candidates,
      eligible: remarketingSummary.eligible,
      suppressedPaid: remarketingSummary.suppressions.PAID,
      suppressedTest: remarketingSummary.suppressions.TEST,
      suppressedAdminCancelled: remarketingSummary.suppressions.ADMIN_CANCELLED,
      failedSyncs: remarketingTasks.filter((item) => item.status === 'failed').length,
      backlog: remarketingBacklog.length,
      oldestEventAt: remarketingBacklog.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.createdAt || null,
      volta10Campaign,
    },
  });
}

async function handleAdminRemarketingCampaignMetrics(req: IncomingMessage, res: ServerResponse) {
  if (!await requireAdmin(req, res, ['administrator', 'operation']) || !requireAdminDatabase(res)) return;
  const database = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
  json(res, 200, summarizeVolta10RemarketingCampaign(database));
}

async function handleAdminRemarketingCampaignEvent(req: IncomingMessage, res: ServerResponse) {
  const session = await requireAdmin(req, res, ['administrator', 'operation']);
  if (!session || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const body = parseJsonBody<{ event?: unknown; registrationIds?: unknown }>(await readBody(req));
  const event = typeof body?.event === 'string' ? body.event.trim().toLowerCase() as RemarketingCampaignManualEvent : '';
  if (!REMARKETING_CAMPAIGN_EVENTS.includes(event as RemarketingCampaignManualEvent)) {
    json(res, 422, { message: 'Evento de campanha invÃ¡lido.' }); return;
  }
  const registrationIds = Array.isArray(body?.registrationIds)
    ? [...new Set(body.registrationIds.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean))]
    : [];
  if (registrationIds.length > 500 || (event === 'message_sent' && registrationIds.length === 0)) {
    json(res, 422, { message: event === 'message_sent' ? 'Informe de 1 a 500 inscriÃ§Ãµes com envio confirmado.' : 'O limite Ã© de 500 inscriÃ§Ãµes por chamada.' }); return;
  }

  const result = await transaction((database) => {
    const projections = selectCampaignProjections(database, registrationIds.length ? registrationIds : undefined);
    const now = new Date().toISOString();
    let recorded = 0;
    for (const projection of projections) {
      const stages: RemarketingCampaignManualEvent[] = event === 'message_sent' ? ['eligible', 'message_sent'] : ['eligible'];
      for (const stage of stages) {
        const action = `remarketing.${stage}`;
        const duplicate = database.auditLogs.some((log) => log.action === action
          && (log.payload as Record<string, unknown> | null)?.campaign === VOLTA10_REMARKETING_CAMPAIGN
          && (log.payload as Record<string, unknown> | null)?.personKey === projection.personKey);
        if (duplicate) continue;
        database.auditLogs.push(createAuditLog(req, session, {
          action,
          entityType: 'registration',
          entityId: projection.registrationIdReference,
          payload: {
            campaign: VOLTA10_REMARKETING_CAMPAIGN,
            source: VOLTA10_REMARKETING_SOURCE,
            personKey: projection.personKey,
            registrationIdReference: projection.registrationIdReference,
          },
          createdAt: now,
        }));
        if (stage === event) recorded += 1;
      }
    }
    return {
      requested: registrationIds.length || projections.length,
      accepted: projections.length,
      rejected: Math.max((registrationIds.length || projections.length) - projections.length, 0),
      recorded,
      metrics: summarizeVolta10RemarketingCampaign(database),
    };
  }, { scope: 'admin-registrations' });
  json(res, 200, result);
}

async function handleAdminGoogleSheetsCheck(req: IncomingMessage, res: ServerResponse) {
  if (!await requireAdmin(req, res, ['administrator']) || !requireAdminDatabase(res)) return;
  const config = getGoogleSheetsConfig();
  if (!config.enabled || config.configurationIssue) {
    json(res, 409, { ok: false, message: config.configurationIssue || 'Google Sheets está desativado.' }); return;
  }
  try {
    const result = await createGoogleSheetsClient({ config }).ensureSpreadsheetStructure();
    json(res, 200, { ok: true, createdSheets: result.createdSheets, message: 'Conexão e estrutura validadas.' });
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), message: 'google_sheets_connection_check_failed', error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error' }));
    json(res, 502, { ok: false, message: error instanceof Error ? error.message : 'Falha ao validar Google Sheets.' });
  }
}

async function handleAdminRegistrationGoogleSheetsSync(req: IncomingMessage, res: ServerResponse, registrationId: string) {
  if (!await requireAdmin(req, res, ['administrator', 'operation']) || !requireAdminDatabase(res)) return;
  const database = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
  const registration = database.registrations.find((item) => item.id === registrationId);
  if (!registration) { json(res, 404, { message: 'Inscricao nao encontrada.' }); return; }
  const payment = database.payments.find((item) => item.registrationId === registrationId);
  const tasks = payment?.status === 'paid'
    ? await queueConfirmedPaymentGoogleSheetSync(registrationId, payment.id)
    : [await queueRegistrationGoogleSheetSync(registrationId)].filter(Boolean);
  if (database.checkIns.some((item) => item.registrationId === registrationId) || database.kitDeliveries.some((item) => item.registrationId === registrationId)) {
    const task = await queueCheckInGoogleSheetSync(registrationId); if (task) tasks.push(task);
  }
  json(res, 200, { queued: tasks.length });
  await processQueuedGoogleSheetSyncs(tasks);
}

async function handleAdminGoogleSheetsRetry(req: IncomingMessage, res: ServerResponse) {
  if (!await requireAdmin(req, res, ['administrator']) || !requireAdminDatabase(res)) return;
  const database = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
  const retryable = database.googleSheetSyncs.filter((item) => ['pending', 'failed'].includes(item.status));
  const tasks = retryable.slice(0, 25);
  const queuedRegistrationIds = new Set(database.googleSheetSyncs.filter((item) => item.entityType === 'registration').map((item) => item.entityId));
  for (const registration of database.registrations.filter((item) => !queuedRegistrationIds.has(item.id)).slice(0, Math.max(25 - tasks.length, 0))) {
    const task = await queueRegistrationGoogleSheetSync(registration.id); if (task) tasks.push(task);
  }
  const remaining = Math.max(retryable.length - Math.min(retryable.length, 25), 0)
    + Math.max(database.registrations.filter((item) => !queuedRegistrationIds.has(item.id)).length - Math.max(25 - Math.min(retryable.length, 25), 0), 0);
  json(res, 200, { queued: tasks.length, remaining });
  await processQueuedGoogleSheetSyncs(tasks);
}

async function handleAdminOperation(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res, ['administrator', 'operation']) || !requireAdminDatabase(res)) return;
  const database = await transaction((current) => current, { persist: false, scope: 'admin-registrations' });
  const query = (url.searchParams.get('q') || '').trim().toLowerCase();
  const filter = url.searchParams.get('filter') || 'all';
  const allPaid = database.registrations.filter((item) => item.status === 'paid').map((item) => toAdminRow(database, item));
  const rows = allPaid.filter((row) => {
    if (filter === 'kit_pending' && row.kitStatus === 'delivered') return false;
    if (filter === 'checkin_pending' && row.checkInStatus === 'checked_in') return false;
    if (filter === 'completed' && !(row.kitStatus === 'delivered' && row.checkInStatus === 'checked_in')) return false;
    if (query && ![row.id, row.fullName, row.email, row.phone, row.cpfMasked, row.bibNumber || ''].some((value) => value.toLowerCase().includes(query))) return false;
    return true;
  }).sort((a, b) => a.fullName.localeCompare(b.fullName, 'pt-BR'));
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') || 25), 1), 100);
  const totalPages = Math.max(Math.ceil(rows.length / pageSize), 1); const page = Math.min(Math.max(Number(url.searchParams.get('page') || 1), 1), totalPages);
  json(res, 200, {
    registrations: rows.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, pageSize, total: rows.length, totalPages },
    totals: { paid: allPaid.length, kitPending: allPaid.filter((row) => row.kitStatus !== 'delivered').length, checkInPending: allPaid.filter((row) => row.checkInStatus !== 'checked_in').length, completed: allPaid.filter((row) => row.kitStatus === 'delivered' && row.checkInStatus === 'checked_in').length },
  });
}

async function getFilteredAuditLogs(url: URL) {
  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'audit' });
  const action = (url.searchParams.get('action') || '').trim().toLowerCase();
  const actor = (url.searchParams.get('actor') || '').trim().toLowerCase();
  const entityType = (url.searchParams.get('entityType') || '').trim().toLowerCase();
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const dateFrom = url.searchParams.get('dateFrom') || ''; const dateTo = url.searchParams.get('dateTo') || '';
  return database.auditLogs.filter((log) => {
    if (action && !log.action.toLowerCase().includes(action)) return false;
    if (actor && !log.actor.toLowerCase().includes(actor)) return false;
    if (entityType && log.entityType.toLowerCase() !== entityType) return false;
    const date = log.createdAt.slice(0, 10); if (dateFrom && date < dateFrom) return false; if (dateTo && date > dateTo) return false;
    if (q && ![log.action, log.actor, log.entityType, log.entityId, JSON.stringify(log.payload)].some((value) => value.toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function handleAdminAuditLogs(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res, ['administrator', 'finance'])) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  const logs = await getFilteredAuditLogs(url);
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') || 50), 1), 100);
  const totalPages = Math.max(Math.ceil(logs.length / pageSize), 1); const page = Math.min(Math.max(Number(url.searchParams.get('page') || 1), 1), totalPages);
  json(res, 200, { logs: logs.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total: logs.length, totalPages } });
}

async function handleAdminAuditLogsCsv(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res, ['administrator', 'finance']) || !requireAdminDatabase(res)) return;
  const logs = await getFilteredAuditLogs(url);
  const headers = ['data', 'ator', 'perfil', 'acao', 'entidade', 'id_entidade', 'sessao', 'ip', 'user_agent', 'payload'];
  const lines = logs.map((log) => [log.createdAt, log.actor, log.actorRole, log.action, log.entityType, log.entityId, log.sessionId, log.ipAddress, log.userAgent, JSON.stringify(log.payload)].map(escapeCsv).join(','));
  csv(res, 'funpace-run-auditoria.csv', [headers.join(','), ...lines].join('\n'));
}

function toAdminPartner(partner: PartnerRecord) {
  return {
    id: partner.id,
    name: partner.name,
    slug: partner.slug,
    partnerType: partner.partnerType,
    discountPercentage: partner.discountPercentage,
    athleteLimit: partner.athleteLimit,
    status: partner.status,
    description: partner.description,
    createdAt: partner.createdAt,
    updatedAt: partner.updatedAt,
  };
}

function isPartnerSlugConflict(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'constraint' in error
    && (error as { constraint?: string }).constraint === 'run-partners_slug_key');
}

async function handleAdminPartnersList(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res, ['administrator']) || !requireAdminDatabase(res)) return;
  const name = (url.searchParams.get('name') || '').trim();
  const slug = normalizePartnerSlug(url.searchParams.get('slug') || '');
  const status = url.searchParams.get('status') || '';
  const partnerType = url.searchParams.get('partnerType') || url.searchParams.get('partner_type') || '';
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('pageSize') || '20', 10) || 20));
  if (status && !['active', 'inactive'].includes(status)) {
    json(res, 422, { message: 'Filtro de status invalido.' }); return;
  }
  if (partnerType && !partnerTypes.includes(partnerType as PartnerType)) {
    json(res, 422, { message: 'Filtro de tipo de parceiro invalido.' }); return;
  }
  const result = await listAdminPartnersInPostgres({
    name: name || undefined,
    slug: slug || undefined,
    status: status as PartnerRecord['status'] || undefined,
    partnerType: partnerType as PartnerType || undefined,
  }, page, pageSize);
  json(res, 200, { partners: result.partners.map(toAdminPartner), pagination: result.pagination });
}

async function handleAdminPartnerGet(req: IncomingMessage, res: ServerResponse, partnerId: string) {
  if (!await requireAdmin(req, res, ['administrator']) || !requireAdminDatabase(res)) return;
  const database = await transaction((current) => current, { persist: false, scope: 'partners' });
  const partner = database.partners.find((item) => item.id === partnerId && !item.deletedAt);
  if (!partner) { json(res, 404, { message: 'Parceiro nao encontrado.' }); return; }
  json(res, 200, { partner: toAdminPartner(partner) });
}

async function handleAdminPartnerSlugAvailability(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res, ['administrator']) || !requireAdminDatabase(res)) return;
  const slug = normalizePartnerSlug(url.searchParams.get('slug') || '');
  const excludeId = url.searchParams.get('excludeId') || '';
  if (slug.length < 2) { json(res, 200, { slug, available: false }); return; }
  const database = await transaction((current) => current, { persist: false, scope: 'partners' });
  const available = !database.partners.some((partner) => partner.slug === slug && partner.id !== excludeId);
  json(res, 200, { slug, available });
}

async function handleAdminPartnerWrite(req: IncomingMessage, res: ServerResponse, partnerId?: string) {
  const adminSession = await requireAdmin(req, res, ['administrator']);
  if (!adminSession || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const body = parseJsonBody<Record<string, unknown>>(await readBody(req));
  if (partnerId && body && (
    (body.partnerType === undefined && body.partner_type === undefined)
    || (body.athleteLimit === undefined && body.athlete_limit === undefined)
  )) {
    const database = await transaction((current) => current, { persist: false, scope: 'partners' });
    const currentPartner = database.partners.find((partner) => partner.id === partnerId && !partner.deletedAt);
    if (!currentPartner) { json(res, 404, { message: 'Parceiro nao encontrado.' }); return; }
    if (body.partnerType === undefined && body.partner_type === undefined) body.partnerType = currentPartner.partnerType;
    if (body.athleteLimit === undefined && body.athlete_limit === undefined) body.athleteLimit = currentPartner.athleteLimit;
  }
  const validation = validatePartnerInput(body);
  if ('errors' in validation) { json(res, 422, { message: 'Revise os dados do parceiro.', errors: validation.errors }); return; }
  const partnerInput = validation.value;
  try {
    const partner = await mutatePartnerWithAuditInPostgres({ mode: partnerId ? 'update' : 'create', partnerId, partner: partnerInput, actor: adminSession.actor, actorRole: adminSession.role, sessionId: adminSession.id, ipAddress: getClientIp(req), userAgent: getUserAgent(req) });
    if (!partner) { json(res, 404, { message: 'Parceiro nao encontrado.' }); return; }
    json(res, partnerId ? 200 : 201, { partner: toAdminPartner(partner) });
  } catch (error) {
    if (isPartnerSlugConflict(error)) { json(res, 409, { message: 'Este slug ja esta em uso.', errors: { slug: 'Slug indisponivel.' } }); return; }
    if (error instanceof PartnerTypeChangeBlockedError) {
      json(res, 409, { message: error.message, errors: { partnerType: error.message }, history: error.details }); return;
    }
    throw error;
  }
}

async function handleAdminPartnerStatus(req: IncomingMessage, res: ServerResponse, partnerId: string) {
  const adminSession = await requireAdmin(req, res, ['administrator']);
  if (!adminSession || !requireAdminDatabase(res) || !requireJson(req, res)) return;
  const body = parseJsonBody<{ status?: string }>(await readBody(req));
  if (!body?.status || !['active', 'inactive'].includes(body.status)) {
    json(res, 422, { message: 'Status de parceiro invalido.' }); return;
  }
  const partner = await mutatePartnerWithAuditInPostgres({ mode: 'status', partnerId, status: body.status as PartnerRecord['status'], actor: adminSession.actor, actorRole: adminSession.role, sessionId: adminSession.id, ipAddress: getClientIp(req), userAgent: getUserAgent(req) });
  if (!partner) { json(res, 404, { message: 'Parceiro nao encontrado.' }); return; }
  json(res, 200, { partner: toAdminPartner(partner) });
}

async function handleAdminPartnerDelete(req: IncomingMessage, res: ServerResponse, partnerId: string) {
  const adminSession = await requireAdmin(req, res, ['administrator']);
  if (!adminSession || !requireAdminDatabase(res)) return;
  const partner = await mutatePartnerWithAuditInPostgres({ mode: 'delete', partnerId, actor: adminSession.actor, actorRole: adminSession.role, sessionId: adminSession.id, ipAddress: getClientIp(req), userAgent: getUserAgent(req) });
  if (!partner) { json(res, 404, { message: 'Parceiro nao encontrado.' }); return; }
  json(res, 200, { ok: true });
}

const partnerPaymentStatuses = new Set(['pending_payment', 'paid', 'payment_failed', 'expired', 'cancelled', 'refunded']);

function readPartnerAnalyticsFilters(url: URL): { filters: PartnerAnalyticsFilters; page: number; pageSize: number } | { error: string } {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const eventId = (url.searchParams.get('eventId') || '').trim();
  const dateFrom = (url.searchParams.get('dateFrom') || '').trim();
  const dateTo = (url.searchParams.get('dateTo') || '').trim();
  const paymentStatus = (url.searchParams.get('paymentStatus') || '').trim();
  const partnerId = (url.searchParams.get('partnerId') || '').trim();
  const partnerTypeCamel = (url.searchParams.get('partnerType') || '').trim();
  const partnerTypeSnake = (url.searchParams.get('partner_type') || '').trim();
  if (partnerTypeCamel && partnerTypeSnake && partnerTypeCamel !== partnerTypeSnake) return { error: 'Tipo de parceiro divergente.' };
  const partnerType = partnerTypeCamel || partnerTypeSnake;
  const city = (url.searchParams.get('city') || '').trim().slice(0, 120);
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('pageSize') || '20', 10) || 20));
  if ((dateFrom && !datePattern.test(dateFrom)) || (dateTo && !datePattern.test(dateTo))) return { error: 'Periodo invalido.' };
  if (dateFrom && dateTo && dateFrom > dateTo) return { error: 'A data inicial nao pode ser posterior a data final.' };
  if (paymentStatus && !partnerPaymentStatuses.has(paymentStatus)) return { error: 'Status de pagamento invalido.' };
  if (partnerId && !uuidPattern.test(partnerId)) return { error: 'Parceiro invalido.' };
  if (partnerType && !partnerTypes.includes(partnerType as PartnerType)) return { error: 'Tipo de parceiro invalido.' };
  return { filters: { eventId: eventId || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, paymentStatus: paymentStatus || undefined, partnerId: partnerId || undefined, city: city || undefined, partnerType: partnerType as PartnerType || undefined }, page, pageSize };
}

async function handleAdminPartnerDashboard(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res, ['administrator']) || !requireAdminDatabase(res)) return;
  const parsed = readPartnerAnalyticsFilters(url);
  if ('error' in parsed) { json(res, 422, { message: parsed.error }); return; }
  json(res, 200, await getPartnerDashboardInPostgres(parsed.filters, parsed.page, parsed.pageSize));
}

async function handleAdminPartnerDashboardDetail(req: IncomingMessage, res: ServerResponse, url: URL, partnerId: string) {
  if (!await requireAdmin(req, res, ['administrator']) || !requireAdminDatabase(res)) return;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(partnerId)) { json(res, 422, { message: 'Parceiro invalido.' }); return; }
  const parsed = readPartnerAnalyticsFilters(url);
  if ('error' in parsed) { json(res, 422, { message: parsed.error }); return; }
  const detail = await getPartnerDetailInPostgres(partnerId, parsed.filters, parsed.page, parsed.pageSize);
  if (!detail) { json(res, 404, { message: 'Parceiro nao encontrado.' }); return; }
  json(res, 200, detail);
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

async function handleAdminPartnerDashboardExport(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res, ['administrator']) || !requireAdminDatabase(res)) return;
  const parsed = readPartnerAnalyticsFilters(url);
  if ('error' in parsed) { json(res, 422, { message: parsed.error }); return; }
  const format = url.searchParams.get('format') || 'csv';
  if (!['csv', 'excel'].includes(format)) { json(res, 422, { message: 'Formato de exportacao invalido.' }); return; }
  const rows = await exportPartnerRegistrationsInPostgres(parsed.filters);
  const headers = ['Inscricao', 'Atleta', 'Evento', 'Parceiro', 'Cidade', 'Data', 'Valor original', 'Desconto', 'Percentual', 'Valor pago', 'Status do pagamento', 'Tipo do parceiro'];
  const values = rows.map((row) => [row.id, row.athleteName, row.eventName, row.partnerName, row.city, row.createdAt, row.originalPriceCents / 100, row.discountAmountCents / 100, row.discountPercentage, row.finalPriceCents / 100, row.paymentStatus, row.partnerType]);
  if (format === 'excel') { binary(res, 'funpace-parceiros.xls', 'application/vnd.ms-excel; charset=utf-8', createExcelXml('Parceiros', headers, values)); return; }
  csv(res, 'funpace-parceiros.csv', `\uFEFF${[headers, ...values].map((row) => row.map(csvCell).join(';')).join('\n')}`);
}

async function handleAdminPartnerAudit(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res, ['administrator']) || !requireAdminDatabase(res)) return;
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('pageSize') || '25', 10) || 25));
  const partnerTypeCamel = url.searchParams.get('partnerType') || '';
  const partnerTypeSnake = url.searchParams.get('partner_type') || '';
  if (partnerTypeCamel && partnerTypeSnake && partnerTypeCamel !== partnerTypeSnake) { json(res, 422, { message: 'Tipo de parceiro divergente.' }); return; }
  const partnerType = partnerTypeCamel || partnerTypeSnake;
  const filters = { partnerId: url.searchParams.get('partnerId') || undefined, registrationId: url.searchParams.get('registrationId') || undefined, action: url.searchParams.get('action') || undefined, dateFrom: url.searchParams.get('dateFrom') || undefined, dateTo: url.searchParams.get('dateTo') || undefined, partnerType: partnerType as PartnerType || undefined };
  if (filters.partnerId && !/^[0-9a-f-]{36}$/i.test(filters.partnerId)) { json(res, 422, { message: 'Parceiro invalido.' }); return; }
  if ((filters.dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom)) || (filters.dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo))) { json(res, 422, { message: 'Periodo invalido.' }); return; }
  if (partnerType && !partnerTypes.includes(partnerType as PartnerType)) { json(res, 422, { message: 'Tipo de parceiro invalido.' }); return; }
  json(res, 200, await listPartnerAuditLogsInPostgres(filters, page, pageSize));
}

async function handleAdminPartnerMonitoring(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res, ['administrator']) || !requireAdminDatabase(res)) return;
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('pageSize') || '25', 10) || 25));
  const partnerTypeCamel = url.searchParams.get('partnerType') || '';
  const partnerTypeSnake = url.searchParams.get('partner_type') || '';
  if (partnerTypeCamel && partnerTypeSnake && partnerTypeCamel !== partnerTypeSnake) { json(res, 422, { message: 'Tipo de parceiro divergente.' }); return; }
  const partnerType = partnerTypeCamel || partnerTypeSnake;
  if (partnerType && !partnerTypes.includes(partnerType as PartnerType)) { json(res, 422, { message: 'Tipo de parceiro invalido.' }); return; }
  json(res, 200, await getPartnerMonitoringInPostgres(page, pageSize, partnerType as PartnerType || undefined));
}

async function handleAdminPartnerConsistency(req: IncomingMessage, res: ServerResponse) {
  const session = await requireAdmin(req, res, ['administrator']);
  if (!session || !requireAdminDatabase(res)) return;
  json(res, 200, await runPartnerConsistencyCheckInPostgres(session.actor));
}

async function handleAdminPartnerships(req: IncomingMessage, res: ServerResponse) {
  if (!await requireAdmin(req, res)) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'partnerships' });
  const partnerships = database.partnershipLeads
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toAdminPartnershipLead);

  json(res, 200, { partnerships });
}

async function handleAdminPartnershipStatus(req: IncomingMessage, res: ServerResponse, partnershipId: string) {
  const adminSession = await requireAdmin(req, res);
  if (!adminSession) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  if (!requireJson(req, res)) {
    return;
  }

  const rawBody = await readBody(req);
  const payload = parseJsonBody<{ status?: PartnershipLeadStatus }>(rawBody);
  const allowedStatuses: PartnershipLeadStatus[] = ['new', 'contacted', 'negotiating', 'approved', 'rejected'];
  const nextStatus = payload?.status;

  if (!nextStatus || !allowedStatuses.includes(nextStatus)) {
    json(res, 422, { message: 'Status de parceria invalido.' });
    return;
  }

  const actor = adminSession.actor;
  const result = await transaction<{ statusCode: number; payload: unknown }>((database) => {
    const lead = database.partnershipLeads.find((item) => item.id === partnershipId);

    if (!lead) {
      return { statusCode: 404, payload: { message: 'Proposta de parceria nao encontrada.' } };
    }

    lead.status = nextStatus;
    lead.updatedAt = new Date().toISOString();

    database.auditLogs.push(createAuditLog(req, adminSession, {
      actor,
      action: 'partnership.status_updated',
      entityType: 'partnership',
      entityId: lead.id,
      payload: { status: nextStatus },
      createdAt: new Date().toISOString(),
    }));

    return { statusCode: 200, payload: { partnership: toAdminPartnershipLead(lead) } };
  });

  json(res, result.statusCode, result.payload);
  if (result.statusCode === 200) {
    const task = await queuePartnershipGoogleSheetSync(partnershipId);
    if (task) await processGoogleSheetSync(task.id);
  }
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

async function handleAdminRegistrationsCsv(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res)) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  const rows = await getAdminRows(url);
  const headers = [
    'id',
    'nome',
    'email',
    'cpf',
    'telefone',
    'cidade',
    'estado',
    'equipe',
    'nascimento',
    'idade',
    'sexo',
    'contato_emergencia',
    'telefone_emergencia',
    'distancia',
    'lote',
    'camisa',
    'numero_peito',
    'status',
    'pagamento',
    'provider_pagamento',
    'id_pagamento_provider',
    'status_gateway',
    'transacao_gateway',
    'metodo_pagamento',
    'divergencia_pagamento',
    'check_in',
    'kit',
    'pago_em',
    'confirmado_em',
    'email_confirmacao_enviado_em',
    'email_confirmacao_provider',
    'email_confirmacao_erro',
    'valor',
    'criado_em',
  ];
  const lines = rows.map((row) => [
    row.id,
    row.fullName,
    row.email,
    row.cpfMasked,
    row.phone,
    row.city,
    row.state,
    row.team,
    row.birthDate,
    row.age ?? '',
    row.gender,
    row.emergencyContactName,
    row.emergencyContactPhone,
    row.distance,
    row.lot,
    row.shirtSize,
    row.bibNumber,
    row.status,
    row.paymentStatus,
    row.paymentProvider,
    row.providerPaymentId,
    row.gatewayStatus,
    row.gatewayTransactionId,
    row.paymentMethod,
    row.hasPaymentDivergence ? 'sim' : 'nao',
    row.checkInStatus,
    row.kitStatus,
    row.paidAt,
    row.confirmedAt,
    row.confirmationEmailSentAt,
    row.confirmationEmailProvider,
    row.confirmationEmailError,
    (row.amountCents / 100).toFixed(2),
    row.createdAt,
  ].map(escapeCsv).join(','));

  csv(res, 'funpace-run-inscritos.csv', [headers.join(','), ...lines].join('\n'));
}

async function handleAdminReportExport(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!await requireAdmin(req, res, ['administrator', 'finance']) || !requireAdminDatabase(res)) return;
  const rows = await getAdminRows(url);
  const headers = ['ID', 'Nome', 'Status', 'Lote', 'Distância', 'Cidade', 'Estado', 'Sexo', 'Valor', 'Pagamento', 'Criada em', 'Paga em'];
  const values = rows.map((row) => [row.id, row.fullName, row.status, row.lot, row.distance, row.city || '', row.state || '', row.gender, row.amountCents / 100, row.paymentMethod || row.paymentProvider || '', row.createdAt, row.paidAt || '']);
  const format = url.searchParams.get('format') || 'csv';
  if (format === 'excel') { binary(res, 'funpace-relatorio.xls', 'application/vnd.ms-excel; charset=utf-8', createExcelXml('Inscrições', headers, values)); return; }
  if (format === 'pdf') { binary(res, 'funpace-relatorio.pdf', 'application/pdf', createSimplePdf('FunPace - Relatório Operacional', headers, values)); return; }
  csv(res, 'funpace-relatorio.csv', [headers.map(escapeCsv).join(','), ...values.map((row) => row.map(escapeCsv).join(','))].join('\n'));
}

async function handleAdminPartnershipsCsv(req: IncomingMessage, res: ServerResponse) {
  if (!await requireAdmin(req, res)) {
    return;
  }

  if (!requireAdminDatabase(res)) {
    return;
  }

  const database = await transaction((currentDatabase) => currentDatabase, { persist: false, scope: 'partnerships' });
  const rows = database.partnershipLeads
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const headers = [
    'id',
    'empresa',
    'contato',
    'cargo',
    'email',
    'mensagem',
    'status',
    'origem',
    'criado_em',
    'atualizado_em',
  ];
  const lines = rows.map((row) => [
    row.id,
    row.companyName,
    row.contactName,
    row.contactRole,
    row.corporateEmail,
    row.involvementMessage,
    row.status,
    row.source,
    row.createdAt,
    row.updatedAt,
  ].map(escapeCsv).join(','));

  csv(res, 'funpace-run-parceiros.csv', [headers.join(','), ...lines].join('\n'));
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      await handleHealth(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/session') { await handleAdminLogin(req, res); return; }
    if (req.method === 'DELETE' && url.pathname === '/api/admin/session') { await handleAdminLogout(req, res); return; }
    if (req.method === 'GET' && url.pathname === '/api/admin/session') {
      if (!requireAdminDatabase(res)) return;
      const session = await readAdminSession(req);
      if (!session) { json(res, 401, { message: 'Sessao administrativa ausente ou expirada.' }); return; }
      json(res, 200, { actor: session.actor, role: session.role, expiresAt: new Date(session.expiresAt).toISOString() }); return;
    }

    if (req.method === 'PUT' && url.pathname === '/api/privacy/marketing-consent') {
      await handleMetaMarketingConsent(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/registrations') {
      await handleCreateRegistration(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/coupons/validate') {
      await handleValidateCoupon(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/partner-session') { await handlePartnerSession(req, res); return; }
    if (req.method === 'DELETE' && url.pathname === '/api/partner-session') { handleClearPartnerSession(res); return; }
    const partnerLinkActivation = url.pathname.match(/^\/api\/partners\/resolve\/([^/]+)$/);
    if (req.method === 'POST' && partnerLinkActivation) {
      await handleActivatePartnerLink(req, res, decodeURIComponent(partnerLinkActivation[1])); return;
    }

    if (req.method === 'POST' && url.pathname === '/api/partnerships') {
      await handleCreatePartnership(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/registrations/')) {
      await handleGetRegistration(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/availability') {
      await handleGetAvailability(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/summary') {
      await handleAdminSummary(req, res, url);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/events') { await handleAdminEvents(req, res); return; }
    if (req.method === 'GET' && url.pathname === '/api/admin/executive-dashboard') { await handleAdminExecutiveDashboard(req, res, url); return; }
    if (req.method === 'GET' && url.pathname === '/api/admin/monitoring') { await handleAdminMonitoring(req, res); return; }
    if (req.method === 'GET' && url.pathname === '/api/admin/integrations/meta/status') {
      await handleAdminMetaIntegrationStatus(req, res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/alerts') { await handleAdminAlerts(req, res, url); return; }
    const adminAlertUpdate = url.pathname.match(/^\/api\/admin\/alerts\/([^/]+)$/);
    if (req.method === 'PATCH' && adminAlertUpdate) { await handleAdminAlertUpdate(req, res, decodeURIComponent(adminAlertUpdate[1])); return; }
    if (req.method === 'GET' && url.pathname === '/api/admin/reconciliation') { await handleAdminReconciliation(req, res, false); return; }
    if (req.method === 'POST' && url.pathname === '/api/admin/reconciliation/run') { await handleAdminReconciliation(req, res, true); return; }
    if (req.method === 'GET' && url.pathname === '/api/admin/google-sheets/status') { await handleAdminGoogleSheetsStatus(req, res); return; }
    if (req.method === 'GET' && url.pathname === `/api/admin/remarketing/campaigns/${VOLTA10_REMARKETING_CAMPAIGN}`) { await handleAdminRemarketingCampaignMetrics(req, res); return; }
    if (req.method === 'POST' && url.pathname === `/api/admin/remarketing/campaigns/${VOLTA10_REMARKETING_CAMPAIGN}/events`) { await handleAdminRemarketingCampaignEvent(req, res); return; }
    if (req.method === 'POST' && url.pathname === '/api/admin/google-sheets/check') { await handleAdminGoogleSheetsCheck(req, res); return; }
    if (req.method === 'POST' && url.pathname === '/api/admin/google-sheets/retry') { await handleAdminGoogleSheetsRetry(req, res); return; }
    if (req.method === 'GET' && url.pathname === '/api/admin/event-config') { await handleAdminEventConfig(req, res); return; }
    if (req.method === 'PATCH' && url.pathname === '/api/admin/event-config') { await handleAdminEventUpdate(req, res); return; }
    if (req.method === 'POST' && url.pathname === '/api/admin/system-checks/email') { await handleAdminSystemCheck(req, res, 'email'); return; }
    if (req.method === 'POST' && url.pathname === '/api/admin/system-checks/gateway') { await handleAdminSystemCheck(req, res, 'gateway'); return; }
    const adminDistanceUpdate = url.pathname.match(/^\/api\/admin\/distances\/([^/]+)$/);
    if (req.method === 'PATCH' && adminDistanceUpdate) { await handleAdminDistanceUpdate(req, res, decodeURIComponent(adminDistanceUpdate[1])); return; }
    const adminLotUpdate = url.pathname.match(/^\/api\/admin\/lots\/([^/]+)$/);
    if (req.method === 'PATCH' && adminLotUpdate) { await handleAdminLotUpdate(req, res, decodeURIComponent(adminLotUpdate[1])); return; }
    if (req.method === 'GET' && url.pathname === '/api/admin/payments') { await handleAdminPayments(req, res, url); return; }
    if (req.method === 'GET' && url.pathname === '/api/admin/payments.csv') { await handleAdminPaymentsCsv(req, res, url); return; }
    const adminOrphanLink = url.pathname.match(/^\/api\/admin\/payment-events\/([^/]+)\/link$/);
    if (req.method === 'POST' && adminOrphanLink) { await handleAdminOrphanLink(req, res, decodeURIComponent(adminOrphanLink[1])); return; }

    if (req.method === 'GET' && url.pathname === '/api/admin/registrations') {
      await handleAdminRegistrations(req, res, url);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/operation') { await handleAdminOperation(req, res, url); return; }

    if (req.method === 'GET' && url.pathname === '/api/admin/registrations.csv') {
      await handleAdminRegistrationsCsv(req, res, url);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/reports/export') { await handleAdminReportExport(req, res, url); return; }

    if (req.method === 'GET' && url.pathname === '/api/admin/audit-logs') {
      await handleAdminAuditLogs(req, res, url);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/audit-logs.csv') { await handleAdminAuditLogsCsv(req, res, url); return; }

    if (req.method === 'GET' && url.pathname === '/api/admin/partner-audit') { await handleAdminPartnerAudit(req, res, url); return; }
    if (req.method === 'GET' && url.pathname === '/api/admin/partner-monitoring') { await handleAdminPartnerMonitoring(req, res, url); return; }
    if (req.method === 'POST' && url.pathname === '/api/admin/partner-consistency/run') { await handleAdminPartnerConsistency(req, res); return; }

    if (req.method === 'GET' && url.pathname === '/api/admin/partner-dashboard') { await handleAdminPartnerDashboard(req, res, url); return; }
    if (req.method === 'GET' && url.pathname === '/api/admin/partner-dashboard/export') { await handleAdminPartnerDashboardExport(req, res, url); return; }
    const adminPartnerDashboardDetail = url.pathname.match(/^\/api\/admin\/partner-dashboard\/([^/]+)$/);
    if (req.method === 'GET' && adminPartnerDashboardDetail) { await handleAdminPartnerDashboardDetail(req, res, url, decodeURIComponent(adminPartnerDashboardDetail[1])); return; }

    if (req.method === 'GET' && url.pathname === '/api/admin/partners') { await handleAdminPartnersList(req, res, url); return; }
    if (req.method === 'POST' && url.pathname === '/api/admin/partners') { await handleAdminPartnerWrite(req, res); return; }
    if (req.method === 'GET' && url.pathname === '/api/admin/partners/slug-availability') { await handleAdminPartnerSlugAvailability(req, res, url); return; }
    const adminPartnerStatus = url.pathname.match(/^\/api\/admin\/partners\/([^/]+)\/status$/);
    if (req.method === 'PATCH' && adminPartnerStatus) { await handleAdminPartnerStatus(req, res, decodeURIComponent(adminPartnerStatus[1])); return; }
    const adminPartner = url.pathname.match(/^\/api\/admin\/partners\/([^/]+)$/);
    if (adminPartner) {
      const partnerId = decodeURIComponent(adminPartner[1]);
      if (req.method === 'GET') { await handleAdminPartnerGet(req, res, partnerId); return; }
      if (req.method === 'PUT') { await handleAdminPartnerWrite(req, res, partnerId); return; }
      if (req.method === 'DELETE') { await handleAdminPartnerDelete(req, res, partnerId); return; }
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/partnerships') {
      await handleAdminPartnerships(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/partnerships.csv') {
      await handleAdminPartnershipsCsv(req, res);
      return;
    }

    const adminPartnershipAction = url.pathname.match(/^\/api\/admin\/partnerships\/([^/]+)\/status$/);

    if (req.method === 'POST' && adminPartnershipAction) {
      await handleAdminPartnershipStatus(req, res, decodeURIComponent(adminPartnershipAction[1]));
      return;
    }

    const adminRegistrationAction = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/(check-in|kit)$/);

    const adminRegistrationMaintenance = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/(cancel|send-email|undo-check-in|undo-kit)$/);
    if (req.method === 'POST' && adminRegistrationMaintenance) {
      await handleAdminRegistrationMaintenance(req, res, decodeURIComponent(adminRegistrationMaintenance[1]), adminRegistrationMaintenance[2]); return;
    }
    const adminRegistrationSheetSync = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/sync-google-sheets$/);
    if (req.method === 'POST' && adminRegistrationSheetSync) { await handleAdminRegistrationGoogleSheetsSync(req, res, decodeURIComponent(adminRegistrationSheetSync[1])); return; }
    const adminRegistrationUpdate = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)$/);
    if (req.method === 'PATCH' && adminRegistrationUpdate) { await handleAdminRegistrationUpdate(req, res, decodeURIComponent(adminRegistrationUpdate[1])); return; }
    if (req.method === 'GET' && adminRegistrationUpdate) { await handleAdminRegistrationDetails(req, res, decodeURIComponent(adminRegistrationUpdate[1])); return; }
    const adminBibNumber = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/bib-number$/);
    if (req.method === 'POST' && adminBibNumber) { await handleAdminBibNumber(req, res, decodeURIComponent(adminBibNumber[1])); return; }

    const adminPaymentAction = url.pathname.match(/^\/api\/admin\/payments\/([^/]+)(?:\/(reconcile))?$/);
    if (adminPaymentAction) {
      const registrationId = decodeURIComponent(adminPaymentAction[1]);
      if (req.method === 'GET' && !adminPaymentAction[2]) { await handleAdminPaymentDetails(req, res, registrationId); return; }
      if (req.method === 'POST' && adminPaymentAction[2] === 'reconcile') { await handleAdminPaymentReconcile(req, res, registrationId); return; }
    }

    if (req.method === 'POST' && adminRegistrationAction) {
      const registrationId = decodeURIComponent(adminRegistrationAction[1]);

      if (adminRegistrationAction[2] === 'check-in') {
        await handleAdminCheckIn(req, res, registrationId);
        return;
      }

      await handleAdminKitDelivery(req, res, registrationId);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/webhooks/payment') {
      await handlePaymentWebhook(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/payments/confirm') {
      await handlePaymentConfirmation(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/cron/payments') {
      await handlePaymentRecovery(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/cron/google-sheets') {
      await handleGoogleSheetsRecovery(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/cron/meta') {
      await handleMetaRecovery(req, res);
      return;
    }

    json(res, 404, { message: 'Rota nao encontrada.' });
  } catch (error) {
    const errorId = logServerError(req, error);
    json(res, 500, {
      message: `Erro interno. Nossa equipe ja foi notificada. Codigo: ${errorId}.`,
      errorId,
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(handleApiRequest).listen(port, () => {
    console.log(`FunPace Run API listening on http://localhost:${port}`);
    void ensureAdminBootstrap().catch((error) => {
      console.error('Failed to ensure admin bootstrap user.', error);
    });
  });
}
