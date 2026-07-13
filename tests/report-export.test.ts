import assert from 'node:assert/strict';
import test from 'node:test';
import { createExcelXml, createSimplePdf } from '../server/report-export';

test('creates Excel-compatible XML with escaped cells', () => {
  const output = createExcelXml('Inscrições', ['Nome'], [['Ana & Bia']]);
  assert.match(output, /Excel\.Sheet/); assert.match(output, /Ana &amp; Bia/);
});

test('creates a valid multipage PDF signature and cross-reference', () => {
  const output = createSimplePdf('Relatório', ['ID'], Array.from({ length: 90 }, (_, id) => [id]));
  assert.equal(output.subarray(0, 8).toString(), '%PDF-1.4'); assert.match(output.toString('latin1'), /\/Count 3/); assert.match(output.toString('latin1'), /startxref/);
});
