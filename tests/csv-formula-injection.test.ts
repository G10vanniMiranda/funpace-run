import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { escapeCsv, sanitizeSpreadsheetCell } from '../server/index.js';

// ADMIN-003 Stage 1 — CSV Formula Injection hardening. Security-only. Pure
// textual transformation: no formula is executed here.

// ---- §10 dangerous cells: neutralised, value preserved (prefixed with ') ----

const DANGEROUS = [
  '=SUM(1,1)',
  '+SUM(1,1)',
  '-1+1',
  '@SUM(1,1)',
  '\t=SUM(1,1)',
  '\r=SUM(1,1)',
  '=HYPERLINK("http://evil","clique")',
  '=cmd|\' /c calc\'!A1',
  '   =1+1',            // leading whitespace then a trigger
  '  \t  @X',           // mixed leading whitespace/control then a trigger
  '\t',                 // a lone TAB is control data
  '\r',                 // a lone CR is control data
];

for (const value of DANGEROUS) {
  test(`sanitizeSpreadsheetCell neutralises ${JSON.stringify(value)}`, () => {
    const out = sanitizeSpreadsheetCell(value);
    assert.equal(out, `'${value}`, 'exactly one leading apostrophe, original text kept verbatim');
    assert.ok(!/^\s*[=+\-@]/.test(out) && !/^[\t\r]/.test(out), 'result no longer opens with a formula/control trigger');
  });
}

// ---- §11 benign values: left byte-for-byte identical ----

const BENIGN = [
  'Giovanni Miranda',
  'giovanni@example.com',        // '@' is not the FIRST char
  'user-name@dominio.com.br',
  '11999999999',
  'Porto Velho',
  'R$ 99,90',
  '10 KM',
  'Equipe A, Corrida',           // comma -> handled by CSV quoting, not a formula
  'linha1\nlinha2',              // newline -> CSV quoting, not a formula
  'Ação com acento é preservada',
  ' texto com espaço legítimo',  // leading space, no trigger after it
  '"já entre aspas"',
  '',
  'x - y',                       // '-' not at the start
];

for (const value of BENIGN) {
  test(`sanitizeSpreadsheetCell leaves ${JSON.stringify(value)} untouched`, () => {
    assert.equal(sanitizeSpreadsheetCell(value), value);
  });
}

test('a leading "+" (e.g. an international phone) IS neutralised — "+" is a formula trigger, the apostrophe is hidden by the spreadsheet', () => {
  assert.equal(sanitizeSpreadsheetCell('+55 69 99999-0000'), "'+55 69 99999-0000");
});

test('null / undefined collapse to an empty cell', () => {
  assert.equal(sanitizeSpreadsheetCell(null), '');
  assert.equal(sanitizeSpreadsheetCell(undefined), '');
  assert.equal(escapeCsv(null), '""');
});

// ---- §12 formula neutralisation AND structural CSV quoting compose ----

test('§12 escapeCsv applies BOTH protections', () => {
  // structural only
  assert.equal(escapeCsv('a,b'), '"a,b"');
  assert.equal(escapeCsv('a"b'), '"a""b"');
  assert.equal(escapeCsv('linha1\nlinha2'), '"linha1\nlinha2"');
  // formula only
  assert.equal(escapeCsv('=SUM(1,1)'), `"'=SUM(1,1)"`);
  // BOTH: neutralise the formula, then quote + double the inner quote
  assert.equal(escapeCsv('=HYPERLINK("x","y")'), `"'=HYPERLINK(""x"",""y"")"`);
  assert.equal(escapeCsv('-1,5'), `"'-1,5"`);
  // benign stays minimal (just structural quoting)
  assert.equal(escapeCsv('Giovanni Miranda'), '"Giovanni Miranda"');
  assert.equal(escapeCsv('Ação'), '"Ação"');
});

test('the neutralised cell can be parsed back to its original text (drop leading apostrophe)', () => {
  const original = '=1+2';
  const cell = escapeCsv(original); // "'=1+2"
  const unquoted = cell.slice(1, -1).replace(/""/g, '"'); // '=1+2
  assert.equal(unquoted.replace(/^'/, ''), original);
});

// ---- §13 regression guard: every CSV surface uses the single hardened helper ----

const serverSource = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');

test('§5/§13 escapeCsv is the only CSV cell primitive and it composes sanitizeSpreadsheetCell', () => {
  assert.ok(!/\bfunction csvCell\b/.test(serverSource), 'csvCell duplicate removed');
  assert.ok(!/\bcsvCell\(/.test(serverSource), 'no call site still uses csvCell');
  const escapeBody = serverSource.slice(
    serverSource.indexOf('export function escapeCsv('),
    serverSource.indexOf('export function escapeCsv(') + 200,
  );
  assert.match(escapeBody, /sanitizeSpreadsheetCell\(value\)/, 'escapeCsv runs through the formula guard');
});

test('§13 every text/csv response builds its cells through escapeCsv', () => {
  // each CSV handler that emits `csv(res, …)` must run its cells through escapeCsv
  const handlers = [
    'handleAdminPaymentsCsv',
    'handleAdminAuditLogsCsv',
    'handleAdminPartnerDashboardExport',
    'handleAdminRegistrationsCsv',
    'handleAdminReportExport',
    'handleAdminPartnershipsCsv',
  ];
  for (const name of handlers) {
    const start = serverSource.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `${name} located`);
    const end = serverSource.indexOf('\nasync function ', start + 1);
    const body = serverSource.slice(start, end >= 0 ? end : undefined);
    assert.match(body, /csv\(res,/, `${name} emits a CSV response`);
    assert.match(body, /\bescapeCsv\b/, `${name} escapes its cells with escapeCsv`);
    assert.ok(!/\bcsvCell\b/.test(body), `${name} does not use a bespoke cell helper`);
  }
});
