export const MARKETING_CONSENT_SYNC_STORAGE_KEY = 'funpace-marketing-consent-sync-v1';
export const MARKETING_CONSENT_SYNC_VERSION = 1;
export const MARKETING_CONSENT_SYNC_DELAYS_MS = [0, 1_000, 5_000, 15_000] as const;

export type MarketingConsentSyncStatus = 'idle' | 'pending' | 'syncing' | 'synced' | 'error';

export type MarketingConsentSyncRecord = {
  version: typeof MARKETING_CONSENT_SYNC_VERSION;
  target: boolean;
  consentUpdatedAt: string;
  status: Exclude<MarketingConsentSyncStatus, 'idle'>;
  attempt: number;
  updatedAt: string;
  lastError?: string;
};

export type MarketingConsentSyncSnapshot = {
  status: MarketingConsentSyncStatus;
  target: boolean | null;
  attempt: number;
  lastError: string | null;
};

type SyncStorage = Pick<Storage, 'getItem' | 'setItem'>;

const IDLE_SNAPSHOT: MarketingConsentSyncSnapshot = Object.freeze({
  status: 'idle', target: null, attempt: 0, lastError: null,
});
const listeners = new Set<() => void>();
let cachedRecord: MarketingConsentSyncRecord | null | undefined;
let cachedSnapshot: MarketingConsentSyncSnapshot | undefined;
let activeSync: Promise<MarketingConsentSyncRecord | null> | null = null;
let resumedErrorKey = '';

function storage(): SyncStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try { return window.localStorage; } catch { return undefined; }
}

function validRecord(value: unknown): value is MarketingConsentSyncRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<MarketingConsentSyncRecord>;
  return record.version === MARKETING_CONSENT_SYNC_VERSION
    && typeof record.target === 'boolean'
    && typeof record.consentUpdatedAt === 'string'
    && !Number.isNaN(Date.parse(record.consentUpdatedAt))
    && ['pending', 'syncing', 'synced', 'error'].includes(record.status || '')
    && Number.isInteger(record.attempt)
    && Number(record.attempt) >= 0
    && typeof record.updatedAt === 'string';
}

export function readMarketingConsentSyncRecord(targetStorage: SyncStorage | undefined = storage()) {
  if (!targetStorage) return null;
  try {
    const raw = targetStorage.getItem(MARKETING_CONSENT_SYNC_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return validRecord(parsed) ? parsed : null;
  } catch { return null; }
}

function publish(record: MarketingConsentSyncRecord, targetStorage: SyncStorage | undefined = storage()) {
  cachedRecord = record;
  cachedSnapshot = undefined;
  try { targetStorage?.setItem(MARKETING_CONSENT_SYNC_STORAGE_KEY, JSON.stringify(record)); } catch {
    // The explicit in-memory state remains available when persistent storage is unavailable.
  }
  listeners.forEach((listener) => listener());
  return record;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 180);
  return 'Falha ao sincronizar consentimento com o servidor.';
}

export async function runMarketingConsentSync(
  initial: MarketingConsentSyncRecord,
  dependencies: {
    transport: (target: boolean) => Promise<unknown>;
    persist: (record: MarketingConsentSyncRecord) => void;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => string;
    delays?: readonly number[];
  },
) {
  const delays = dependencies.delays || MARKETING_CONSENT_SYNC_DELAYS_MS;
  const sleep = dependencies.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = dependencies.now || (() => new Date().toISOString());
  let current = initial;

  for (let index = 0; index < delays.length; index += 1) {
    if (delays[index] > 0) await sleep(delays[index]);
    current = { ...current, status: 'syncing', attempt: index + 1, updatedAt: now(), lastError: undefined };
    dependencies.persist(current);
    try {
      await dependencies.transport(current.target);
      current = { ...current, status: 'synced', updatedAt: now(), lastError: undefined };
      dependencies.persist(current);
      return current;
    } catch (error) {
      current = {
        ...current,
        status: index === delays.length - 1 ? 'error' : 'pending',
        updatedAt: now(),
        lastError: errorMessage(error),
      };
      dependencies.persist(current);
    }
  }
  return current;
}

function ensureRecord(target: boolean, consentUpdatedAt: string) {
  const existing = readMarketingConsentSyncRecord();
  if (existing?.target === target && existing.consentUpdatedAt === consentUpdatedAt) return existing;
  return publish({
    version: MARKETING_CONSENT_SYNC_VERSION,
    target,
    consentUpdatedAt,
    status: 'pending',
    attempt: 0,
    updatedAt: new Date().toISOString(),
  });
}

function start(record: MarketingConsentSyncRecord) {
  if (activeSync) {
    return activeSync.then(() => {
      const latest = readMarketingConsentSyncRecord() || cachedRecord;
      if (!latest || latest.status === 'synced') return latest || null;
      return start(latest);
    });
  }
  activeSync = runMarketingConsentSync(record, {
    transport: async (target) => {
      const { updateMarketingConsent } = await import('./api');
      return updateMarketingConsent(target);
    },
    persist: (next) => {
      const latest = readMarketingConsentSyncRecord() || cachedRecord;
      const superseded = latest
        && (latest.target !== record.target || latest.consentUpdatedAt !== record.consentUpdatedAt);
      if (!superseded) publish(next);
    },
  }).finally(() => { activeSync = null; });
  return activeSync;
}

export function synchronizeMarketingConsent(target: boolean, consentUpdatedAt: string) {
  const record = ensureRecord(target, consentUpdatedAt);
  if (record.status === 'synced') return Promise.resolve(record);
  if (record.status === 'error') {
    const key = `${record.target}:${record.consentUpdatedAt}`;
    if (resumedErrorKey === key) return Promise.resolve(record);
    resumedErrorKey = key;
    return start(publish({ ...record, status: 'pending', attempt: 0, updatedAt: new Date().toISOString() }));
  }
  return start(record);
}

export function retryMarketingConsentSync() {
  const record = readMarketingConsentSyncRecord();
  if (!record) return Promise.resolve(null);
  resumedErrorKey = '';
  return start(publish({ ...record, status: 'pending', attempt: 0, updatedAt: new Date().toISOString(), lastError: undefined }));
}

export function getMarketingConsentSyncSnapshot(): MarketingConsentSyncSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  if (cachedRecord === undefined) cachedRecord = readMarketingConsentSyncRecord();
  if (!cachedRecord) return IDLE_SNAPSHOT;
  cachedSnapshot = {
    status: cachedRecord.status,
    target: cachedRecord.target,
    attempt: cachedRecord.attempt,
    lastError: cachedRecord.lastError || null,
  };
  return cachedSnapshot;
}

export function getServerMarketingConsentSyncSnapshot() { return IDLE_SNAPSHOT; }

export function subscribeMarketingConsentSync(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== MARKETING_CONSENT_SYNC_STORAGE_KEY && event.key !== null) return;
    cachedRecord = readMarketingConsentSyncRecord();
    cachedSnapshot = undefined;
    listener();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}
