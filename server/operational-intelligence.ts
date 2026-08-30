import type { Database, RegistrationRecord } from './database.js';
import { businessDateKey, businessDateKeysEndingToday, businessHour } from './business-time.js';
import { buildExecutiveMetrics, type ExecutiveScopeOptions } from './executive-metrics.js';
import { scopeDatabaseToEvent } from './event-scope.js';
import { calculateLotCapacity } from './lot-capacity.js';

export type OperationalAlertCandidate = {
  dedupeKey: string;
  severity: 'info' | 'warning' | 'critical';
  alertType: string;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown>;
};

function groupPaid(
  paid: RegistrationRecord[],
  keyFor: (registration: RegistrationRecord) => string,
) {
  const groups = new Map<string, { label: string; count: number; amountCents: number }>();
  for (const registration of paid) {
    const label = keyFor(registration) || 'Não informado';
    const current = groups.get(label) || { label, count: 0, amountCents: 0 };
    current.count += 1;
    current.amountCents += registration.amountCents;
    groups.set(label, current);
  }
  return [...groups.values()].sort((left, right) => right.amountCents - left.amountCents);
}

function marketingSource(registration: RegistrationRecord) {
  const attribution = registration.payload.attribution;
  const raw = String(attribution?.utmSource || attribution?.source || '').toLowerCase();
  if (raw.includes('google')) return 'Google';
  if (raw.includes('instagram')) return 'Instagram';
  if (raw.includes('facebook') || raw === 'fb') return 'Facebook';
  if (raw.includes('whatsapp')) return 'WhatsApp';
  if (raw.includes('qr')) return 'QR Code';
  if (raw) return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return 'Direto';
}

export function buildExecutiveDashboard(
  database: Database,
  now = new Date(),
  options: ExecutiveScopeOptions = {},
) {
  // ADMIN-002 Stage 4B: every panel below is scoped to one event when an
  // eventId is given (idempotent; no-op when absent).
  const scoped = options.eventId ? scopeDatabaseToEvent(database, options.eventId) : database;
  const paid = scoped.registrations.filter((registration) => registration.status === 'paid');
  // Single source of truth for every business number (revenue, participant
  // conversion, checkout conversion, people-vs-rows). No parallel formulas here.
  const metrics = buildExecutiveMetrics(scoped, now);
  const { financial, checkouts } = metrics;
  const statusCounts = scoped.registrations.reduce<Record<string, number>>((summary, registration) => {
    summary[registration.status] = (summary[registration.status] || 0) + 1;
    return summary;
  }, {});

  const lots = scoped.lots.slice().sort((a, b) => a.orderIndex - b.orderIndex).map((lot) => {
    const capacity = calculateLotCapacity(lot, scoped.registrations, now);
    const occupancyPercent = capacity.capacityTotal ? Number((capacity.occupied / capacity.capacityTotal * 100).toFixed(1)) : 0;
    return { id: lot.id, name: lot.name, priceCents: lot.priceCents, ...capacity, occupancyPercent,
      level: occupancyPercent >= 100 ? 'blocked' : occupancyPercent >= 95 ? 'critical' : occupancyPercent >= 80 ? 'warning' : 'normal' };
  });

  // Daily / hourly / cumulative buckets are business-local (America/Porto_Velho).
  const revenueInstant = (registration: RegistrationRecord) =>
    registration.paidAt || registration.confirmedAt || registration.createdAt;
  const dailyByKey = new Map<string, { count: number; amountCents: number }>();
  for (const registration of paid) {
    const key = businessDateKey(revenueInstant(registration));
    const bucket = dailyByKey.get(key) || { count: 0, amountCents: 0 };
    bucket.count += 1;
    bucket.amountCents += registration.amountCents;
    dailyByKey.set(key, bucket);
  }
  const daily = businessDateKeysEndingToday(now, 30).map((key) => {
    const bucket = dailyByKey.get(key) || { count: 0, amountCents: 0 };
    return { label: key, count: bucket.count, amountCents: bucket.amountCents };
  });
  let cumulative = 0;
  const cumulativeRevenue = daily.map((item) => ({ ...item, amountCents: (cumulative += item.amountCents) }));
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const items = paid.filter((registration) => businessHour(revenueInstant(registration)) === hour);
    return { label: `${String(hour).padStart(2, '0')}:00`, count: items.length, amountCents: items.reduce((sum, registration) => sum + registration.amountCents, 0) };
  });

  const campaigns = groupPaid(paid, (registration) => registration.payload.attribution?.utmCampaign || 'Sem campanha');
  const sources = groupPaid(scoped.registrations, marketingSource).map((source) => {
    const sourcePaid = paid.filter((registration) => marketingSource(registration) === source.label);
    const total = scoped.registrations.filter((registration) => marketingSource(registration) === source.label).length;
    return { ...source, total, paid: sourcePaid.length, conversionRate: total ? Number((sourcePaid.length / total * 100).toFixed(1)) : 0, cpaCents: null as number | null };
  });

  return {
    generatedAt: now.toISOString(),
    financial: {
      grossRevenueCents: financial.grossRevenueCents,
      confirmedRevenueCents: financial.confirmedRevenueCents,
      todayRevenueCents: financial.todayRevenueCents,
      weekRevenueCents: financial.weekRevenueCents,
      averageTicketCents: financial.averageTicketCents,
      eventRevenueCents: financial.grossRevenueCents,
      /** @deprecated ADMIN-002 Stage 1: no fabricated net; alias of confirmedRevenueCents. */
      netRevenueCents: financial.confirmedRevenueCents,
    },
    registrations: {
      registrationRows: metrics.registrations.registrationRows,
      uniquePeople: metrics.registrations.uniquePeople,
      paidRegistrationRows: metrics.registrations.paidRegistrationRows,
      uniquePaidPeople: metrics.registrations.uniquePaidPeople,
      participantConversionRate: metrics.registrations.participantConversionRate,
      // operational status counts (not business-truth conversion)
      total: metrics.registrations.registrationRows,
      confirmed: metrics.registrations.paidRegistrationRows,
      pending: statusCounts.pending_payment || 0,
      expired: statusCounts.expired || 0,
      cancelled: statusCounts.cancelled || 0,
      refunded: statusCounts.refunded || 0,
      /** @deprecated ADMIN-002 Stage 1: use participantConversionRate. */
      conversionRate: metrics.registrations.participantConversionRate,
    },
    checkouts: {
      created: checkouts.created,
      paid: checkouts.paid,
      checkoutConversionRate: checkouts.checkoutConversionRate,
      abandonmentRate: checkouts.abandonmentRate,
      /** @deprecated ADMIN-002 Stage 1: use checkoutConversionRate. */
      conversionRate: checkouts.checkoutConversionRate,
    },
    lots,
    charts: {
      daily, hourly, cumulativeRevenue,
      byLot: groupPaid(paid, (registration) => scoped.lots.find((lot) => lot.id === registration.lotId)?.name || registration.lotId),
      byDistance: groupPaid(paid, (registration) => scoped.distances.find((distance) => distance.id === registration.distanceId)?.name || registration.distanceId),
      byCity: groupPaid(paid, (registration) => registration.payload.city || 'Não informado'),
      byGender: groupPaid(paid, (registration) => registration.payload.gender === 'female' ? 'Feminino' : registration.payload.gender === 'male' ? 'Masculino' : 'Não informado'),
    },
    marketing: { sources, campaigns, topSource: sources[0]?.label || 'Sem dados' },
    athletes: {
      byCity: groupPaid(paid, (registration) => registration.payload.city || 'Não informado'),
      byState: groupPaid(paid, (registration) => registration.payload.state || 'Não informado'),
      byGender: groupPaid(paid, (registration) => registration.payload.gender || 'Não informado'),
      byDistance: groupPaid(paid, (registration) => registration.payload.distance),
      byShirt: groupPaid(paid, (registration) => registration.payload.shirtSize),
      byLot: groupPaid(paid, (registration) => scoped.lots.find((lot) => lot.id === registration.lotId)?.name || registration.lotId),
      byAge: groupPaid(paid, (registration) => {
        const age = registration.payload.birthDate ? Math.floor((now.getTime() - new Date(registration.payload.birthDate).getTime()) / 31_557_600_000) : -1;
        if (age < 0) return 'Não informado'; if (age < 18) return 'Até 17'; if (age < 30) return '18–29'; if (age < 40) return '30–39'; if (age < 50) return '40–49'; return '50+';
      }),
    },
    recent: {
      payments: scoped.payments.filter((payment) => payment.status === 'paid').sort((a, b) => (b.paidAt || b.updatedAt).localeCompare(a.paidAt || a.updatedAt)).slice(0, 10).map((payment) => ({
        id: payment.id, registrationId: payment.registrationId, amountCents: payment.amountCents,
        paidAt: payment.paidAt, updatedAt: payment.updatedAt, gatewayStatus: payment.gatewayStatus,
      })),
      confirmations: paid.slice().sort((a, b) => (b.confirmedAt || b.updatedAt).localeCompare(a.confirmedAt || a.updatedAt)).slice(0, 10).map((registration) => ({ id: registration.id, confirmedAt: registration.confirmedAt, amountCents: registration.amountCents })),
      // Sanitised projection only: NO raw gateway payload reaches the browser
      // (no customer name / email / document / phone). ADMIN-002 Stage 1.
      webhooks: scoped.paymentEvents
        .filter((event) => event.eventType.includes('infinitepay'))
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
        .slice(0, 10)
        .map((event) => ({
          id: event.id,
          paymentId: event.paymentId,
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          receivedAt: event.receivedAt,
        })),
    },
  };
}

export function detectOperationalAlerts(database: Database, now = new Date()): OperationalAlertCandidate[] {
  const alerts: OperationalAlertCandidate[] = [];
  const push = (alert: OperationalAlertCandidate) => alerts.push(alert);
  for (const registration of database.registrations.filter((item) => item.status === 'paid' && (!item.confirmationEmailSentAt || item.confirmationEmailError))) {
    push({ dedupeKey: `email:${registration.id}`, severity: 'critical', alertType: 'email_failure', title: 'Falha no e-mail de confirmação', message: registration.confirmationEmailError || 'Confirmação paga sem e-mail registrado.', entityType: 'registration', entityId: registration.id });
  }
  for (const registration of database.registrations.filter((item) => !database.payments.some((payment) => payment.registrationId === item.id))) {
    push({ dedupeKey: `registration-without-payment:${registration.id}`, severity: 'warning', alertType: 'registration_without_payment', title: 'Inscrição sem pagamento', message: `Inscrição ${registration.id} não possui pagamento local.`, entityType: 'registration', entityId: registration.id });
  }
  for (const event of database.paymentEvents.filter((item) => item.eventType === 'infinitepay.orphan')) {
    push({ dedupeKey: `orphan-payment:${event.providerEventId}`, severity: 'critical', alertType: 'payment_without_registration', title: 'Pagamento recebido sem inscrição', message: 'Evento InfinitePay órfão exige análise.', entityType: 'payment_event', entityId: event.id });
  }
  for (const sync of database.googleSheetSyncs.filter((item) => item.status === 'failed')) {
    push({ dedupeKey: `sheets:${sync.id}`, severity: 'warning', alertType: 'google_sheets_error', title: 'Erro no Google Sheets', message: sync.lastError || 'Sincronização falhou.', entityType: sync.entityType, entityId: sync.entityId });
  }
  for (const payment of database.payments.filter((item) => item.gatewayStatus === 'manual_reconciled_paid')) {
    push({ dedupeKey: `manual-payment:${payment.id}`, severity: 'warning', alertType: 'manual_payment', title: 'Pagamento manual', message: 'Pagamento confirmado historicamente por processo manual.', entityType: 'payment', entityId: payment.id });
  }
  const transactionGroups = new Map<string, typeof database.payments>();
  for (const payment of database.payments) {
    const transactionId = payment.gatewayTransactionId || payment.providerPaymentId;
    if (!transactionId) continue;
    transactionGroups.set(transactionId, [...(transactionGroups.get(transactionId) || []), payment]);
  }
  for (const [transactionId, payments] of transactionGroups) {
    if (payments.length < 2) continue;
    push({
      dedupeKey: `duplicate-payment:${transactionId}`, severity: 'critical', alertType: 'duplicate_payment',
      title: 'Pagamento duplicado', message: `${payments.length} pagamentos compartilham a transação ${transactionId}.`,
      entityType: 'payment', entityId: payments[0].id, payload: { transactionId, paymentIds: payments.map((payment) => payment.id) },
    });
  }
  for (const event of database.paymentEvents.filter((item) => item.eventType.includes('amount_mismatch'))) {
    push({ dedupeKey: `amount-mismatch:${event.id}`, severity: 'critical', alertType: 'revenue_mismatch', title: 'Receita divergente', message: 'Valor recebido diverge do valor da inscrição.', entityType: 'payment_event', entityId: event.id });
  }
  for (const lot of database.lots) {
    const capacity = calculateLotCapacity(lot, database.registrations, now);
    const percentage = capacity.capacityTotal ? capacity.occupied / capacity.capacityTotal * 100 : 0;
    if (capacity.occupied > capacity.capacityTotal) push({ dedupeKey: `lot-over:${lot.id}`, severity: 'critical', alertType: 'capacity_exceeded', title: 'Capacidade excedida', message: `${lot.name}: ${capacity.occupied}/${capacity.capacityTotal}.`, entityType: 'lot', entityId: lot.id, payload: capacity });
    else if (percentage >= 95) push({ dedupeKey: `lot-95:${lot.id}`, severity: 'critical', alertType: 'lot_nearly_sold_out', title: 'Lote em nível crítico', message: `${lot.name} atingiu ${percentage.toFixed(1)}%.`, entityType: 'lot', entityId: lot.id, payload: capacity });
    else if (percentage >= 80) push({ dedupeKey: `lot-80:${lot.id}`, severity: 'warning', alertType: 'lot_nearly_sold_out', title: 'Lote esgotando', message: `${lot.name} atingiu ${percentage.toFixed(1)}%.`, entityType: 'lot', entityId: lot.id, payload: capacity });
  }
  return alerts;
}

export type RegistrationTimelineEvent = {
  id: string; type: string; title: string; occurredAt: string; actor: string; origin: string;
  severity: 'info' | 'success' | 'warning' | 'critical'; details: Record<string, unknown>;
};

export function buildRegistrationTimeline(database: Database, registrationId: string) {
  const registration = database.registrations.find((item) => item.id === registrationId);
  if (!registration) return [];
  const payment = database.payments.find((item) => item.registrationId === registrationId);
  const events: RegistrationTimelineEvent[] = [{
    id: `registration-created:${registration.id}`, type: 'registration.created', title: 'Inscrição criada',
    occurredAt: registration.createdAt, actor: 'system', origin: 'landing_page', severity: 'info',
    details: { status: 'pending_payment', lotId: registration.lotId, distanceId: registration.distanceId },
  }];
  if (payment) events.push({ id: `payment-created:${payment.id}`, type: 'checkout.started', title: 'Checkout iniciado', occurredAt: payment.createdAt, actor: 'system', origin: payment.provider, severity: 'info', details: { paymentId: payment.id } });
  for (const event of database.paymentEvents.filter((item) => item.paymentId === payment?.id)) {
    const isFailure = /fail|mismatch|orphan|error/i.test(event.eventType);
    events.push({ id: event.id, type: event.eventType, title: event.eventType.includes('checkout_created') ? 'Checkout / PIX gerado' : event.eventType.includes('webhook') ? 'Webhook recebido' : event.eventType, occurredAt: event.receivedAt, actor: 'InfinitePay', origin: 'gateway', severity: isFailure ? 'critical' : 'info', details: { providerEventId: event.providerEventId, payload: event.payload } });
  }
  if (registration.paidAt) events.push({ id: `paid:${registration.id}`, type: 'payment.confirmed', title: 'Pagamento confirmado', occurredAt: registration.paidAt, actor: 'system', origin: 'payment_flow', severity: 'success', details: { amountCents: registration.amountCents, transactionId: payment?.gatewayTransactionId } });
  if (registration.confirmedAt) events.push({ id: `confirmed:${registration.id}`, type: 'registration.confirmed', title: 'Inscrição confirmada', occurredAt: registration.confirmedAt, actor: 'system', origin: 'payment_flow', severity: 'success', details: { bibNumber: registration.bibNumber } });
  if (registration.confirmationEmailSentAt) events.push({ id: `email:${registration.id}`, type: 'email.sent', title: 'E-mail enviado', occurredAt: registration.confirmationEmailSentAt, actor: registration.confirmationEmailProvider || 'system', origin: 'email', severity: 'success', details: { messageId: registration.confirmationEmailId } });
  for (const sync of database.googleSheetSyncs.filter((item) => item.entityId === registrationId && item.synchronizedAt)) events.push({ id: `sheet:${sync.id}`, type: 'google_sheets.synchronized', title: 'Google Sheets atualizado', occurredAt: sync.synchronizedAt!, actor: 'system', origin: 'google_sheets', severity: 'success', details: { sheetName: sync.sheetName, attempts: sync.attempts } });
  for (const delivery of database.kitDeliveries.filter((item) => item.registrationId === registrationId)) events.push({ id: delivery.id, type: 'kit.delivered', title: 'Kit entregue', occurredAt: delivery.deliveredAt, actor: delivery.deliveredBy, origin: 'admin', severity: 'success', details: { notes: delivery.notes } });
  for (const checkIn of database.checkIns.filter((item) => item.registrationId === registrationId)) events.push({ id: checkIn.id, type: 'check_in.completed', title: 'Check-in realizado', occurredAt: checkIn.checkedInAt, actor: checkIn.checkedInBy, origin: 'admin', severity: 'success', details: { notes: checkIn.notes } });
  for (const audit of database.auditLogs.filter((item) => item.entityId === registrationId)) events.push({ id: audit.id, type: audit.action, title: audit.action, occurredAt: audit.createdAt, actor: audit.actor, origin: audit.ipAddress ? 'admin' : 'system', severity: /fail|error|mismatch/i.test(audit.action) ? 'critical' : 'info', details: { ...audit.payload as Record<string, unknown>, ipAddress: audit.ipAddress, userAgent: audit.userAgent, sessionId: audit.sessionId } });
  return events.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}
