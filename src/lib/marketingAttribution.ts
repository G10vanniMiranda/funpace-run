import type { MarketingAttributionTouch, RegistrationFormData } from '../types/registration';

export const MARKETING_ATTRIBUTION_STORAGE_KEY = 'funpace-attribution';
export const MARKETING_QUERY_PARAMETERS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid',
] as const;

export type CapturedMarketingAttribution = RegistrationFormData['attribution'] & { fbclid?: string };

function clean(value: string | null | undefined, maxLength = 180) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : '';
}

function hasMarketingParameters(params: URLSearchParams) {
  return MARKETING_QUERY_PARAMETERS.some((key) => Boolean(clean(params.get(key))));
}

function buildTouch(
  params: URLSearchParams,
  location: Pick<Location, 'href'>,
  documentRef: Pick<Document, 'referrer'>,
  capturedAt: string,
): MarketingAttributionTouch {
  return {
    utmSource: clean(params.get('utm_source'), 80),
    utmMedium: clean(params.get('utm_medium'), 80),
    utmCampaign: clean(params.get('utm_campaign'), 120),
    term: clean(params.get('utm_term'), 120),
    content: clean(params.get('utm_content'), 120),
    fbclid: clean(params.get('fbclid')),
    referrer: clean(documentRef.referrer, 300),
    landingPage: clean(location.href, 300),
    capturedAt,
  };
}

function legacyTouch(stored: CapturedMarketingAttribution | undefined, capturedAt: string) {
  if (!stored) return undefined;
  const touch: MarketingAttributionTouch = {
    utmSource: clean(stored.utmSource, 80),
    utmMedium: clean(stored.utmMedium, 80),
    utmCampaign: clean(stored.utmCampaign || stored.campaign, 120),
    term: clean(stored.term, 120),
    content: clean(stored.content, 120),
    fbclid: clean(stored.fbclid),
    referrer: clean(stored.referrer, 300),
    landingPage: clean(stored.landingPage, 300),
    capturedAt,
  };
  return Object.values(touch).some(Boolean) ? touch : undefined;
}

export function permittedMarketingQuery(search: string) {
  const source = new URLSearchParams(search);
  const target = new URLSearchParams();
  for (const key of MARKETING_QUERY_PARAMETERS) {
    const value = clean(source.get(key));
    if (value) target.set(key, value);
  }
  return target;
}

export function captureMarketingAttribution(
  location: Pick<Location, 'search' | 'href'>,
  documentRef: Pick<Document, 'referrer'>,
  targetStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  now: () => string = () => new Date().toISOString(),
): CapturedMarketingAttribution {
  let stored: CapturedMarketingAttribution | undefined;
  try {
    const previous = targetStorage.getItem(MARKETING_ATTRIBUTION_STORAGE_KEY);
    stored = previous ? JSON.parse(previous) as CapturedMarketingAttribution : undefined;
  } catch { targetStorage.removeItem(MARKETING_ATTRIBUTION_STORAGE_KEY); }
  const capturedAt = now();
  const params = new URLSearchParams(location.search);
  const currentTouch = buildTouch(params, location, documentRef, capturedAt);
  const priorTouch = legacyTouch(stored, capturedAt);
  const firstTouch = stored?.firstTouch || priorTouch || currentTouch;
  const lastTouch = hasMarketingParameters(params)
    ? currentTouch
    : stored?.lastTouch || priorTouch || currentTouch;
  const utmSource = clean(lastTouch.utmSource, 80);
  const utmMedium = clean(lastTouch.utmMedium, 80);
  const fbclid = clean(lastTouch.fbclid);
  const attribution: CapturedMarketingAttribution = {
    source: utmSource || (utmMedium.toLowerCase().includes('qr') ? 'qr-code' : ''),
    medium: utmMedium,
    campaign: clean(lastTouch.utmCampaign, 120),
    term: clean(lastTouch.term, 120),
    content: clean(lastTouch.content, 120),
    utmSource,
    utmMedium,
    utmCampaign: clean(lastTouch.utmCampaign, 120),
    referrer: clean(lastTouch.referrer, 300),
    landingPage: clean(lastTouch.landingPage, 300),
    ...(fbclid ? { fbclid } : {}),
    firstTouch,
    lastTouch,
  };
  targetStorage.setItem(MARKETING_ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
  return attribution;
}

export function captureCurrentMarketingAttribution() {
  return captureMarketingAttribution(window.location, document, window.sessionStorage);
}
