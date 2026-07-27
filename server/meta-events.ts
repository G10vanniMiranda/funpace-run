import type { IncomingMessage } from 'node:http';
import type { RegistrationFormData } from '../src/types/registration';
import {
  buildMetaServerEvent,
  buildMetaUserData,
  getMetaCapiConfig,
  getMetaClientContext,
  isMetaCapiReady,
  normalizeEventTime,
  normalizeMetaSourceUrl,
  sendMetaServerEvent,
  validateMetaEventId,
  type MetaClientContext,
  type MetaServerEvent,
} from './meta-conversions-api.js';
import {
  claimMetaIntegrationEventsInPostgres,
  cleanupMetaClientContextInPostgres,
  completeMetaIntegrationEventInPostgres,
  enqueueMetaIntegrationEventInPostgres,
  failMetaIntegrationEventInPostgres,
  getMetaIntegrationStatusInPostgres,
  getMetaRegistrationSnapshotInPostgres,
  listPaidRegistrationsMissingMetaPurchaseInPostgres,
  usesPostgresDatabase,
} from './database.js';

const RETRY_DELAYS_SECONDS = [60, 5 * 60, 30 * 60, 2 * 60 * 60, 6 * 60 * 60];

type MetaRegistrationRequestContext = NonNullable<RegistrationFormData['meta']>;

export function canQueueMetaPurchase(
  registrationStatus: string,
  paymentStatus: string | undefined,
  paidAt: string | null,
) {
  return registrationStatus === 'paid' && paymentStatus === 'paid' && Boolean(paidAt);
}

function logMetaEvent(data: {
  eventName: string;
  eventId: string;
  registrationId: string;
  status: string;
  durationMs?: number;
  eventsReceived?: number;
  httpStatus?: number | null;
  errorCode?: string;
}) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    provider: 'meta',
    ...data,
  }));
}

function getIdentity(payload: RegistrationFormData, registrationId: string) {
  return {
    email: payload.email,
    phone: payload.phone,
    fullName: payload.fullName,
    gender: payload.gender,
    city: payload.city,
    state: payload.state,
    country: 'br',
    externalId: registrationId,
  };
}

function storedClientContext(context: Record<string, unknown>): MetaClientContext {
  return {
    clientIpAddress: typeof context.client_ip_address === 'string' ? context.client_ip_address : undefined,
    clientUserAgent: typeof context.client_user_agent === 'string' ? context.client_user_agent : undefined,
    fbc: typeof context.fbc === 'string' ? context.fbc : undefined,
    fbp: typeof context.fbp === 'string' ? context.fbp : undefined,
  };
}

async function getMetaRegistrationEventContext(
  req: IncomingMessage,
  registrationId: string,
  metaContext?: MetaRegistrationRequestContext,
) {
  if (!usesPostgresDatabase() || !isMetaCapiReady()) return null;
  if (metaContext?.marketingConsent === false) return null;
  const snapshot = await getMetaRegistrationSnapshotInPostgres(registrationId);
  if (!snapshot || snapshot.status !== 'pending_payment') return null;

  const clientContext = getMetaClientContext(req, metaContext);
  const userData = buildMetaUserData(getIdentity(snapshot.payload, registrationId), clientContext);
  const sourceUrl = normalizeMetaSourceUrl(metaContext?.sourceUrl, '/');
  const commonCustomData = {
    currency: 'BRL' as const,
    value: snapshot.amountCents / 100,
    content_name: snapshot.eventName,
    content_ids: [snapshot.eventId],
    content_type: 'product' as const,
  };
  return { snapshot, userData, sourceUrl, commonCustomData };
}

export async function queueMetaCompleteRegistrationEvent(
  req: IncomingMessage,
  registrationId: string,
  eventId: string,
  metaContext?: MetaRegistrationRequestContext,
) {
  if (!validateMetaEventId('CompleteRegistration', eventId)) return false;
  const context = await getMetaRegistrationEventContext(req, registrationId, metaContext);
  if (!context) return false;
  const event = buildMetaServerEvent({
    eventName: 'CompleteRegistration',
    eventId,
    eventTime: context.snapshot.createdAt,
    eventSourceUrl: context.sourceUrl,
    userData: context.userData,
    customData: { ...context.commonCustomData, status: true },
  });
  return enqueueMetaIntegrationEventInPostgres(registrationId, event);
}

export async function queueMetaInitiateCheckoutEvent(
  req: IncomingMessage,
  registrationId: string,
  eventId: string,
  initiatedAt: number,
  metaContext?: MetaRegistrationRequestContext,
) {
  if (!validateMetaEventId('InitiateCheckout', eventId)) return false;
  const context = await getMetaRegistrationEventContext(req, registrationId, metaContext);
  if (!context) return false;
  const eventTime = normalizeEventTime(initiatedAt)
    || normalizeEventTime(context.snapshot.createdAt);
  if (!eventTime) return false;
  const event = buildMetaServerEvent({
    eventName: 'InitiateCheckout',
    eventId,
    eventTime,
    eventSourceUrl: context.sourceUrl,
    userData: context.userData,
    customData: { ...context.commonCustomData, num_items: 1 },
  });
  return enqueueMetaIntegrationEventInPostgres(registrationId, event);
}

export async function queueMetaPurchaseEvent(registrationId: string) {
  if (!usesPostgresDatabase() || !isMetaCapiReady()) return false;
  const snapshot = await getMetaRegistrationSnapshotInPostgres(registrationId);
  if (!snapshot || !canQueueMetaPurchase(snapshot.status, snapshot.paymentStatus, snapshot.paidAt)) return false;
  if (snapshot.payload.meta?.marketingConsent === false) return false;

  const userData = buildMetaUserData(
    getIdentity(snapshot.payload, registrationId),
    storedClientContext(snapshot.clientContext as Record<string, unknown>),
  );
  const event = buildMetaServerEvent({
    eventName: 'Purchase',
    eventId: `purchase_${registrationId}`,
    eventTime: snapshot.paidAt,
    eventSourceUrl: normalizeMetaSourceUrl(undefined, '/sucesso'),
    userData,
    customData: {
      currency: 'BRL',
      value: snapshot.amountCents / 100,
      content_name: snapshot.eventName,
      content_ids: [snapshot.eventId],
      content_type: 'product',
      order_id: registrationId,
      num_items: 1,
    },
  });
  return enqueueMetaIntegrationEventInPostgres(registrationId, event);
}

function getRetryAt(attemptCount: number) {
  const delaySeconds = RETRY_DELAYS_SECONDS[Math.min(attemptCount - 1, RETRY_DELAYS_SECONDS.length - 1)];
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

export async function processMetaIntegrationQueue(limit = 10) {
  if (!usesPostgresDatabase() || !isMetaCapiReady()) {
    return { processed: 0, sent: 0, failed: 0 };
  }

  const config = getMetaCapiConfig();
  const claimed = await claimMetaIntegrationEventsInPostgres(limit, config.maxAttempts);
  const summary = { processed: claimed.length, sent: 0, failed: 0 };

  for (const record of claimed) {
    const event: MetaServerEvent = {
      event_name: record.eventName,
      event_time: record.eventTime,
      event_source_url: record.eventSourceUrl,
      action_source: 'website',
      event_id: record.eventId,
      user_data: { ...record.userData, ...record.clientContext },
      custom_data: record.customData,
    };
    const result = await sendMetaServerEvent(event);
    if (result.ok === true) {
      await completeMetaIntegrationEventInPostgres(record.id, {
        responseCode: result.httpStatus,
        eventsReceived: result.eventsReceived,
      });
      summary.sent += 1;
      logMetaEvent({
        eventName: record.eventName,
        eventId: record.eventId,
        registrationId: record.entityId,
        status: 'sent',
        eventsReceived: result.eventsReceived,
        durationMs: result.durationMs,
        httpStatus: result.httpStatus,
      });
      continue;
    }

    const canRetry = result.retryable && record.attemptCount < config.maxAttempts;
    await failMetaIntegrationEventInPostgres({
      id: record.id,
      errorCode: result.errorCode,
      responseCode: result.httpStatus,
      retryAt: canRetry ? getRetryAt(record.attemptCount) : null,
    });
    summary.failed += 1;
    logMetaEvent({
      eventName: record.eventName,
      eventId: record.eventId,
      registrationId: record.entityId,
      status: canRetry ? 'retry_scheduled' : 'failed_permanent',
      durationMs: result.durationMs,
      httpStatus: result.httpStatus,
      errorCode: result.errorCode,
    });
  }

  if (summary.sent > 0) await cleanupMetaClientContextInPostgres();
  return summary;
}

export async function recoverMetaIntegrationEvents() {
  if (!usesPostgresDatabase() || !isMetaCapiReady()) {
    return { recoveredPurchases: 0, processed: 0, sent: 0, failed: 0, cleanedContexts: 0 };
  }

  const missingPurchases = await listPaidRegistrationsMissingMetaPurchaseInPostgres(20);
  let recoveredPurchases = 0;
  for (const registrationId of missingPurchases) {
    if (await queueMetaPurchaseEvent(registrationId)) recoveredPurchases += 1;
  }
  const processed = await processMetaIntegrationQueue(20);
  const cleanedContexts = await cleanupMetaClientContextInPostgres();
  return { recoveredPurchases, ...processed, cleanedContexts };
}

export async function getMetaIntegrationStatus() {
  const config = getMetaCapiConfig();
  const databaseStatus = usesPostgresDatabase()
    ? await getMetaIntegrationStatusInPostgres()
    : { lastSuccessfulEventAt: null, recentFailures: 0, pendingEvents: 0 };
  return {
    enabled: config.enabled,
    pixelConfigured: Boolean(config.pixelId),
    tokenConfigured: Boolean(config.accessToken),
    apiVersionConfigured: Boolean(config.graphApiVersion),
    testMode: Boolean(config.testEventCode),
    datasetQualityTokenConfigured: Boolean(process.env.META_DATASET_QUALITY_TOKEN?.trim()),
    ...databaseStatus,
  };
}
