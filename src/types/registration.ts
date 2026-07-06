export type RaceDistance = '10K' | '5K';

export type ShirtSize = 'P' | 'M' | 'G' | 'GG';

export type Gender = 'female' | 'male';

export type AdminGender = Gender | '';

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

export type CreateRegistrationResponse = {
  success: boolean;
  registrationId: string;
  paymentId: string | null;
  registrationStatus: RegistrationStatus;
  checkoutStatus: CheckoutStatus;
  checkoutUrl: string | null;
  message: string;
  expiresAt?: string | null;
};

export type RegistrationStatusResponse = {
  registrationId: string;
  status: RegistrationStatus;
  paymentStatus?: RegistrationStatus;
  amountCents: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  paidAt?: string | null;
  confirmedAt?: string | null;
  gatewayStatus?: string | null;
  gatewayTransactionId?: string | null;
  pendingEmailSentAt?: string | null;
  confirmationEmailSentAt?: string | null;
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
    remaining: number;
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
  };
  byStatus: Record<string, number>;
  byDistance: Array<{
    id: string;
    name: RaceDistance;
    capacity: number;
    total: number;
    paid: number;
  }>;
  lots: Array<{
    id: string;
    name: string;
    capacity: number;
    soldCount: number;
    remaining: number;
    priceCents: number;
    status: string;
  }>;
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
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  paidAt: string | null;
  confirmedAt: string | null;
  gatewayStatus: string | null;
  gatewayTransactionId: string | null;
  paymentMethod: string | null;
  hasPaymentDivergence: boolean;
  pendingEmailSentAt?: string | null;
  confirmationEmailSentAt?: string | null;
  confirmationEmailProvider?: string | null;
  confirmationEmailId?: string | null;
  confirmationEmailError?: string | null;
};

export type AdminRegistrationsResponse = {
  registrations: AdminRegistration[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type AdminRegistrationActionResponse = {
  registration: AdminRegistration;
};

export type AdminRegistrationEditable = Pick<AdminRegistration, 'fullName' | 'email' | 'phone' | 'birthDate' | 'gender' | 'shirtSize' | 'emergencyContactName' | 'emergencyContactPhone' | 'city' | 'state' | 'team'>;
export type AdminRegistrationDetailsResponse = { registration: AdminRegistration; auditLogs: AdminAuditLog[]; paymentEvents: AdminPaymentEvent[] };

export type AdminPaymentEvent = { id: string; paymentId: string; providerEventId: string; eventType: string; payload: unknown; receivedAt: string };
export type AdminPaymentDetailsResponse = { payment: AdminRegistration; gatewayPayload: unknown; events: AdminPaymentEvent[] };

export type AdminAuditLog = {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  createdAt: string;
};

export type AdminAuditLogsResponse = {
  logs: AdminAuditLog[];
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
