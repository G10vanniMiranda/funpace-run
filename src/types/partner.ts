export type PartnerStatus = 'active' | 'inactive';

export type AdminPartner = {
  id: string;
  name: string;
  slug: string;
  discountPercentage: number;
  status: PartnerStatus;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PartnerInput = Pick<AdminPartner, 'name' | 'slug' | 'discountPercentage' | 'status' | 'description'>;
export type AdminPartnersResponse = { partners: AdminPartner[] };
export type AdminPartnerResponse = { partner: AdminPartner };
export type PartnerSlugAvailabilityResponse = { slug: string; available: boolean };

export type PublicPartnerContext = {
  id: string;
  name: string;
  slug: string;
  discountPercentage: number;
  discountAmountCents: number;
  originalPriceCents: number;
  finalPriceCents: number;
};

export type PublicPartnerSessionResponse = { partner: PublicPartnerContext | null };

export type PartnerDashboardFilters = {
  eventId?: string;
  dateFrom?: string;
  dateTo?: string;
  paymentStatus?: string;
  partnerId?: string;
  city?: string;
};

export type PartnerMetricPoint = {
  label: string;
  registrations: number;
  grossRevenueCents: number;
  discountAmountCents: number;
  netRevenueCents: number;
  sharePercentage?: number;
};

export type PartnerRankingItem = PartnerMetricPoint & {
  partnerId: string;
  name: string;
  slug: string;
  status: PartnerStatus;
  paidRegistrations: number;
  averageTicketCents: number;
};

export type AdminPartnerDashboardResponse = {
  generatedAt: string;
  summary: {
    totalPartners: number;
    totalRegistrations: number;
    paidRegistrations: number;
    grossRevenueCents: number;
    discountAmountCents: number;
    netRevenueCents: number;
    averageTicketCents: number;
    leader: { partnerId: string; name: string; registrations: number } | null;
    conversionRate: number;
    conversionDefinition: string;
  };
  ranking: PartnerRankingItem[];
  rankingPagination: { page: number; pageSize: number; total: number; totalPages: number };
  charts: {
    monthly: PartnerMetricPoint[];
    comparison: PartnerRankingItem[];
  };
  indicators: {
    leader: PartnerRankingItem | null;
    withoutRegistrations: Array<{ partnerId: string; name: string }>;
    inactive: Array<{ partnerId: string; name: string }>;
    fastestGrowing: Array<{ partnerId: string; name: string; current: number; previous: number; changePercentage: number }>;
    declining: Array<{ partnerId: string; name: string; current: number; previous: number; changePercentage: number }>;
  };
  options: {
    events: Array<{ id: string; name: string }>;
    partners: Array<{ id: string; name: string }>;
    cities: string[];
    paymentStatuses: string[];
  };
};

export type PartnerRegistrationItem = {
  id: string;
  athleteName: string;
  eventName: string;
  city: string;
  createdAt: string;
  originalPriceCents: number;
  discountAmountCents: number;
  finalPriceCents: number;
  paymentStatus: string;
};

export type AdminPartnerDetailResponse = {
  generatedAt: string;
  partner: AdminPartner;
  metrics: {
    registrations: number;
    paidRegistrations: number;
    grossRevenueCents: number;
    discountAmountCents: number;
    netRevenueCents: number;
    averageTicketCents: number;
    lastRegistrationAt: string | null;
  };
  monthly: PartnerMetricPoint[];
  registrations: PartnerRegistrationItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type PartnerAuditLog = {
  id: string; partnerId: string | null; partnerName: string | null; action: string; userId: string | null;
  registrationId: string | null; athleteName: string | null; eventId: string | null; eventName: string | null;
  oldData: unknown; newData: unknown; metadata: Record<string, unknown>; ipAddress: string | null; userAgent: string | null; createdAt: string;
};

export type PartnerAuditResponse = { logs: PartnerAuditLog[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };
export type PartnerMonitoringResponse = {
  generatedAt: string;
  totals: { accesses: number; started: number; completed: number; conversionRate: number; abandoned: number; abandonmentRate: number; failures: number };
  partners: Array<{ partnerId: string; name: string; status: PartnerStatus; accesses: number; started: number; completed: number; conversionRate: number; abandoned: number; abandonmentRate: number; failures: number }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
