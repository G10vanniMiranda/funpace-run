const META_COOKIE_NAMES = ['_fbp', '_fbc'] as const;
const COOKIE_EXPIRATION = 'Thu, 01 Jan 1970 00:00:00 GMT';

type CookieWriter = {
  cookie: string;
};

export type MetaCookieCleanupContext = {
  cookieWriter: CookieWriter;
  hostname: string;
  pathname: string;
};

function isIpAddress(hostname: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

export function getMetaCookieDomainCandidates(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!normalized || normalized === 'localhost' || isIpAddress(normalized)) return [];

  const labels = normalized.split('.').filter(Boolean);
  const domains = new Set<string>();

  for (let index = 0; index <= labels.length - 2; index += 1) {
    const suffix = labels.slice(index).join('.');
    domains.add(suffix);
    domains.add(`.${suffix}`);
  }

  return [...domains];
}

export function getMetaCookiePathCandidates(pathname: string) {
  const segments = pathname.split('/').filter(Boolean);
  const paths = new Set<string>(['/']);

  for (let index = 1; index <= segments.length; index += 1) {
    paths.add(`/${segments.slice(0, index).join('/')}`);
  }

  return [...paths];
}

function resolveBrowserContext(): MetaCookieCleanupContext | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;

  return {
    cookieWriter: document,
    hostname: window.location.hostname,
    pathname: window.location.pathname,
  };
}

export function clearMetaCookies(context: MetaCookieCleanupContext | null = resolveBrowserContext()) {
  if (!context) return false;

  const paths = getMetaCookiePathCandidates(context.pathname);
  const domains = getMetaCookieDomainCandidates(context.hostname);

  for (const name of META_COOKIE_NAMES) {
    for (const path of paths) {
      const base = `${name}=; Expires=${COOKIE_EXPIRATION}; Max-Age=0; Path=${path}; SameSite=Lax`;
      context.cookieWriter.cookie = base;

      for (const domain of domains) {
        context.cookieWriter.cookie = `${base}; Domain=${domain}`;
      }
    }
  }

  return true;
}
