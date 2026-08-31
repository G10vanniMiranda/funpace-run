// ADMIN-UX-HOTFIX-002 — no-auth Admin route SMOKE.
//
// Proves that Admin API route shapes REACH the application function on a
// deployed base URL. It does NOT authenticate and does NOT expect business
// success. `requireAdmin` rejects before any handler runs, so an unauthenticated
// request can never mutate.
//
//   PASS  = an application/server response (JSON body, ideally with `message`);
//           401 / 403 is a SUCCESSFUL routing proof.
//   FAIL  = a bare Vercel edge 404 (`x-vercel-error: NOT_FOUND`) — the request
//           never reached handleApiRequest.
//
// Usage: node scripts/verify-admin-routes.mjs https://www.funpace.club
//        node scripts/verify-admin-routes.mjs            # defaults to APP_URL / prod

const BASE = (process.argv[2] || process.env.SMOKE_BASE_URL || 'https://www.funpace.club').replace(/\/+$/, '');

// method, path, note. Path segments after an id use the literal `route-probe`
// (never a real id). Mutation routes are safe: requireAdmin 401s first.
const ROUTES = [
  ['GET', '/api/health', 'control: must be 200'],
  ['GET', '/api/admin/executive-dashboard', 'depth-1 (catch-all)'],
  ['PATCH', '/api/admin/lots/route-probe', 'EVENT-OPS-001 critical'],
  ['PATCH', '/api/admin/distances/route-probe', ''],
  ['PATCH', '/api/admin/alerts/route-probe', ''],
  ['GET', '/api/admin/registrations/route-probe', 'profile view'],
  ['PATCH', '/api/admin/registrations/route-probe', 'profile edit (Kemily class)'],
  ['POST', '/api/admin/registrations/route-probe/send-email', 'EMAIL-OPS class'],
  ['POST', '/api/admin/registrations/route-probe/cancel', ''],
  ['POST', '/api/admin/registrations/route-probe/check-in', ''],
  ['POST', '/api/admin/registrations/route-probe/kit', ''],
  ['POST', '/api/admin/registrations/route-probe/undo-check-in', ''],
  ['POST', '/api/admin/registrations/route-probe/undo-kit', ''],
  ['POST', '/api/admin/registrations/route-probe/bib-number', ''],
  ['POST', '/api/admin/registrations/route-probe/sync-google-sheets', ''],
  ['GET', '/api/admin/payments/route-probe', ''],
  ['POST', '/api/admin/payments/route-probe/reconcile', ''],
  ['POST', '/api/admin/payment-events/route-probe/link', ''],
  ['GET', '/api/admin/partner-dashboard/route-probe', ''],
  ['GET', '/api/admin/partner-dashboard/export', 'static depth-2'],
  ['POST', '/api/admin/partnerships/route-probe/status', ''],
  ['GET', '/api/admin/google-sheets/status', 'static depth-2'],
  ['GET', '/api/admin/google-sheets/check', ''],
  ['POST', '/api/admin/google-sheets/retry', ''],
  ['POST', '/api/admin/system-checks/email', ''],
  ['POST', '/api/admin/system-checks/gateway', ''],
  ['POST', '/api/admin/reconciliation/run', ''],
  ['POST', '/api/admin/partner-consistency/run', ''],
  ['GET', '/api/admin/integrations/meta/status', 'static depth-3'],
  ['GET', '/api/admin/reports/export', 'static depth-2'],
  // preserved partner routes (a3e589d)
  ['PATCH', '/api/admin/partners/route-probe', 'preserved'],
  ['POST', '/api/admin/partners/route-probe/status', 'preserved'],
];

let failures = 0;
const rows = [];
for (const [method, path, note] of ROUTES) {
  let status = 0;
  let vercelError = '';
  let vercelId = '';
  let bodySnippet = '';
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: method === 'GET' ? undefined : '{}',
      redirect: 'manual',
    });
    status = res.status;
    vercelError = res.headers.get('x-vercel-error') || '';
    vercelId = res.headers.get('x-vercel-id') || '';
    bodySnippet = (await res.text()).slice(0, 60).replace(/\s+/g, ' ');
  } catch (error) {
    bodySnippet = `FETCH_ERROR ${error instanceof Error ? error.message : String(error)}`;
  }

  const isHealth = path === '/api/health';
  const bareVercel404 = vercelError === 'NOT_FOUND';
  const reachedApp = !bareVercel404 && (
    isHealth
      ? status === 200
      : status === 401 || status === 403 || (status === 404 && bodySnippet.includes('message')) || (status >= 200 && status < 500)
  );
  const ok = reachedApp;
  if (!ok) failures += 1;
  rows.push({ ok, method, path, status, vercelError: vercelError || '-', reachedApp, note });
}

console.log(`\nADMIN ROUTE SMOKE — ${BASE}\n`);
for (const r of rows) {
  console.log(
    `${r.ok ? 'PASS' : 'FAIL'}  ${r.method.padEnd(6)} ${r.path.padEnd(52)} ${String(r.status).padEnd(4)} ${r.vercelError.padEnd(11)} ${r.note}`,
  );
}
console.log(`\n${rows.length - failures}/${rows.length} routes reach the application function.`);
if (failures) {
  console.log(`\nFAIL — ${failures} route(s) returned a bare Vercel edge 404 (x-vercel-error: NOT_FOUND).`);
  process.exit(1);
}
console.log('\nPASS — every Admin route shape reaches handleApiRequest.');
