export type RaceDistance = '10K' | '5K';

export type ShirtSize = 'P' | 'M' | 'G' | 'GG';

export type Gender = 'female' | 'male';

export type AdminGender = Gender | '';

export type MarketingAttributionTouch = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  term?: string;
  content?: string;
  fbclid?: string;
  referrer?: string;
  landingPage?: string;
  capturedAt?: string;
};

export type RegistrationFormData = {
  fullName: string;
  email: string;
  cpf: string;
  phone: string;
  city: string;
  state: string;
  team: string;
  birthDate: string;
  gender: Gender | '';
  shirtSize: ShirtSize;
  distance: RaceDistance;
  emergencyContactName: string;
  emergencyContactPhone: string;
  termsAccepted: boolean;
  regulationAccepted: boolean;
  privacyAccepted: boolean;
  partnerBenefitRequested?: boolean;
  checkoutRequested?: boolean;
  couponCode?: string;
  meta?: {
    initiatedAt?: number;
    fbp?: string;
    fbc?: string;
    fbclid?: string;
    sourceUrl?: string;
    marketingConsent?: boolean;
  };
  attribution?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    referrer?: string;
    landingPage?: string;
    fbclid?: string;
    firstTouch?: MarketingAttributionTouch;
    lastTouch?: MarketingAttributionTouch;
  };
};

export type RegistrationErrors = Partial<Record<keyof RegistrationFormData, string>>;

export type RegistrationStatus =
  | 'pending_payment'
  | 'paid'
  | 'payment_failed'
  | 'expired'
  | 'cancelled'
  | 'refunded';

export type CheckoutStatus = 'not_configured' | 'created';

export type RegistrationPartnerPricing = {
  name: string;
  partnerType: import('./partner').PartnerType;
  discountPercentage: number;
  discountAmountCents: number;
  originalPriceCents: number;
  finalPriceCents: number;
};

export type RegistrationCouponPricing = {
  code: string;
  discountPercentage: number;
  discountAmountCents: number;
  originalPriceCents: number;
  finalPriceCents: number;
  appliedAt?: string | null;
  usedAt?: string | null;
};

export type CouponValidationResponse = RegistrationCouponPricing;

export type CreateRegistrationResponse = {
  success: boolean;
  registrationId: string;
  paymentId: string | null;
  registrationStatus: RegistrationStatus;
  checkoutStatus: CheckoutStatus;
  checkoutUrl: string | null;
  checkoutEnabled?: boolean;
  checkoutSimulated?: false;
  paymentProviderCalled?: boolean;
  completeRegistrationEventId?: string | null;
  attemptId?: string | null;
  message: string;
  expiresAt?: string | null;
  partner?: RegistrationPartnerPricing | null;
  coupon?: RegistrationCouponPricing | null;
};

export type RegistrationStatusResponse = {
  registrationId: string;
  eventId: string;
  eventName: string;
  status: RegistrationStatus;
  paymentStatus?: RegistrationStatus;
  amountCents: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  paidAt?: string | null;
  confirmedAt?: string | null;
  partner?: RegistrationPartnerPricing | null;
  coupon?: RegistrationCouponPricing | null;
  gatewayStatus?: string | null;
  gatewayTransactionId?: string | null;
  confirmationEmailSentAt?: string | null;
  metaPurchaseEligible: boolean;
};

export type AvailabilityResponse = {
  event: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
  lots: Array<{
    id: string;
    name: string;
    priceCents: number;
    capacity: number;
    soldCount: number;
    confirmed: number;
    temporaryReservations: number;
    occupied: number;
    remaining: number;
    available: number;
    status: string;
  }>;
  distances: Array<{
    id: string;
    name: RaceDistance;
    capacity: number;
    soldCount: number;
    remaining: number;
    status: string;
  }>;
};

export type AdminSummaryResponse = {
  totals: {
    registrations: number;
    paid: number;
    pending: number;
    revenueCents: number;
    checkIns: number;
    kitDeliveries: number;
    paidWithoutEmail: number;
    manualReconciledPayments: number;
    confirmationEmailsSent: number;
    confirmationEmailsFailed: number;
    confirmationEmailsAttention: number;
    todayRegistrations: number;
    weekRegistrations: number;
    todayRevenueCents: number;
  };
  byStatus: Record<string, number>;
  byDistance: Array<{
    id: string;
    name: RaceDistance;
    capacity: number;
    total: number;
    paid: number;
    pending: number;
  }>;
  lots: Array<{
    id: string;
    name: string;
    capacity: number;
    soldCount: number;
    confirmed: number;
    temporaryReservations: number;
    occupied: number;
    remaining: number;
    available: number;
    priceCents: number;
    status: string;
  }>;
  shirtSizes: Array<{ size: string; total: number }>;
  daily: Array<{ label: string; count: number; amountCents: number }>;
};

export type AdminRegistration = {
  id: string;
  fullName: string;
  email: string;
  cpfMasked: string;
  phone: string;
  birthDate: string;
  age: number | null;
  gender: AdminGender;
  emergencyContactName: string;
  emergencyContactPhone: string;
  city: string | null;
  state: string | null;
  team: string | null;
  bibNumber: string | null;
  checkInStatus: 'not_started' | 'checked_in';
  checkInAt: string | null;
  checkInBy: string | null;
  kitStatus: 'not_delivered' | 'delivered';
  kitDeliveredAt: string | null;
  kitDeliveredBy: string | null;
  distance: string;
  distanceId: string;
  lot: string;
  lotId: string;
  shirtSize: string;
  status: RegistrationStatus;
  paymentStatus: RegistrationStatus;
  paymentProvider: string | null;
  providerPaymentId: string | null;
  amountCents: number;
  partnerId?: string | null;
  partnerName?: string | null;
  partnerType?: import('./partner').PartnerType | null;
  partnerLink?: string | null;
  partnerIdentifiedAt?: string | null;
  discountPercentage?: number;
  discountAmountCents?: number;
  originalPriceCents?: number;
  finalPriceCents?: number;
  couponCode?: string | null;
  couponAppliedAt?: string | null;
  couponUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  paidAt: string | null;
  confirmedAt: string | null;
  gatewayStatus: string | null;
  gatewayTransactionId: string | null;
  paymentMethod: string | null;
  hasPaymentDivergence: boolean;
  googleSheetsStatus: 'not_queued' | 'pending' | 'processing' | 'synchronized' | 'failed';
  googleSheetsSynchronizedAt: string | null;
  confirmationEmailSentAt?: string | null;
  confirmationEmailProvider?: string | null;
  confirmationEmailId?: string | null;
  confirmationEmailError?: string | null;
};

export type AdminRegistrationsResponse = {
  registrations: AdminRegistration[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
export type RemarketingCampaignMetrics = {
  campaign: 'whatsapp_remarketing_volta10';
  source: 'whatsapp';
  eligible: number;
  currentlyEligible: number;
  messagesSent: number;
  checkoutReturns: number;
  couponApplied: number;
  paymentsConfirmed: number;
  recoveredRevenueCents: number;
  totalDiscountCents: number;
  conversionRate: number;
};
export type AdminGoogleSheetsStatus = {
  enabled: boolean;
  configured: boolean;
  configurationIssue: string | null;
  counts: { pending: number; processing: number; synchronized: number; failed: number };
  lastSynchronizedAt: string | null;
  backlog?: {
    oldestPendingAt: string | null;
    oldestProcessingAt: string | null;
    staleProcessing: number;
    permanentFailures: number;
    retryableFailures: number;
  };
  remarketing?: {
    totalLeads: number;
    eligible: number;
    suppressedPaid: number;
    suppressedTest: number;
    suppressedAdminCancelled: number;
    failedSyncs: number;
    backlog: number;
    oldestEventAt: string | null;
    volta10Campaign?: RemarketingCampaignMetrics;
  };
};
export type AdminReconciliationDashboard = {
  runs: Array<{
    id: string; triggerSource: string; mode: 'dry_run' | 'apply'; status: string;
    checkedCount: number; correctedCount: number; manualReviewCount: number; errorCount: number;
    summary: Record<string, unknown>; startedAt: string; completedAt: string | null; createdBy: string;
  }>;
  issues: Array<{
    id: string; issueKey: string; issueCode: string; severity: 'info' | 'warning' | 'critical';
    resolutionStatus: 'consistent' | 'automatically_corrected' | 'manual_review_required' | 'resolved';
    registrationId: string | null; paymentId: string | null; details: Record<string, unknown>;
    firstDetectedAt: string; lastDetectedAt: string; resolvedAt: string | null; resolutionNotes: string | null;
  }>;
};
export type AdminOperationResponse = { registrations: AdminRegistration[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; totals: { paid: number; kitPending: number; checkInPending: number; completed: number } };
export type AdminEventConfig = {
  event: { id: string; name: string; slug: string; status: string; date: string; startTime: string; locationName: string; city: string; state: string };
  distances: Array<{ id: string; eventId: string; name: string; distanceKm: number; capacity: number; status: string }>;
  lots: Array<{ id: string; eventId: string; name: string; priceCents: number; capacity: number; soldCount: number; status: string; startsAt: string; endsAt: string }>;
  health: {
    database: { ok: boolean; provider: string; issue?: string };
    email: { configured: boolean; enabled: boolean; provider: string };
    gateway: { configured: boolean; provider: string; handle: string | null };
    sales: {
      eventStatus: string;
      registrationAvailability: 'available' | 'scheduled' | 'closed';
      activeLotId: string | null;
      activeLotName: string | null;
      activeDistances: number;
      availableDistances: number;
    };
  };
};

export type AdminSystemCheckResponse = {
  ok: boolean;
  target: 'email' | 'gateway';
  summary: string;
  checks: Array<{ label: string; ok: boolean; detail: string }>;
};

export type AdminRegistrationActionResponse = {
  registration: AdminRegistration;
  message?: string;
};

export type AdminRegistrationEditable = Pick<AdminRegistration, 'fullName' | 'email' | 'phone' | 'birthDate' | 'gender' | 'shirtSize' | 'emergencyContactName' | 'emergencyContactPhone' | 'city' | 'state' | 'team'>;
export type AdminTimelineEvent = { id: string; type: string; title: string; occurredAt: string; actor: string; origin: string; severity: 'info' | 'success' | 'warning' | 'critical'; details: Record<string, unknown> };
export type AdminRegistrationDetailsResponse = {
  registration: AdminRegistration;
  auditLogs: AdminAuditLog[];
  paymentEvents: AdminPaymentEvent[];
  timeline: AdminTimelineEvent[];
  partnerAuditLogs: Array<{ id: string; partnerId: string | null; partnerName: string | null; action: string; userId: string | null; registrationId: string | null; eventId: string | null; oldData: unknown; newData: unknown; metadata: Record<string, unknown>; ipAddress: string | null; userAgent: string | null; createdAt: string }>;
  partnerHistory: { partnerId: string; partnerName: string; partnerType: import('./partner').PartnerType; partnerLink: string; discountPercentage: number; identifiedAt: string; paidAt: string | null; responsibleUser: string | null } | null;
};

export type AdminOperationalAlert = {
  id: string; dedupeKey: string; severity: 'info' | 'warning' | 'critical'; alertType: string;
  title: string; message: string; entityType: string | null; entityId: string | null;
  payload: Record<string, unknown>; status: 'open' | 'acknowledged' | 'resolved'; detectedAt: string;
  acknowledgedAt: string | null; acknowledgedBy: string | null; resolvedAt: string | null;
};
export type AdminAlertsResponse = { alerts: AdminOperationalAlert[]; totals: { open: number; acknowledged: number; resolved: number; critical: number } };

export type DashboardChartPoint = { label: string; count: number; amountCents: number };
export type AdminExecutiveDashboard = {
  generatedAt: string;
  financial: { grossRevenueCents: number; netRevenueCents: number; refundedCents: number; estimatedFeesCents: number; feeConfigurationAvailable: boolean; todayRevenueCents: number; weekRevenueCents: number; eventRevenueCents: number; averageTicketCents: number };
  registrations: { total: number; confirmed: number; pending: number; expired: number; cancelled: number; refunded: number; conversionRate: number };
  checkouts: { created: number; paid: number; conversionRate: number; abandonmentRate: number };
  lots: Array<{ id: string; name: string; priceCents: number; capacityTotal: number; confirmed: number; temporaryReservations: number; occupied: number; available: number; occupancyPercent: number; level: 'normal' | 'warning' | 'critical' | 'blocked' }>;
  charts: { daily: DashboardChartPoint[]; hourly: DashboardChartPoint[]; cumulativeRevenue: DashboardChartPoint[]; byLot: DashboardChartPoint[]; byDistance: DashboardChartPoint[]; byCity: DashboardChartPoint[]; byGender: DashboardChartPoint[] };
  marketing: { sources: Array<DashboardChartPoint & { total: number; paid: number; conversionRate: number; cpaCents: number | null }>; campaigns: DashboardChartPoint[]; topSource: string };
  athletes: { byCity: DashboardChartPoint[]; byState: DashboardChartPoint[]; byGender: DashboardChartPoint[]; byDistance: DashboardChartPoint[]; byShirt: DashboardChartPoint[]; byLot: DashboardChartPoint[]; byAge: DashboardChartPoint[] };
  recent: { payments: Array<{ id: string; registrationId: string; amountCents: number; paidAt?: string | null; updatedAt: string; gatewayStatus?: string | null }>; confirmations: Array<{ id: string; confirmedAt?: string | null; amountCents: number }>; webhooks: AdminPaymentEvent[] };
  alerts: { active: number; critical: number; recent: AdminOperationalAlert[] };
  reconciliation: { manualReviewRequired: number; lastRun: AdminReconciliationDashboard['runs'][number] | null };
};

export type AdminMonitoringResponse = {
  generatedAt: string;
  services: Array<{ id: string; label: string; status: 'operational' | 'configured' | 'degraded' | 'down' | 'disabled' | 'local'; latencyMs: number | null; detail: string }>;
  metrics: { responseTimeMs: number; databaseQueryMs: number; memoryUsedMb: number; memoryRssMb: number; cpuUserMs: number; cpuSystemMs: number; uptimeSeconds: number; errors: number; webhooks: number; payments: number; emailsSent: number };
};

export type AdminPaymentEvent = { id: string; paymentId: string; providerEventId: string; eventType: string; payload: unknown; receivedAt: string };
export type AdminPaymentDetailsResponse = { payment: AdminRegistration; gatewayPayload: unknown; events: AdminPaymentEvent[] };
export type AdminPaymentsResponse = { payments: AdminRegistration[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; orphanEvents: AdminPaymentEvent[] };

export type AdminAuditLog = {
  id: string;
  actor: string;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
};

export type AdminAuditLogsResponse = {
  logs: AdminAuditLog[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type PartnershipLeadStatus =
  | 'new'
  | 'contacted'
  | 'negotiating'
  | 'approved'
  | 'rejected';

export type PartnershipLeadRequest = {
  companyName: string;
  contactName: string;
  contactRole: string;
  corporateEmail: string;
  involvementMessage: string;
  website?: string;
};

export type PartnershipLeadResponse = {
  id: string;
  message: string;
};

export type AdminPartnershipLead = {
  id: string;
  companyName: string;
  contactName: string;
  contactRole: string;
  corporateEmail: string;
  involvementMessage: string;
  status: PartnershipLeadStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminPartnershipsResponse = {
  partnerships: AdminPartnershipLead[];
};

export type AdminPartnershipActionResponse = {
  partnership: AdminPartnershipLead;
};
