import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGoogleSheetLayoutRequests,
  GOOGLE_SHEET_LAYOUTS,
  googleSheetsDateSerial,
  type ActualGoogleSheetLayout,
} from '../server/google-sheets-layout.js';

test('converts timestamps to Google serial numbers in America/Manaus wall time', () => {
  assert.ok(Math.abs((googleSheetsDateSerial('2026-07-08T12:00:00.000Z') || 0) - (46211 + 8 / 24)) < 1e-9);
  assert.equal(googleSheetsDateSerial('invalid'), null);
});

test('declares all ten operational sheet layouts with exact column widths', () => {
  assert.equal(Object.keys(GOOGLE_SHEET_LAYOUTS).length, 10);
  for (const layout of Object.values(GOOGLE_SHEET_LAYOUTS)) assert.equal(layout.widths.length, layout.columnCount);
  assert.equal(GOOGLE_SHEET_LAYOUTS.confirmed_payments.columnCount, 19);
  assert.equal(GOOGLE_SHEET_LAYOUTS.remarketing.columnCount, 22);
});

test('builds frozen panes, filters, hidden technical columns, notes, banding and protection', () => {
  const requests = buildGoogleSheetLayoutRequests('confirmed_payments', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 500, columnCount: 19 } },
  }, 'service@example.iam.gserviceaccount.com');
  assert.ok(requests.some((item) => 'updateSheetProperties' in item));
  assert.ok(requests.some((item) => 'setBasicFilter' in item));
  assert.equal(requests.filter((item) => 'updateDimensionProperties' in item).length, 21);
  assert.equal(requests.filter((item) => 'updateCells' in item).length, 3);
  assert.ok(requests.some((item) => 'addBanding' in item));
  const protection = requests.find((item) => 'addProtectedRange' in item) as { addProtectedRange: { protectedRange: { editors: { users: string[] } } } };
  assert.deepEqual(protection.addProtectedRange.protectedRange.editors.users, ['service@example.iam.gserviceaccount.com']);
});

test('adds a real checkbox validation to the Remarketing eligible column', () => {
  const requests = buildGoogleSheetLayoutRequests('remarketing', 7, { properties: { gridProperties: { rowCount: 1000 } } }, 'service@example.com', 339);
  const validations = requests.filter((item) => 'setDataValidation' in item) as Array<{ setDataValidation: { range: { startColumnIndex: number; endRowIndex?: number }; rule?: { condition: { type: string } } } }>;
  const validation = validations.find((item) => item.setDataValidation.rule)!;
  assert.equal(validation.setDataValidation.range.startColumnIndex, 18);
  assert.equal(validation.setDataValidation.range.endRowIndex, 340);
  assert.equal(validation.setDataValidation.rule?.condition.type, 'BOOLEAN');
  assert.equal(validations.some((item) => !item.setDataValidation.rule), true);
});

test('keeps literal percentage and currency formats explicit', () => {
  assert.deepEqual(GOOGLE_SHEET_LAYOUTS.lots.numberFormats.find((item) => item.columnIndex === 5), { columnIndex: 5, pattern: '0.0"%"', type: 'NUMBER' });
  assert.equal(GOOGLE_SHEET_LAYOUTS.confirmed_payments.numberFormats.filter((item) => item.type === 'CURRENCY').length, 2);
});

test('does not churn managed conditional formatting, banding or protection when already equal', () => {
  const first = buildGoogleSheetLayoutRequests('shirts', 3, { properties: { gridProperties: { rowCount: 100 } } }, 'service@example.com');
  const addedProtection = (first.find((item) => 'addProtectedRange' in item) as any).addProtectedRange.protectedRange;
  const addedBanding = (first.find((item) => 'addBanding' in item) as any).addBanding.bandedRange;
  const actual: ActualGoogleSheetLayout = {
    properties: { sheetId: 3, gridProperties: { rowCount: 100 } },
    protectedRanges: [{ ...addedProtection, protectedRangeId: 8 }],
    bandedRanges: [{ ...addedBanding, bandedRangeId: 9 }],
    conditionalFormats: [],
  };
  const second = buildGoogleSheetLayoutRequests('shirts', 3, actual, 'service@example.com');
  assert.equal(second.some((item) => 'addProtectedRange' in item || 'updateProtectedRange' in item), false);
  assert.equal(second.some((item) => 'addBanding' in item || 'updateBanding' in item), false);
  assert.equal(second.some((item) => 'addConditionalFormatRule' in item || 'deleteConditionalFormatRule' in item), false);
});
