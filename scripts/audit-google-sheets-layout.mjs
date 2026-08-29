/**
 * RELEASE-04 Stage 1 — Google Sheets layout audit tool.
 *
 * READ ONLY. It fetches spreadsheet *metadata* (never participant rows),
 * classifies managed / legacy / unmanaged layout resources, and prints the
 * repair plan that FUNPACE *would* apply. It performs ZERO batchUpdate calls
 * and has no --apply path.
 *
 *   node --import tsx scripts/audit-google-sheets-layout.mjs --fixture <path.json>
 *   node --import tsx scripts/audit-google-sheets-layout.mjs            # remote, metadata only
 *   node --import tsx scripts/audit-google-sheets-layout.mjs --headers  # remote + read header rows
 *   node --import tsx scripts/audit-google-sheets-layout.mjs --json
 *
 * Fixture JSON: { "spreadsheetId"?: string, "tabs": LayoutAuditTabInput[] }
 */
import { readFile } from 'node:fs/promises';

import { buildLayoutAuditReport, formatLayoutAuditReport } from '../server/google-sheets-layout-audit.ts';
import { GOOGLE_SHEET_TABS, createGoogleSheetsClient, getGoogleSheetsConfig } from '../server/google-sheets.ts';

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node --import tsx scripts/audit-google-sheets-layout.mjs [--fixture <path>] [--headers] [--json]');
  console.log('READ ONLY. No --apply / --write path exists. REMOTE_MUTATIONS is always 0.');
  process.exit(0);
}

for (const forbidden of ['--apply', '--write', '--fix', '--force', '--commit']) {
  if (argv.includes(forbidden)) {
    console.error(`refused: ${forbidden} is not supported. This tool is read-only (Stage 1).`);
    process.exit(2);
  }
}

const asJson = argv.includes('--json');
const withHeaders = argv.includes('--headers');
const fixtureFlagIndex = argv.indexOf('--fixture');
const fixturePath = fixtureFlagIndex >= 0 ? argv[fixtureFlagIndex + 1] : null;

function emit(report) {
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatLayoutAuditReport(report));
  }
  if (report.remoteMutations !== 0) {
    console.error('invariant violated: remoteMutations != 0');
    process.exit(3);
  }
}

if (fixturePath) {
  const parsed = JSON.parse(await readFile(fixturePath, 'utf8'));
  const tabs = Array.isArray(parsed) ? parsed : parsed.tabs || [];
  const report = buildLayoutAuditReport({
    mode: 'fixture',
    spreadsheetId: Array.isArray(parsed) ? null : parsed.spreadsheetId ?? null,
    tabs,
  });
  emit(report);
  process.exit(0);
}

// Remote read-only mode.
const config = getGoogleSheetsConfig();
if (!config.enabled || config.configurationIssue) {
  console.error(`remote audit unavailable: ${config.configurationIssue || 'Google Sheets integration is disabled'}`);
  console.error('Provide a fixture with --fixture <path> to run offline.');
  process.exit(1);
}

const client = createGoogleSheetsClient({ config });
const metadata = await client.getSpreadsheetMetadata();
const byTitle = new Map((metadata.sheets || []).map((sheet) => [sheet.properties?.title, sheet]));

const tabs = [];
for (const [sheetKey, title] of Object.entries(GOOGLE_SHEET_TABS)) {
  const sheet = byTitle.get(title);
  const sheetId = sheet?.properties?.sheetId;
  if (!sheet || typeof sheetId !== 'number') continue;
  let actualHeader;
  if (withHeaders) {
    const values = (await client.getValues(`'${title.replace(/'/g, "''")}'!1:1`)).values || [];
    actualHeader = values[0] || [];
  }
  tabs.push({ sheetKey, sheetId, actual: sheet, serviceAccountEmail: config.serviceAccountEmail, actualHeader });
}

const report = buildLayoutAuditReport({ mode: 'remote', spreadsheetId: config.spreadsheetId, tabs });
emit(report);
