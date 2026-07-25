export type MetaPixelEventValue = string | number | boolean | string[] | undefined;
export type MetaPixelEventParams = Record<string, MetaPixelEventValue>;

type MetaPixelEventOptions = {
  eventID?: string;
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
const MARKETING_CONSENT_KEY = 'funpace-marketing-consent';
const PURCHASE_STORAGE_PREFIX = 'meta_purchase_sent:';
const pixelId = (import.meta.env.VITE_META_PIXEL_ID || '').trim();
const requiresConsent = import.meta.env.VITE_META_PIXEL_REQUIRE_CONSENT === 'true';
const initializedPixelIds = new Set<string>();
const sessionEvents = new Set<string>();
let lastPagePath = '';

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function hasValidPixelId() {
  return /^\d+$/.test(pixelId);
}

function hasMarketingConsent() {
  if (!requiresConsent) return true;

  try {
    return window.localStorage.getItem(MARKETING_CONSENT_KEY) === 'granted';
  } catch {
    return false;
  }
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
) {
  if (!dedupeKey || sessionEvents.has(dedupeKey)) return false;
  if (!trackMetaEvent(eventName, params)) return false;

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

  try {
    window.localStorage.setItem(MARKETING_CONSENT_KEY, granted ? 'granted' : 'denied');
  } catch {
    // Consent remains effective for the current page even without storage.
  }

  if (!granted) {
    window.fbq?.('consent', 'revoke');
    return;
  }

  initializeMetaPixel();
  window.fbq?.('consent', 'grant');
  trackPageView();
}
