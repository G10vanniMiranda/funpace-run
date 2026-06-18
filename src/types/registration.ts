export type RaceDistance = '10K' | '5K';

export type ShirtSize = 'P' | 'M' | 'G' | 'GG';

export type Gender = 'female' | 'male' | 'non_binary' | 'prefer_not_to_answer';

export type AdminGender = Gender | '';

export type RegistrationFormData = {
  fullName: string;
  email: string;
  cpf: string;
  phone: string;
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
  registrationId: string;
  registrationStatus: RegistrationStatus;
  checkoutStatus: CheckoutStatus;
  checkoutUrl: string | null;
  message: string;
  expiresAt?: string | null;
};

export type RegistrationStatusResponse = {
  registrationId: string;
  status: RegistrationStatus;
  amountCents: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
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
  amountCents: number;
  createdAt: string;
  expiresAt: string | null;
};

export type AdminRegistrationsResponse = {
  registrations: AdminRegistration[];
};

export type AdminRegistrationActionResponse = {
  registration: AdminRegistration;
};

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
