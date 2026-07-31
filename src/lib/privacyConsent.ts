export const PRIVACY_CONSENT_STORAGE_KEY = 'funpace-privacy-consent-v1';
export const LEGACY_MARKETING_CONSENT_KEY = 'funpace-marketing-consent';
export const PRIVACY_CONSENT_VERSION = 1;

export type OptionalConsentCategory = 'statistics' | 'marketing';
export type ConsentCategory = 'necessary' | OptionalConsentCategory;

export type PrivacyConsentPreferences = {
  necessary: true;
  statistics: boolean;
  marketing: boolean;
};

export type PrivacyConsentRecord = {
  version: typeof PRIVACY_CONSENT_VERSION;
  preferences: PrivacyConsentPreferences;
  decidedAt: string;
  updatedAt: string;
};

export type PrivacyConsentSnapshot = {
  hasDecision: boolean;
  preferences: PrivacyConsentPreferences;
  decidedAt: string | null;
  updatedAt: string | null;
};

export type ConsentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const DEFAULT_PREFERENCES: PrivacyConsentPreferences = Object.freeze({
  necessary: true,
  statistics: false,
  marketing: false,
});

const DEFAULT_SNAPSHOT: PrivacyConsentSnapshot = Object.freeze({
  hasDecision: false,
  preferences: DEFAULT_PREFERENCES,
  decidedAt: null,
  updatedAt: null,
});

const listeners = new Set<() => void>();
let cachedSnapshot: PrivacyConsentSnapshot | null = null;

function getBrowserStorage(): ConsentStorage | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isValidRecord(value: unknown): value is PrivacyConsentRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PrivacyConsentRecord>;
  const preferences = record.preferences;

  return record.version === PRIVACY_CONSENT_VERSION
    && Boolean(preferences)
    && preferences?.necessary === true
    && typeof preferences.statistics === 'boolean'
    && typeof preferences.marketing === 'boolean'
    && isValidDate(record.decidedAt)
    && isValidDate(record.updatedAt);
}

function snapshotFromRecord(record: PrivacyConsentRecord): PrivacyConsentSnapshot {
  return {
    hasDecision: true,
    preferences: { ...record.preferences },
    decidedAt: record.decidedAt,
    updatedAt: record.updatedAt,
  };
}

function readStoredRecord(storage: ConsentStorage): PrivacyConsentRecord | null {
  try {
    const raw = storage.getItem(PRIVACY_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function migrateLegacyConsent(storage: ConsentStorage, now: string): PrivacyConsentRecord | null {
  try {
    const legacy = storage.getItem(LEGACY_MARKETING_CONSENT_KEY);
    if (legacy !== 'granted' && legacy !== 'denied') return null;

    const migrated = createPrivacyConsentRecord({
      statistics: false,
      marketing: legacy === 'granted',
    }, now);
    storage.setItem(PRIVACY_CONSENT_STORAGE_KEY, JSON.stringify(migrated));
    storage.removeItem(LEGACY_MARKETING_CONSENT_KEY);
    return migrated;
  } catch {
    return null;
  }
}

export function createPrivacyConsentRecord(
  preferences: Pick<PrivacyConsentPreferences, OptionalConsentCategory>,
  now = new Date().toISOString(),
  previous?: PrivacyConsentRecord | null,
): PrivacyConsentRecord {
  const decidedAt = previous?.decidedAt || now;
  return {
    version: PRIVACY_CONSENT_VERSION,
    preferences: {
      necessary: true,
      statistics: preferences.statistics === true,
      marketing: preferences.marketing === true,
    },
    decidedAt,
    updatedAt: now,
  };
}

export function readPrivacyConsent(
  storage: ConsentStorage | undefined = getBrowserStorage(),
  now = new Date().toISOString(),
): PrivacyConsentSnapshot {
  if (!storage) return DEFAULT_SNAPSHOT;

  const record = readStoredRecord(storage) || migrateLegacyConsent(storage, now);
  return record ? snapshotFromRecord(record) : DEFAULT_SNAPSHOT;
}

export function writePrivacyConsent(
  preferences: Pick<PrivacyConsentPreferences, OptionalConsentCategory>,
  storage: ConsentStorage | undefined = getBrowserStorage(),
  now = new Date().toISOString(),
): PrivacyConsentSnapshot {
  const previous = storage ? readStoredRecord(storage) : null;
  const record = createPrivacyConsentRecord(preferences, now, previous);

  if (storage) {
    try {
      storage.setItem(PRIVACY_CONSENT_STORAGE_KEY, JSON.stringify(record));
      storage.removeItem(LEGACY_MARKETING_CONSENT_KEY);
    } catch {
      // The in-memory snapshot still applies immediately when storage is unavailable.
    }
  }

  return snapshotFromRecord(record);
}

export function isMarketingConsentGranted(value: unknown): value is true {
  return value === true;
}

export function isConsentCategoryAllowed(
  snapshot: PrivacyConsentSnapshot,
  category: ConsentCategory,
) {
  return category === 'necessary'
    ? true
    : snapshot.hasDecision && snapshot.preferences[category] === true;
}

function emitConsentChange() {
  listeners.forEach((listener) => listener());
}

export function getPrivacyConsentSnapshot() {
  if (!cachedSnapshot) cachedSnapshot = readPrivacyConsent();
  return cachedSnapshot;
}

export function getServerPrivacyConsentSnapshot() {
  return DEFAULT_SNAPSHOT;
}

export function setPrivacyConsent(
  preferences: Pick<PrivacyConsentPreferences, OptionalConsentCategory>,
) {
  cachedSnapshot = writePrivacyConsent(preferences);
  emitConsentChange();
  return cachedSnapshot;
}

export function acceptAllPrivacyConsent() {
  return setPrivacyConsent({ statistics: true, marketing: true });
}

export function rejectOptionalPrivacyConsent() {
  return setPrivacyConsent({ statistics: false, marketing: false });
}

export function subscribePrivacyConsent(listener: () => void) {
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key !== PRIVACY_CONSENT_STORAGE_KEY
      && event.key !== LEGACY_MARKETING_CONSENT_KEY
      && event.key !== null
    ) {
      return;
    }
    cachedSnapshot = readPrivacyConsent();
    listener();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
  }

  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage);
    }
  };
}
