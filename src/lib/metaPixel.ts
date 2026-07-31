import {
  getPrivacyConsentSnapshot,
  isConsentCategoryAllowed,
  setPrivacyConsent,
} from './privacyConsent';
import { clearMetaCookies } from './metaCookies';

export type MetaPixelEventValue = string | number | boolean | string[] | undefined;
export type MetaPixelEventParams = Record<string, MetaPixelEventValue>;

export type MetaPixelEventOptions = {
  eventID?: string;
};

export type MetaBrowserContext = {
  initiatedAt: number;
  fbp?: string;
  fbc?: string;
  sourceUrl: string;
  marketingConsent: boolean;
};

type MetaPixelArguments =
  | ['init', string]
  | ['consent', 'grant' | 'revoke']
  | ['track', string, MetaPixelEventParams?, MetaPixelEventOptions?]
  | ['trackCustom', string, MetaPixelEventParams?, MetaPixelEventOptions?];

type MetaPixelFunction = {
  (...args: MetaPixelArguments): void;
  callMethod?: (...args: MetaPixelArguments) => void;
  queue: MetaPixelArguments[];
  push: MetaPixelFunction;
  loaded: boolean;
  version: string;
};

declare global {
  interface Window {
    fbq?: MetaPixelFunction;
    _fbq?: MetaPixelFunction;
  }
}

const META_PIXEL_SCRIPT_ID = 'meta-pixel-script';
const PURCHASE_STORAGE_PREFIX = 'meta_purchase_sent:';
const pixelId = (import.meta.env.VITE_META_PIXEL_ID || '').trim();
const initializedPixelIds = new Set<string>();
const sessionEvents = new Set<string>();
let lastPagePath = '';

function readCookieValue(name: string) {
  const prefix = `${name}=`;
  const entry = document.cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix));
  if (!entry) return undefined;

  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return undefined;
  }
}

function validMetaCookie(value: string | undefined, type: 'fbp' | 'fbc') {
  if (!value || value.length > 255) return undefined;
  const pattern = type === 'fbp'
    ? /^fb\.1\.\d{10,13}\.[A-Za-z0-9_-]{1,160}$/
    : /^fb\.1\.\d{10,13}\.[A-Za-z0-9._-]{1,180}$/;
  return pattern.test(value) ? value : undefined;
}

function getFbc() {
  const cookie = validMetaCookie(readCookieValue('_fbc'), 'fbc');
  if (cookie) return cookie;

  const fbclid = new URL(window.location.href).searchParams.get('fbclid')?.trim();
  if (!fbclid || fbclid.length > 180 || !/^[A-Za-z0-9._-]+$/.test(fbclid)) return undefined;
  return `fb.1.${Date.now()}.${fbclid}`;
}

export function getMetaBrowserContext(): MetaBrowserContext {
  const marketingConsent = hasMarketingConsent();
  const sourceUrl = marketingConsent
    ? window.location.href.slice(0, 500)
    : `${window.location.origin}${window.location.pathname}`.slice(0, 500);
  if (!marketingConsent) {
    return {
      initiatedAt: Math.floor(Date.now() / 1000),
      sourceUrl,
      marketingConsent: false,
    };
  }

  const fbp = validMetaCookie(readCookieValue('_fbp'), 'fbp');
  const fbc = getFbc();

  return {
    initiatedAt: Math.floor(Date.now() / 1000),
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {}),
    sourceUrl,
    marketingConsent: true,
  };
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function hasValidPixelId() {
  return /^\d+$/.test(pixelId);
}

function hasMarketingConsent() {
  return isConsentCategoryAllowed(getPrivacyConsentSnapshot(), 'marketing');
}

function createFbq(): MetaPixelFunction {
  const fbq = function (...args: MetaPixelArguments) {
    if (fbq.callMethod) {
      fbq.callMethod(...args);
      return;
    }
    fbq.queue.push(args);
  } as MetaPixelFunction;

  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  return fbq;
}

function sanitizeParams(params?: MetaPixelEventParams) {
  if (!params) return undefined;

  const validEntries = Object.entries(params).filter(([, value]) => (
    typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string'))
  ));

  return validEntries.length > 0 ? Object.fromEntries(validEntries) : undefined;
}

function normalizePath(pathname = window.location.pathname) {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

export function isMetaPixelConfigured() {
  return hasValidPixelId();
}

export function initializeMetaPixel() {
  if (!isBrowser() || !hasValidPixelId() || !hasMarketingConsent()) return false;

  if (!window.fbq) {
    window.fbq = createFbq();
    window._fbq = window.fbq;
  }

  if (!document.getElementById(META_PIXEL_SCRIPT_ID)) {
    const script = document.createElement('script');
    script.id = META_PIXEL_SCRIPT_ID;
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
  }

  if (!initializedPixelIds.has(pixelId)) {
    window.fbq('init', pixelId);
    initializedPixelIds.add(pixelId);
  }

  return true;
}

export function trackPageView(pathname?: string) {
  if (!initializeMetaPixel()) return false;

  const currentPath = normalizePath(pathname);
  if (currentPath === lastPagePath) return false;

  window.fbq?.('track', 'PageView');
  lastPagePath = currentPath;
  return true;
}

export function trackMetaEvent(
  eventName: string,
  params?: MetaPixelEventParams,
  options?: MetaPixelEventOptions,
) {
  const normalizedEventName = eventName.trim();
  if (!normalizedEventName || !initializeMetaPixel()) return false;

  window.fbq?.('track', normalizedEventName, sanitizeParams(params), options);
  return true;
}

export function trackCustomMetaEvent(
  eventName: string,
  params?: MetaPixelEventParams,
  options?: MetaPixelEventOptions,
) {
  const normalizedEventName = eventName.trim();
  if (!normalizedEventName || !initializeMetaPixel()) return false;

  window.fbq?.('trackCustom', normalizedEventName, sanitizeParams(params), options);
  return true;
}

export function trackMetaEventOnce(
  dedupeKey: string,
  eventName: string,
  params?: MetaPixelEventParams,
  options?: MetaPixelEventOptions,
) {
  if (!dedupeKey || sessionEvents.has(dedupeKey)) return false;
  if (!trackMetaEvent(eventName, params, options)) return false;

  sessionEvents.add(dedupeKey);
  return true;
}

export function trackMetaPurchase(orderId: string, params: MetaPixelEventParams) {
  const normalizedOrderId = orderId.trim();
  if (!normalizedOrderId || !isBrowser()) return false;

  const storageKey = `${PURCHASE_STORAGE_PREFIX}${normalizedOrderId}`;
  try {
    if (window.localStorage.getItem(storageKey) === 'sent') return false;
  } catch {
    if (sessionEvents.has(storageKey)) return false;
  }

  const tracked = trackMetaEvent(
    'Purchase',
    { ...params, order_id: normalizedOrderId },
    { eventID: `purchase_${normalizedOrderId}` },
  );
  if (!tracked) return false;

  sessionEvents.add(storageKey);
  try {
    window.localStorage.setItem(storageKey, 'sent');
  } catch {
    // The in-memory guard still protects this page when storage is unavailable.
  }
  return true;
}

export function setMetaPixelConsent(granted: boolean) {
  if (!isBrowser()) return;

  const current = getPrivacyConsentSnapshot();
  setPrivacyConsent({
    statistics: current.preferences.statistics,
    marketing: granted,
  });
  synchronizeMetaPixelConsent(granted);
}

export function synchronizeMetaPixelConsent(granted: boolean) {
  if (!isBrowser()) return false;
  if (!granted) {
    window.fbq?.('consent', 'revoke');
    document.getElementById(META_PIXEL_SCRIPT_ID)?.remove();
    delete window.fbq;
    delete window._fbq;
    clearMetaCookies();
    initializedPixelIds.delete(pixelId);
    lastPagePath = '';
    return true;
  }

  if (!initializeMetaPixel()) return false;
  window.fbq?.('consent', 'grant');
  trackPageView();
  return true;
}
