import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeCsv } from '../server/index.js';
import { buildStartList, startListCsvCells, type StartListSourceRow } from '../server/start-list.js';

// EVENT-DAY-OFFLINE-FALLBACK & START-LIST — the CSV is safe against spreadsheet
// formula injection from participant-controlled strings (name), and structurally
// safe against commas / quotes / newlines / Unicode. The start-list handler
// composes `startListCsvCells` (raw grid) with the canonical `escapeCsv`
// (formula guard + RFC-4180 quoting) exactly like every other Admin export.

let seq = 0;
function paidRow(name: string, over: Partial<StartListSourceRow> = {}): StartListSourceRow {
  seq += 1;
  return {
    id: `reg-${seq}`,
    name,
    cpfMasked: '123.***.***-45',
    bibNumber: String(1000 + seq),
    distance: '5K',
    distanceId: 'distance-5k',
    shirtSize: 'M',
    status: 'paid',
    checkInRecorded: false,
    checkInAt: null,
    kitRecorded: false,
    kitAt: null,
    personKey: `cpf:${seq}`,
    ...over,
  };
}

/** Reproduce the handler's exact CSV composition. */
function renderCsv(rows: StartListSourceRow[]): string {
  const grid = startListCsvCells(buildStartList(rows, { sort: 'bib' }));
  return `﻿${grid.map((cells) => cells.map(escapeCsv).join(',')).join('\r\n')}\r\n`;
}

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

for (const prefix of FORMULA_PREFIXES) {
  test(`a name starting with ${JSON.stringify(prefix)} is neutralised (leading apostrophe)`, () => {
    const csv = renderCsv([paidRow(`${prefix}SUM(A1:A9)`)]);
    // the NAME cell (2nd column) is quoted and starts with '
    const dataLine = csv.split('\r\n')[1];
    const nameCell = dataLine.split(',')[1];
    assert.equal(nameCell, `"'${prefix}SUM(A1:A9)"`);
    // no bare formula survives: after the opening quote the first char is '
    assert.match(csv, /,"'[=+\-@\t\r]/);
  });
}

test('classic injection payloads are neutralised', () => {
  const csv = renderCsv([
    paidRow('=HYPERLINK("http://evil","x")'),
    paidRow('+1+1'),
    paidRow('-2+3'),
    paidRow('@SUM(1)'),
    paidRow('=1;=2'),
  ]);
  for (const bad of ['\n=HYPERLINK', '\n+1+1', '\n-2+3', '\n@SUM', '\n=1;=2', ',=', ',+1+1', ',-2+3', ',@SUM']) {
    assert.equal(csv.includes(`"${bad.replace(/^[\n,]/, '')}`) && !csv.includes(`"'${bad.replace(/^[\n,]/, '')}`), false);
  }
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/evil"",""x""\)"/);
  assert.match(csv, /"'\+1\+1"/);
  assert.match(csv, /"'-2\+3"/);
  assert.match(csv, /"'@SUM\(1\)"/);
});

test('a benign hyphenated name is NOT altered (hyphen is mid-string)', () => {
  const csv = renderCsv([paidRow('Ana-Paula Nogueira-Lopes')]);
  assert.match(csv, /,"Ana-Paula Nogueira-Lopes",/);
  assert.doesNotMatch(csv, /"'Ana-Paula/);
});

test('commas, quotes and newlines in a name round-trip via RFC-4180 quoting', () => {
  const csv = renderCsv([paidRow('Silva, "Junior"\nX')]);
  assert.match(csv, /,"Silva, ""Junior""\nX",/);
});

test('Unicode / accented names are preserved and the file carries a UTF-8 BOM', () => {
  const csv = renderCsv([paidRow('José Nguyễn Müller São 🏃')]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /,"José Nguyễn Müller São 🏃",/);
});

test('CRLF line endings and the fixed pt-BR header', () => {
  const csv = renderCsv([paidRow('Ana')]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '﻿"DORSAL","NOME","CPF","PROVA","CAMISA","PAGO","CHECK-IN","KIT","ID INSCRICAO"');
  assert.ok(csv.endsWith('\r\n'));
  assert.doesNotMatch(csv.replace(/\r\n/g, ''), /\n/); // no bare LF
});

test('no PII column leaks into the CSV — exactly 9 columns, none of them email/phone/amount', () => {
  const csv = renderCsv([paidRow('Ana')]);
  const header = csv.split('\r\n')[0].replace('﻿', '');
  assert.equal(header.split(',').length, 9);
  for (const forbidden of ['EMAIL', 'TELEFONE', 'PHONE', 'NASCIMENTO', 'VALOR', 'CUPOM', 'GATEWAY', 'PROVIDER', 'PARCEIRO']) {
    assert.doesNotMatch(header.toUpperCase(), new RegExp(forbidden));
  }
});
