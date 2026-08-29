import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertNoUnmanagedLayoutDrift,
  buildGoogleSheetLayoutPlan,
  buildGoogleSheetLayoutRequests,
  buildGoogleSheetVisualRepairRequests,
  buildLegacyEmailsConvergencePlan,
  classifyLayoutResources,
  GOOGLE_SHEET_LAYOUTS,
  googleSheetsDateSerial,
  LayoutDriftError,
  type ActualGoogleSheetLayout,
} from '../server/google-sheets-layout.js';

const SERVICE = 'service@example.iam.gserviceaccount.com';

/** A fully converged Emails sheet: managed conditional formats, banding and protection fed back in. */
function convergedEmails(rowCount = 189): ActualGoogleSheetLayout {
  const properties = { sheetId: 42, gridProperties: { rowCount, columnCount: 8, frozenRowCount: 1, frozenColumnCount: 1 } };
  const first = buildGoogleSheetLayoutRequests('emails', 42, { properties }, SERVICE);
  return {
    properties,
    basicFilter: { range: { sheetId: 42, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 8 } },
    conditionalFormats: first.filter((item) => 'addConditionalFormatRule' in item)
      .map((item) => (item as any).addConditionalFormatRule.rule),
    protectedRanges: [{
      ...(first.find((item) => 'addProtectedRange' in item) as any).addProtectedRange.protectedRange,
      protectedRangeId: 501,
    }],
    bandedRanges: [{
      ...(first.find((item) => 'addBanding' in item) as any).addBanding.bandedRange,
      bandedRangeId: 502,
    }],
  };
}

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

// --- RELEASE-04 Stage 1: canonical colour precision -------------------------

test('treats Google float colour serialization as equal and does not re-churn', () => {
  const first = buildGoogleSheetLayoutRequests('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 240, columnCount: 8 } },
  }, SERVICE);
  const rules = first.filter((item) => 'addConditionalFormatRule' in item)
    .map((item) => structuredClone((item as any).addConditionalFormatRule.rule));
  // Google echoes the same channel with fewer significant digits.
  const channel = rules[0].booleanRule.format.backgroundColorStyle.rgbColor;
  channel.green = Number(Number(channel.green).toFixed(7));

  const second = buildGoogleSheetLayoutRequests('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 240, columnCount: 8 } },
    conditionalFormats: rules,
  }, SERVICE);
  assert.equal(second.some((item) => 'deleteConditionalFormatRule' in item || 'addConditionalFormatRule' in item), false);
});

test('still detects a genuinely different managed colour', () => {
  const first = buildGoogleSheetLayoutRequests('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 240, columnCount: 8 } },
  }, SERVICE);
  const rules = first.filter((item) => 'addConditionalFormatRule' in item)
    .map((item) => structuredClone((item as any).addConditionalFormatRule.rule));
  rules[0].booleanRule.format.backgroundColorStyle.rgbColor.green = 0.5;

  const second = buildGoogleSheetLayoutRequests('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 240, columnCount: 8 } },
    conditionalFormats: rules,
  }, SERVICE);
  assert.equal(second.some((item) => 'addConditionalFormatRule' in item), true);
});

// --- RELEASE-04 Stage 1: strict guard OFF (default) is main-compatible ------

test('strict guard OFF: an unmanaged conditional format is still replaced, no throw', () => {
  const actual: ActualGoogleSheetLayout = {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
    conditionalFormats: [{
      ranges: [{ sheetId: 42, startRowIndex: 1, endRowIndex: 189, startColumnIndex: 2, endColumnIndex: 3 }],
      booleanRule: {
        condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'operator-added' }] },
        format: { backgroundColorStyle: { rgbColor: { red: 1 } } },
      },
    }],
  };
  const requests = buildGoogleSheetLayoutRequests('emails', 42, actual, SERVICE);
  assert.equal(requests.some((item) => 'deleteConditionalFormatRule' in item), true);
  assert.equal(requests.some((item) => 'addConditionalFormatRule' in item), true);
});

test('strict guard OFF: unmanaged banding and a filter with criteria do not throw', () => {
  assert.doesNotThrow(() => buildGoogleSheetLayoutRequests('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
    basicFilter: { range: { sheetId: 42, startColumnIndex: 0, endColumnIndex: 8 }, criteria: { 3: { hiddenValues: ['falhou'] } } },
    bandedRanges: [{
      bandedRangeId: 92,
      range: { sheetId: 42, startRowIndex: 1, endRowIndex: 189, startColumnIndex: 0, endColumnIndex: 8 },
      rowProperties: {
        firstBandColorStyle: { rgbColor: { red: 1, green: 0, blue: 0 } },
        secondBandColorStyle: { rgbColor: { red: 0, green: 0, blue: 1 } },
      },
    }],
  }, SERVICE));
});

// --- RELEASE-04 Stage 1: strict guard ON fails closed ----------------------

test('strict guard ON: unmanaged conditional format throws LayoutDriftError and emits nothing', () => {
  let thrown: unknown;
  try {
    buildGoogleSheetLayoutRequests('emails', 42, {
      properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
      conditionalFormats: [{
        ranges: [{ sheetId: 42, startRowIndex: 1, endRowIndex: 189, startColumnIndex: 2, endColumnIndex: 3 }],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'operator-added' }] },
          format: { backgroundColorStyle: { rgbColor: { red: 1 } } },
        },
      }],
    }, SERVICE, undefined, { strictLayoutGuard: true });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof LayoutDriftError);
  assert.equal((thrown as LayoutDriftError).code, 'LAYOUT_DRIFT_DETECTED');
  assert.equal((thrown as LayoutDriftError).operatorActionRequired, true);
  assert.equal((thrown as LayoutDriftError).retryable, false);
  assert.equal((thrown as LayoutDriftError).drift[0].kind, 'conditional_format');
});

test('strict guard ON: unmanaged overlapping banding throws', () => {
  assert.throws(() => buildGoogleSheetLayoutRequests('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
    bandedRanges: [{
      bandedRangeId: 92,
      range: { sheetId: 42, startRowIndex: 1, endRowIndex: 189, startColumnIndex: 0, endColumnIndex: 8 },
      rowProperties: {
        firstBandColorStyle: { rgbColor: { red: 1, green: 0, blue: 0 } },
        secondBandColorStyle: { rgbColor: { red: 0, green: 0, blue: 1 } },
      },
    }],
  }, SERVICE, undefined, { strictLayoutGuard: true }), /LAYOUT_DRIFT_DETECTED/);
});

test('strict guard ON: a basic filter carrying criteria throws', () => {
  assert.throws(() => buildGoogleSheetLayoutRequests('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
    basicFilter: {
      range: { sheetId: 42, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 8 },
      criteria: { 3: { hiddenValues: ['falhou'] } },
    },
  }, SERVICE, undefined, { strictLayoutGuard: true }), /LAYOUT_DRIFT_DETECTED/);
});

test('strict guard ON: a converged managed sheet does not throw', () => {
  assert.doesNotThrow(() => buildGoogleSheetLayoutRequests('emails', 42, convergedEmails(), SERVICE, undefined, { strictLayoutGuard: true }));
});

test('strict guard ON: the legacy 7-column Emails banding is not treated as drift', () => {
  const desired = buildGoogleSheetLayoutRequests('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
  }, SERVICE);
  const banding = structuredClone((desired.find((item) => 'addBanding' in item) as any).addBanding.bandedRange);
  assert.doesNotThrow(() => assertNoUnmanagedLayoutDrift('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
    bandedRanges: [{ ...banding, bandedRangeId: 77, range: { ...banding.range, endColumnIndex: 7 } }],
  }, SERVICE));
});

// --- RELEASE-04 Stage 1: protected-range editor preservation ---------------

test('editor preservation: keeps an operator editor when migrating the protected range', () => {
  const desired = buildGoogleSheetLayoutRequests('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
  }, SERVICE);
  const protection = structuredClone((desired.find((item) => 'addProtectedRange' in item) as any).addProtectedRange.protectedRange);
  const requests = buildGoogleSheetLayoutRequests('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
    protectedRanges: [{
      ...protection,
      protectedRangeId: 95,
      range: { ...protection.range, endColumnIndex: 7 },
      editors: { users: [SERVICE, 'ops@example.com'] },
    }],
  }, SERVICE);
  const update = (requests.find((item) => 'updateProtectedRange' in item) as any).updateProtectedRange;
  assert.deepEqual(update.protectedRange.editors.users, [SERVICE, 'ops@example.com']);
  assert.equal(requests.some((item) => 'addProtectedRange' in item || 'deleteProtectedRange' in item), false);
});

test('editor preservation: adds the service account when a legacy protection omits it', () => {
  const desired = buildGoogleSheetLayoutRequests('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
  }, SERVICE);
  const protection = structuredClone((desired.find((item) => 'addProtectedRange' in item) as any).addProtectedRange.protectedRange);
  const requests = buildGoogleSheetLayoutRequests('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
    protectedRanges: [{
      ...protection,
      protectedRangeId: 96,
      range: { ...protection.range, endColumnIndex: 7 },
      editors: { users: ['ops@example.com'] },
    }],
  }, SERVICE);
  const update = (requests.find((item) => 'updateProtectedRange' in item) as any).updateProtectedRange;
  assert.deepEqual(update.protectedRange.editors.users, [SERVICE, 'ops@example.com']);
});

// --- RELEASE-04 Stage 1: classification + planner (read-only) --------------

test('classifyLayoutResources counts managed, legacy and unmanaged resources', () => {
  const converged = convergedEmails();
  const clean = classifyLayoutResources('emails', 42, converged, SERVICE);
  assert.equal(clean.conditionalFormats.unmanaged, 0);
  assert.equal(clean.bandings.unmanaged, 0);
  assert.equal(clean.basicFilter, 'managed');

  const legacy = classifyLayoutResources('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
    basicFilter: { range: { sheetId: 42, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 } },
  }, SERVICE);
  assert.equal(legacy.basicFilter, 'legacy_managed');
});

test('buildGoogleSheetVisualRepairRequests only touches frozen panes and column widths and is idempotent', () => {
  const actual: ActualGoogleSheetLayout = {
    properties: { sheetId: 42, gridProperties: { rowCount: 197, columnCount: 8, frozenRowCount: 0, frozenColumnCount: 1 } },
    data: [{ columnMetadata: [
      { pixelSize: 111 }, { pixelSize: 262 }, { pixelSize: 254 }, { pixelSize: 125 },
      { pixelSize: 115 }, { pixelSize: 190 }, { pixelSize: 306 }, { pixelSize: 535 },
    ] }],
  };
  const before = structuredClone(actual);
  const requests = buildGoogleSheetVisualRepairRequests('emails', 42, actual);
  assert.deepEqual(actual, before);
  assert.equal(requests.every((item) => 'updateSheetProperties' in item || 'updateDimensionProperties' in item), true);
  assert.equal(requests.some((item) => 'deleteBanding' in item || 'setBasicFilter' in item
    || 'deleteConditionalFormatRule' in item || 'addProtectedRange' in item), false);

  const converged: ActualGoogleSheetLayout = {
    properties: { sheetId: 42, gridProperties: { rowCount: 197, columnCount: 8, frozenRowCount: 1, frozenColumnCount: 1 } },
    data: [{ columnMetadata: GOOGLE_SHEET_LAYOUTS.emails.widths.map((pixelSize, index) => ({
      pixelSize, hiddenByUser: GOOGLE_SHEET_LAYOUTS.emails.hiddenColumns.includes(index),
    })) }],
  };
  assert.deepEqual(buildGoogleSheetVisualRepairRequests('emails', 42, converged), []);
});

test('buildGoogleSheetVisualRepairRequests reports incomplete column metadata', () => {
  assert.throws(() => buildGoogleSheetVisualRepairRequests('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 10, columnCount: 8 } },
  }), /LAYOUT_COLUMN_METADATA_INCOMPLETE/);
});

test('buildLegacyEmailsConvergencePlan deletes the legacy banding before adding the 8-column one', () => {
  const desired = buildGoogleSheetLayoutRequests('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
  }, SERVICE);
  const banding = structuredClone((desired.find((item) => 'addBanding' in item) as any).addBanding.bandedRange);
  const plan = buildLegacyEmailsConvergencePlan(42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
    bandedRanges: [{ ...banding, bandedRangeId: 91, range: { ...banding.range, endColumnIndex: 7 } }],
    basicFilter: { range: { sheetId: 42, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 } },
  });
  const deleteIndex = plan.findIndex((item) => 'deleteBanding' in item);
  const addIndex = plan.findIndex((item) => 'addBanding' in item);
  assert.ok(deleteIndex !== -1 && addIndex !== -1 && deleteIndex < addIndex);
  assert.equal(plan.some((item) => 'setBasicFilter' in item), true);
});

test('buildGoogleSheetLayoutPlan is read-only: converged, drift and legacy states all report remoteMutations 0', () => {
  const converged = buildGoogleSheetLayoutPlan('emails', 42, convergedEmails(), SERVICE);
  assert.equal(converged.driftStatus, 'converged');
  assert.equal(converged.remoteMutations, 0);
  assert.equal(converged.structuralRequestCount, 0);

  const drift = buildGoogleSheetLayoutPlan('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
    conditionalFormats: [{
      ranges: [{ sheetId: 42, startRowIndex: 1, endRowIndex: 189, startColumnIndex: 2, endColumnIndex: 3 }],
      booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'x' }] }, format: {} },
    }],
  }, SERVICE);
  assert.equal(drift.driftStatus, 'drift_detected');
  assert.equal(drift.remoteMutations, 0);

  const legacy = buildGoogleSheetLayoutPlan('emails', 42, {
    properties: { sheetId: 42, gridProperties: { rowCount: 189, columnCount: 8 } },
    basicFilter: { range: { sheetId: 42, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 } },
  }, SERVICE);
  assert.equal(legacy.driftStatus, 'legacy_migration');
  assert.equal(legacy.remoteMutations, 0);
  assert.ok(legacy.legacyConvergenceRequestCount >= 1);
});
