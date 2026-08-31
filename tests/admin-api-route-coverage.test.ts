import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

// ADMIN-UX-HOTFIX-002 — every Admin route registered by handleApiRequest must
// resolve to a concrete Vercel filesystem function.
//
// Proven in Production (Stage 2): the `api/admin/[...path].ts` catch-all is only
// routed ONE segment deep on this deployment. Any `/api/admin/<a>/<b>[/...]`
// route with no explicit function file returns a bare Vercel
// `x-vercel-error: NOT_FOUND` and never reaches the server. Depth-1 admin routes
// (`/api/admin/<a>`) are still served by the catch-all.

const serverIndex = readFileSync('server/index.ts', 'utf8');

// ---- 1. derive the canonical Admin route inventory from server/index.ts ----
type RouteSegs = string[]; // segments after '/api/admin/'; ':dyn' for a dynamic/enum segment

function normalizeServerSegments(rawAfterAdmin: string): RouteSegs {
  // rawAfterAdmin like: "lots/([^/]+)", "registrations/([^/]+)/(cancel|send-email)",
  // or "payments/([^/]+)(?:/(reconcile))?".
  return rawAfterAdmin
    .replace(/\(\?:[^)]*\)\??/g, '')      // drop `(?:...)?` optional groups
    .replace(/\(\[\^\/\]\+\)/g, 'DYNSEG') // `([^/]+)` capture -> one dynamic segment
    .replace(/\([A-Za-z0-9|_-]+\)/g, 'DYNSEG') // `(cancel|send-email|kit)` enum -> one dynamic segment
    .replace(/\$$/, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg === 'DYNSEG' ? ':dyn' : seg));
}

const staticRoutes = [...serverIndex.matchAll(/url\.pathname === '\/api\/admin\/([^']+)'/g)]
  .map((m) => normalizeServerSegments(m[1]));

// dynamic: `url.pathname.match(/^\/api\/admin\/<...>\/?)` — the inner route regex
// contains ')' so capture the whole `.match(/ ... /)` body then trim.
const dynamicRoutes = serverIndex
  .split('\n')
  .filter((line) => line.includes('.pathname.match(') && /\\\/api\\\/admin\\\//.test(line))
  .map((line) => {
    const body = line.match(/\.pathname\.match\(\/\^(.+?)\/\)/);
    if (!body) return null;
    // body[1] like: \/api\/admin\/registrations\/([^/]+)\/(cancel|send-email|undo-check-in|undo-kit)$
    const path = body[1].replace(/\\\//g, '/').replace(/\$$/, '');
    const afterAdmin = path.replace(/^\/api\/admin\//, '');
    return normalizeServerSegments(afterAdmin);
  })
  .filter((v): v is RouteSegs => Array.isArray(v));

const allRoutes: RouteSegs[] = [...staticRoutes, ...dynamicRoutes];

// nested = 2+ segments after /api/admin/  (depth-1 is served by the catch-all)
const nestedRoutes = allRoutes.filter((segs) => segs.length >= 2);

// ---- 2. enumerate the api/admin/** filesystem functions ----
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const fnFiles = walk('api/admin').map((p) => relative('api/admin', p).replace(/\\/g, '/'));
// file "lots/[id].ts" -> ['lots', ':dyn'] ; "[...path].ts" -> ['CATCHALL']
const fnSegs: RouteSegs[] = fnFiles.map((f) =>
  f.replace(/\.ts$/, '').split('/').map((s) => (s.startsWith('[...') ? 'CATCHALL' : s.startsWith('[') ? ':dyn' : s)),
);

function fileCovers(fileSegs: RouteSegs, routeSegs: RouteSegs): boolean {
  if (fileSegs.length === 1 && fileSegs[0] === 'CATCHALL') return false; // depth-limited; not for nested
  if (fileSegs.length !== routeSegs.length) return false;
  // a position matches unless both sides are DIFFERENT literals
  return fileSegs.every((fs, i) => fs === ':dyn' || routeSegs[i] === ':dyn' || fs === routeSegs[i]);
}

// ---- 3. assertions ----
test('every registered Admin route was parsed (sanity)', () => {
  assert.ok(staticRoutes.length >= 30, `parsed ${staticRoutes.length} static admin routes`);
  assert.ok(dynamicRoutes.length >= 10, `parsed ${dynamicRoutes.length} dynamic admin routes`);
  // spot-check the EVENT-OPS blocker + the email + profile-edit routes are inventoried
  assert.ok(nestedRoutes.some((s) => s[0] === 'lots' && s[1] === ':dyn' && s.length === 2), 'lots/:id inventoried');
  assert.ok(nestedRoutes.some((s) => s[0] === 'registrations' && s[1] === ':dyn' && s.length === 2), 'registrations/:id inventoried');
  assert.ok(nestedRoutes.some((s) => s[0] === 'registrations' && s[1] === ':dyn' && s[2] === ':dyn'), 'registrations/:id/:action inventoried');
});

test('§8 route-shape coverage: the specific routes named in the mission are covered', () => {
  const shapes = [
    ['lots', ':dyn'], ['distances', ':dyn'], ['alerts', ':dyn'],
    ['registrations', ':dyn'], ['registrations', ':dyn', ':dyn'],
    ['payments', ':dyn'], ['payments', ':dyn', 'reconcile'],
    ['payment-events', ':dyn', 'link'],
    ['partner-dashboard', ':dyn'], ['partnerships', ':dyn', 'status'],
    ['google-sheets', ':dyn'], ['system-checks', ':dyn'],
    ['reconciliation', 'run'], ['partner-consistency', 'run'],
    ['partner-dashboard', 'export'], ['reports', 'export'], ['integrations', 'meta', 'status'],
  ];
  const missing = shapes.filter((sh) => !fnSegs.some((fs) => fileCovers(fs, sh)));
  assert.deepEqual(missing.map((s) => '/api/admin/' + s.join('/')), []);
});

test('the catch-all is retained (depth-1 admin routes still served)', () => {
  assert.ok(fnFiles.includes('[...path].ts'), 'api/admin/[...path].ts kept');
  // and depth-1 routes are NOT required to have explicit files
  const depth1 = allRoutes.filter((s) => s.length === 1);
  assert.ok(depth1.length >= 10, `${depth1.length} depth-1 admin routes rely on the catch-all`);
});

test('prior partner route forwarders are preserved (no regression)', () => {
  for (const f of ['partners/[id].ts', 'partners/[id]/status.ts', 'partners/slug-availability.ts']) {
    assert.ok(fnFiles.includes(f), `api/admin/${f} present`);
  }
});

test('EVERY nested Admin route resolves to a concrete Vercel function file', () => {
  const uncovered = nestedRoutes.filter((route) => !fnSegs.some((fs) => fileCovers(fs, route)));
  const pretty = uncovered.map((s) => '/api/admin/' + s.join('/'));
  assert.deepEqual(pretty, [], `nested Admin routes with NO explicit Vercel function file:\n  ${pretty.join('\n  ')}`);
});

test('forwarders are thin adapters — no auth / validation / DB / business logic', () => {
  for (const f of fnFiles) {
    if (f === '[...path].ts') continue;
    const src = readFileSync(join('api/admin', f), 'utf8');
    assert.match(src, /return handleApiRequest\(req, res\)/, `${f} delegates to handleApiRequest`);
    assert.doesNotMatch(src, /requireAdmin|pg\.|Pool|createClient|\bquery\(|prisma|process\.env\.DATABASE/, `${f} has no auth/DB/business logic`);
  }
});
