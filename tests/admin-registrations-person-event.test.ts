import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ADMIN-003 Stage 2 §52-63 — the Inscrições tab is person-centric and scoped to
// ONE explicit event. This suite locks the wiring: the endpoint resolves an
// event (reusing the dashboard authority), consolidates people, paginates
// people, guards resource-by-id crossover, and keeps every OTHER admin surface
// on the untouched row-centric path.

const server = readFileSync('server/index.ts', 'utf8');
const admin = readFileSync('src/pages/Admin.tsx', 'utf8');
const api = readFileSync('src/lib/api.ts', 'utf8');
const types = readFileSync('src/types/registration.ts', 'utf8');

function block(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `${startNeedle} located`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end >= 0 ? end : undefined);
}

test('§52 the person read-model is a dedicated pure module, imported by the server', () => {
  assert.match(server, /import \{ consolidateParticipants, toRegistrationHistory \} from '\.\/participant-read-model\.js'/);
  const model = readFileSync('server/participant-read-model.ts', 'utf8');
  assert.ok(!/\btransaction\(/.test(model), 'read model never touches the database');
  assert.ok(!/readPostgresDatabase|usesPostgresDatabase/.test(model), 'read model is provider-independent');
});

test('§53 GET /api/admin/registrations?view=people resolves an event scope then consolidates', () => {
  const handler = block(server, 'async function handleAdminRegistrations(', '\nasync function ');
  assert.match(handler, /url\.searchParams\.get\('view'\) === 'people'/);
  assert.match(handler, /resolveDashboardEventScope\(res, fullDatabase, url\)/);
  assert.match(handler, /if \(!eventScope\) return;/);
  assert.match(handler, /buildParticipantsPage\(url, eventScope\.scoped\)/);
  // ADMIN-003 Stage 3 wraps the rows in the role-aware serializer; the
  // pagination + event contract is unchanged.
  assert.match(handler, /registrations: serializeAdminRegistrationsForRole\(registrations, role, 'list'\),\s*\n\s*pagination,\s*\n\s*event: eventScope\.context,/);
});

test('§54 no "all events" / silent fallback — the resolver is the dashboard one', () => {
  const resolver = block(server, 'function resolveDashboardEventScope', '\nasync function handleAdminSummary');
  assert.ok(!/events\[0\]/.test(resolver));
  assert.match(resolver, /json\(res, 400, \{ code: resolution\.code/);
  // ambiguous / unknown / none => 400 with a code the frontend can branch on
  assert.match(server, /EVENT_SCOPE_ERROR_MESSAGE: Record<EventScopeErrorCode, string>/);
});

test('§55 every OTHER admin surface keeps the untouched row-centric global path', () => {
  const handler = block(server, 'async function handleAdminRegistrations(', '\nasync function ');
  // the non-people branch is still the plain getAdminRows(url) + rows.length total
  assert.match(handler, /const rows = await getAdminRows\(url\);\s*\n\s*const pageSize/);
  assert.match(handler, /const total = rows\.length;/);
  // report export is explicitly left alone (separate module)
  const report = block(server, 'async function handleAdminReportExport(', '\nasync function ');
  assert.match(report, /const rows = await getAdminRows\(url\);/);
  assert.ok(!/resolveDashboardEventScope/.test(report), 'report export is not event-scoped in this stage');
});

test('§56 resource-by-id crossover guard on the detail view and every drawer mutation', () => {
  const detail = block(server, 'async function handleAdminRegistrationDetails(', '\nasync function ');
  assert.match(detail, /assertRegistrationInRequestedEvent\(res, database, url, registration\)/);
  assert.match(detail, /personHistory/);

  const guard = block(server, 'function assertRegistrationInRequestedEvent(', '\n}');
  assert.match(guard, /if \(!selector\.eventId\?\.trim\(\) && !selector\.eventSlug\?\.trim\(\)\) return true;/);
  assert.match(guard, /json\(res, 409, \{ code: 'EVENT_SCOPE_MISMATCH'/);

  for (const fn of [
    'handleAdminRegistrationMaintenance',
    'handleAdminRegistrationUpdate',
    'handleAdminBibNumber',
    'handleAdminCheckIn',
    'handleAdminKitDelivery',
  ]) {
    const body = block(server, `async function ${fn}(`, '\nasync function ');
    assert.match(body, /ensureRegistrationEventScope\(res, url, registrationId\)/, `${fn} runs the event-scope guard`);
  }
  const sheets = block(server, 'async function handleAdminRegistrationGoogleSheetsSync(', '\nasync function ');
  assert.match(sheets, /assertRegistrationInRequestedEvent\(res, database, url, registration\)/);
});

test('§56b the guard is a no-op without a selector — non-tab API clients unaffected', () => {
  const ensure = block(server, 'async function ensureRegistrationEventScope(', '\n}');
  assert.match(ensure, /if \(!selector\) return true;/);
});

test('§57 filters/search/sort are shared between the row and person paths, with an id tie-breaker', () => {
  const filters = block(server, 'function buildAdminRowFilters(', 'async function getAdminRows(');
  assert.match(filters, /function matchesRegistration\(registration: RegistrationRecord\)/);
  assert.match(filters, /function matchesRow\(row: AdminRow\)/);
  assert.match(filters, /return String\(a\.id\)\.localeCompare\(String\(b\.id\)\);/); // deterministic tie-breaker
  const participants = block(server, 'function getParticipantRows(', 'async function handleAdminRegistrations(');
  assert.match(participants, /consolidateParticipants\(database\.registrations\)/);
  assert.match(participants, /matchesRegistration\(participant\.canonical\)/);
  assert.match(participants, /matchesRow\(row\)/);
  assert.match(participants, /row\.attemptsCount = participant\.history\.length;/);
});

test('§58 pagination paginates consolidated people; totals are the pre-slice universe', () => {
  const builder = block(server, 'export function buildParticipantsPage(', '\nasync function ');
  // totals come from the FULL filtered result set, sliced only for `registrations`
  assert.match(builder, /const \{ rows: people, peopleTotal, historicalRegistrationsTotal \} = getParticipantRows\(url, database\)/);
  assert.match(builder, /registrations: people\.slice\(\(page - 1\) \* pageSize, page \* pageSize\)/);
  assert.match(builder, /total: peopleTotal,/);
  assert.match(builder, /people: peopleTotal,/);
  assert.match(builder, /historicalRegistrations: historicalRegistrationsTotal,/);
  const resultSet = block(server, 'function getParticipantRows(', 'export type ParticipantsPage');
  assert.match(resultSet, /historicalRegistrationsTotal: sorted\.reduce\(\(sum, row\) => sum \+ row\.attemptsCount, 0\)/);
  assert.match(resultSet, /peopleTotal: sorted\.length,/);
});

test('§60 the tab CSV is event-scoped + person-centric only under view=people; Stage 1 escapeCsv intact', () => {
  const csvHandler = block(server, 'async function handleAdminRegistrationsCsv(', '\nasync function ');
  assert.match(csvHandler, /const peopleView = url\.searchParams\.get\('view'\) === 'people';/);
  assert.match(csvHandler, /rows = getParticipantRows\(url, eventScope\.scoped\)\.rows;/);
  assert.match(csvHandler, /rows = await getAdminRows\(url\);/); // Relatorios path unchanged
  assert.match(csvHandler, /\.\.\.\(peopleView \? \['tentativas'\] : \[\]\)/);
  assert.match(csvHandler, /\]\.map\(escapeCsv\)\.join\(','\)/); // Stage 1 primitive still the only cell writer
});

test('§61/§63 response contract: attemptsCount + personHistory + people counters', () => {
  assert.match(types, /export type AdminParticipantRow = AdminRegistration & \{ attemptsCount: number \}/);
  assert.match(types, /export type AdminRegistrationHistoryItem = \{/);
  const listResponse = block(types, 'export type AdminRegistrationsResponse = {', '\n};');
  assert.match(listResponse, /people\?: number;/);
  assert.match(listResponse, /historicalRegistrations\?: number;/);
  assert.match(listResponse, /event\?: AdminEventContext;/);
  const detailResponse = block(types, 'export type AdminRegistrationDetailsResponse = {', '\n};');
  assert.match(detailResponse, /personHistory: AdminRegistrationHistoryItem\[\];/);
});

test('§62 frontend: stateless ?event= selection, recovery state, minimal race guard', () => {
  assert.match(admin, /function readEventSlugFromLocation\(\)/);
  assert.match(admin, /function writeEventSlugToLocation\(slug: string\)/);
  assert.ok(!/sessionStorage|localStorage/.test(block(admin, 'function AdminPage()', '\nfunction AdminSection(')), 'no storage for the event selection');
  // people view is opted into explicitly
  assert.match(admin, /\{ \.\.\.filters, view: 'people', event: eventParam \|\| '' \}/);
  // latest-wins guard on event switch (no full L1 refactor)
  assert.match(admin, /registrationsRequestSeq/);
  assert.match(admin, /registrationsIsStale/);
  // event switch resets incompatible filters + page
  assert.match(admin, /setFilters\(\(previous\) => \(\{ \.\.\.previous, page: '1', distanceId: '', lotId: '' \}\)\)/);
  // ambiguous/unknown => recovery selection block, not the table
  const panel = block(admin, 'function RegistrationsPanel(', '\nfunction Panel(');
  assert.match(panel, /if \(eventError\) \{/);
  assert.match(panel, /Selecione um evento/);
  assert.match(panel, /\(encerrado\)/);
  // person counter, not "resultado(s)"
  assert.match(panel, /pessoa' : 'pessoas'/);
  assert.match(panel, /registros históricos/);
  assert.match(panel, /tentativas/);
  assert.match(panel, /Histórico de tentativas/);
});

test('§62b api client carries the event through resource-by-id + mutation calls', () => {
  assert.match(api, /function currentEventParam\(\)/);
  for (const needle of [
    /getAdminRegistrationDetails\(adminKey: string, registrationId: string\)[\s\S]*?toQueryString\(\{ event: currentEventParam\(\) \}\)/,
    /maintainAdminRegistration[\s\S]*?toQueryString\(\{ event: currentEventParam\(\) \}\)/,
    /assignAdminBibNumber[\s\S]*?toQueryString\(\{ event: currentEventParam\(\) \}\)/,
    /postAdminRegistrationAction[\s\S]*?toQueryString\(\{ event: currentEventParam\(\) \}\)/,
    /syncAdminRegistrationToGoogleSheets[\s\S]*?toQueryString\(\{ event: currentEventParam\(\) \}\)/,
  ]) {
    assert.match(api, needle);
  }
});

test('no DB migration / DDL / index was introduced in this stage', () => {
  // Stage 2 is in-memory scoping only (scopeDatabaseToEvent); no schema change.
  const model = readFileSync('server/participant-read-model.ts', 'utf8');
  assert.ok(!/create index|alter table|add column|migration/i.test(model));
  const handler = block(server, 'async function handleAdminRegistrations(', '\nasync function ');
  assert.ok(!/create index|alter table/i.test(handler));
});
