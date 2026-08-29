import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildGoogleSheetLayoutRequests,
  GOOGLE_SHEET_LAYOUTS,
  type ActualGoogleSheetLayout,
} from '../server/google-sheets-layout.js';
import {
  buildLayoutAuditReport,
  formatLayoutAuditReport,
  headerFingerprint,
} from '../server/google-sheets-layout-audit.js';

const SERVICE = 'service@example.iam.gserviceaccount.com';
const EMAILS_HEADER = ['Data', 'Inscrição', 'Destinatário', 'Status', 'Provedor', 'Message ID', 'Erro', 'Delivery ID'];
const LEGACY_EMAILS_HEADER = ['Data', 'Inscrição', 'Destinatário', 'Status', 'Provedor', 'Message ID', 'Erro'];

function convergedEmails(rowCount = 189): ActualGoogleSheetLayout {
  const properties = { sheetId: 42, title: 'Emails enviados', gridProperties: { rowCount, columnCount: 8, frozenRowCount: 1, frozenColumnCount: 1 } };
  const first = buildGoogleSheetLayoutRequests('emails', 42, { properties }, SERVICE);
  return {
    properties,
    basicFilter: { range: { sheetId: 42, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 8 } },
    conditionalFormats: first.filter((item) => 'addConditionalFormatRule' in item).map((item) => (item as any).addConditionalFormatRule.rule),
    protectedRanges: [{ ...(first.find((item) => 'addProtectedRange' in item) as any).addProtectedRange.protectedRange, protectedRangeId: 1 }],
    bandedRanges: [{ ...(first.find((item) => 'addBanding' in item) as any).addBanding.bandedRange, bandedRangeId: 2 }],
  };
}

test('audit report is read-only and fingerprints the spreadsheet id, never echoing it', () => {
  const report = buildLayoutAuditReport({
    mode: 'fixture',
    spreadsheetId: 'super-secret-spreadsheet-id-1234567890',
    tabs: [{ sheetKey: 'emails', sheetId: 42, actual: convergedEmails(), serviceAccountEmail: SERVICE, actualHeader: EMAILS_HEADER }],
  });
  assert.equal(report.remoteMutations, 0);
  assert.equal(report.tabs[0].remoteMutations, 0);
  assert.equal(report.tabs[0].driftStatus, 'converged');
  assert.equal(report.spreadsheetFingerprint?.length, 12);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('super-secret-spreadsheet-id-1234567890'), false);
});

test('audit report classifies a legacy Emails header without flagging schema drift', () => {
  const report = buildLayoutAuditReport({
    mode: 'fixture',
    tabs: [{
      sheetKey: 'emails', sheetId: 42,
      actual: {
        properties: { sheetId: 42, title: 'Emails enviados', gridProperties: { rowCount: 189, columnCount: 8 } },
        basicFilter: { range: { sheetId: 42, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 } },
      },
      serviceAccountEmail: SERVICE,
      actualHeader: LEGACY_EMAILS_HEADER,
    }],
  });
  assert.equal(report.tabs[0].schemaDrift, false);
  assert.equal(report.tabs[0].driftStatus, 'legacy_migration');
  assert.ok(report.tabs[0].notes.some((note) => note.startsWith('legacy_header')));
  assert.equal(report.summary.legacy_migration, 1);
});

test('audit report reports SHEETS_SCHEMA_DRIFT and computes no plan for an unexpected header', () => {
  const report = buildLayoutAuditReport({
    mode: 'fixture',
    tabs: [{
      sheetKey: 'emails', sheetId: 42,
      actual: { properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } } },
      serviceAccountEmail: SERVICE,
      actualHeader: ['Timestamp', 'Who', 'What'],
    }],
  });
  assert.equal(report.tabs[0].schemaDrift, true);
  assert.equal(report.tabs[0].driftStatus, 'schema_drift');
  assert.equal(report.tabs[0].plan, null);
  assert.equal(report.summary.schema_drift, 1);
});

test('audit report surfaces unmanaged drift as drift_detected with zero remote mutations', () => {
  const report = buildLayoutAuditReport({
    mode: 'fixture',
    tabs: [{
      sheetKey: 'emails', sheetId: 42,
      actual: {
        properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
        conditionalFormats: [{
          ranges: [{ sheetId: 42, startRowIndex: 1, endRowIndex: 189, startColumnIndex: 2, endColumnIndex: 3 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'x' }] }, format: {} },
        }],
      },
      serviceAccountEmail: SERVICE,
      actualHeader: EMAILS_HEADER,
    }],
  });
  assert.equal(report.tabs[0].driftStatus, 'drift_detected');
  assert.equal(report.remoteMutations, 0);
  assert.equal(report.tabs[0].plan?.remoteMutations, 0);
  assert.match(formatLayoutAuditReport(report), /REMOTE_MUTATIONS=0/);
});

test('headerFingerprint is stable and independent of surrounding whitespace', () => {
  assert.equal(headerFingerprint(EMAILS_HEADER), headerFingerprint(EMAILS_HEADER.map((cell) => ` ${cell} `)));
  assert.notEqual(headerFingerprint(EMAILS_HEADER), headerFingerprint(LEGACY_EMAILS_HEADER));
});

test('the audit CLI runs a fixture read-only and refuses an --apply flag', () => {
  const script = fileURLToPath(new URL('../scripts/audit-google-sheets-layout.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'sheets-audit-'));
  const fixturePath = join(dir, 'fixture.json');
  writeFileSync(fixturePath, JSON.stringify({
    spreadsheetId: 'fixture-only',
    tabs: [{ sheetKey: 'emails', sheetId: 42, actual: convergedEmails(), serviceAccountEmail: SERVICE, actualHeader: EMAILS_HEADER }],
  }));

  const output = execFileSync(process.execPath, ['--import', 'tsx', script, '--fixture', fixturePath], { encoding: 'utf8' });
  assert.match(output, /REMOTE_MUTATIONS=0/);
  assert.match(output, /drift_status=converged/);
  assert.equal(output.includes(GOOGLE_SHEET_LAYOUTS.emails.columnCount > 0 ? 'fixture-only' : '__never__'), false);

  assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', script, '--fixture', fixturePath, '--apply'], { encoding: 'utf8', stdio: 'pipe' }));
});
