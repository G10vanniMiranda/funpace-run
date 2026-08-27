export type GoogleSheetLayoutKey =
  | 'registrations'
  | 'payments'
  | 'shirts'
  | 'check_in'
  | 'lots'
  | 'alerts'
  | 'partnerships'
  | 'emails'
  | 'remarketing'
  | 'confirmed_payments';

type StatusPalette = 'success' | 'warning' | 'error' | 'info' | 'inactive';

type ConditionalStatusRule = {
  columnIndex: number;
  palette: StatusPalette;
  values?: string[];
  customFormula?: string;
};

export type GoogleSheetLayout = {
  columnCount: number;
  widths: number[];
  hiddenColumns: number[];
  freezeRows: number;
  freezeColumns: number;
  filter: boolean;
  dateColumns: number[];
  numberFormats: Array<{ columnIndex: number; pattern: string; type: 'DATE_TIME' | 'CURRENCY' | 'NUMBER' }>;
  centeredColumns: number[];
  wrappedColumns: number[];
  checkboxColumns: number[];
  headerNotes: Record<number, string>;
  conditionalFormatting: ConditionalStatusRule[];
  rowHeight: number;
  headerHeight: number;
};

export type ActualGoogleSheetLayout = {
  properties?: {
    sheetId?: number;
    title?: string;
    gridProperties?: {
      rowCount?: number;
      columnCount?: number;
      frozenRowCount?: number;
      frozenColumnCount?: number;
    };
  };
  basicFilter?: Record<string, unknown>;
  protectedRanges?: Array<Record<string, unknown>>;
  conditionalFormats?: Array<Record<string, unknown>>;
  bandedRanges?: Array<Record<string, unknown>>;
  data?: Array<{
    columnMetadata?: Array<{ pixelSize?: number; hiddenByUser?: boolean }>;
    rowMetadata?: Array<{ pixelSize?: number; hiddenByUser?: boolean }>;
  }>;
};

export type GoogleSheetsBatchRequest = Record<string, unknown>;

const HEADER_BACKGROUND = '#17324D';
const BODY_ODD = '#FFFFFF';
const BODY_EVEN = '#F8FAFC';
const STATUS_COLORS: Record<StatusPalette, { background: string; text: string }> = {
  success: { background: '#DCFCE7', text: '#166534' },
  warning: { background: '#FEF3C7', text: '#92400E' },
  error: { background: '#FEE2E2', text: '#991B1B' },
  info: { background: '#DBEAFE', text: '#1E40AF' },
  inactive: { background: '#E5E7EB', text: '#374151' },
};

const technicalIdNote = 'Campo técnico de integração. Não editar, renomear ou remover.';

export const GOOGLE_SHEET_LAYOUTS: Record<GoogleSheetLayoutKey, GoogleSheetLayout> = {
  registrations: {
    columnCount: 14,
    widths: [155, 135, 220, 115, 125, 235, 100, 90, 80, 105, 105, 145, 190, 190],
    hiddenColumns: [12, 13], freezeRows: 1, freezeColumns: 3, filter: true,
    dateColumns: [0],
    numberFormats: [
      { columnIndex: 0, pattern: 'dd/mm/yyyy hh:mm', type: 'DATE_TIME' },
      { columnIndex: 10, pattern: 'R$ #,##0.00', type: 'CURRENCY' },
    ],
    centeredColumns: [1, 6, 7, 8, 9], wrappedColumns: [], checkboxColumns: [],
    headerNotes: { 12: technicalIdNote, 13: technicalIdNote },
    conditionalFormatting: [
      { columnIndex: 1, palette: 'success', values: ['paid'] },
      { columnIndex: 1, palette: 'warning', values: ['pending_payment'] },
      { columnIndex: 1, palette: 'error', values: ['expired', 'payment_failed'] },
      { columnIndex: 1, palette: 'inactive', values: ['cancelled', 'refunded'] },
    ],
    rowHeight: 26, headerHeight: 32,
  },
  payments: {
    columnCount: 8,
    widths: [155, 190, 190, 135, 135, 105, 120, 190],
    hiddenColumns: [1, 2, 7], freezeRows: 1, freezeColumns: 1, filter: true,
    dateColumns: [0],
    numberFormats: [
      { columnIndex: 0, pattern: 'dd/mm/yyyy hh:mm', type: 'DATE_TIME' },
      { columnIndex: 5, pattern: 'R$ #,##0.00', type: 'CURRENCY' },
    ],
    centeredColumns: [3, 4, 6], wrappedColumns: [], checkboxColumns: [],
    headerNotes: { 1: technicalIdNote, 2: technicalIdNote, 7: technicalIdNote },
    conditionalFormatting: [
      { columnIndex: 3, palette: 'success', values: ['paid'] },
      { columnIndex: 3, palette: 'warning', values: ['pending_payment'] },
      { columnIndex: 3, palette: 'error', values: ['expired', 'payment_failed'] },
      { columnIndex: 3, palette: 'inactive', values: ['cancelled', 'refunded'] },
    ],
    rowHeight: 26, headerHeight: 32,
  },
  shirts: {
    columnCount: 2, widths: [110, 110], hiddenColumns: [], freezeRows: 1, freezeColumns: 0, filter: false,
    dateColumns: [], numberFormats: [], centeredColumns: [0, 1], wrappedColumns: [], checkboxColumns: [],
    headerNotes: {}, conditionalFormatting: [], rowHeight: 26, headerHeight: 32,
  },
  check_in: {
    columnCount: 8,
    widths: [220, 115, 90, 80, 110, 155, 180, 190],
    hiddenColumns: [7], freezeRows: 1, freezeColumns: 2, filter: true,
    dateColumns: [5], numberFormats: [{ columnIndex: 5, pattern: 'dd/mm/yyyy hh:mm', type: 'DATE_TIME' }],
    centeredColumns: [2, 3, 4], wrappedColumns: [], checkboxColumns: [],
    headerNotes: { 7: technicalIdNote },
    conditionalFormatting: [
      { columnIndex: 4, palette: 'success', values: ['Sim'] },
      { columnIndex: 4, palette: 'warning', values: ['Não'] },
    ],
    rowHeight: 26, headerHeight: 32,
  },
  lots: {
    columnCount: 7,
    widths: [120, 105, 90, 105, 105, 110, 155],
    hiddenColumns: [], freezeRows: 1, freezeColumns: 1, filter: false,
    dateColumns: [6],
    numberFormats: [
      { columnIndex: 5, pattern: '0.0"%"', type: 'NUMBER' },
      { columnIndex: 6, pattern: 'dd/mm/yyyy hh:mm', type: 'DATE_TIME' },
    ],
    centeredColumns: [1, 2, 3, 4, 5], wrappedColumns: [], checkboxColumns: [],
    headerNotes: { 5: 'O valor 99 representa 99%. O formato usa percentual literal para não converter 99 em 9900%.' },
    conditionalFormatting: [], rowHeight: 26, headerHeight: 32,
  },
  alerts: {
    columnCount: 8,
    widths: [105, 170, 260, 125, 150, 165, 155, 190],
    hiddenColumns: [7], freezeRows: 1, freezeColumns: 3, filter: true,
    dateColumns: [6], numberFormats: [{ columnIndex: 6, pattern: 'dd/mm/yyyy hh:mm', type: 'DATE_TIME' }],
    centeredColumns: [0, 3], wrappedColumns: [2], checkboxColumns: [],
    headerNotes: { 7: technicalIdNote },
    conditionalFormatting: [
      { columnIndex: 0, palette: 'error', values: ['critical'] },
      { columnIndex: 0, palette: 'warning', values: ['warning'] },
      { columnIndex: 0, palette: 'info', values: ['info'] },
      { columnIndex: 3, palette: 'warning', values: ['open'] },
      { columnIndex: 3, palette: 'info', values: ['acknowledged'] },
      { columnIndex: 3, palette: 'success', values: ['resolved'] },
    ],
    rowHeight: 26, headerHeight: 32,
  },
  partnerships: {
    columnCount: 8,
    widths: [200, 180, 145, 225, 130, 130, 155, 190],
    hiddenColumns: [7], freezeRows: 1, freezeColumns: 2, filter: true,
    dateColumns: [6], numberFormats: [{ columnIndex: 6, pattern: 'dd/mm/yyyy hh:mm', type: 'DATE_TIME' }],
    centeredColumns: [4, 5], wrappedColumns: [], checkboxColumns: [],
    headerNotes: { 7: technicalIdNote },
    conditionalFormatting: [
      { columnIndex: 4, palette: 'success', values: ['approved'] },
      { columnIndex: 4, palette: 'warning', values: ['new', 'negotiating'] },
      { columnIndex: 4, palette: 'info', values: ['contacted'] },
      { columnIndex: 4, palette: 'inactive', values: ['rejected'] },
    ],
    rowHeight: 26, headerHeight: 32,
  },
  emails: {
    columnCount: 8,
    widths: [155, 190, 235, 125, 115, 190, 260, 190],
    hiddenColumns: [1, 5, 7], freezeRows: 1, freezeColumns: 1, filter: true,
    dateColumns: [0], numberFormats: [{ columnIndex: 0, pattern: 'dd/mm/yyyy hh:mm', type: 'DATE_TIME' }],
    centeredColumns: [3, 4], wrappedColumns: [6], checkboxColumns: [],
    headerNotes: { 1: technicalIdNote, 5: technicalIdNote, 7: technicalIdNote },
    conditionalFormatting: [
      { columnIndex: 3, palette: 'success', values: ['enviado'] },
      { columnIndex: 3, palette: 'warning', values: ['tentando'] },
      { columnIndex: 3, palette: 'error', values: ['falhou'] },
    ],
    rowHeight: 26, headerHeight: 32,
  },
  remarketing: {
    columnCount: 22,
    widths: [190, 190, 220, 125, 235, 115, 155, 155, 155, 105, 105, 90, 145, 145, 105, 105, 180, 190, 90, 135, 155, 155],
    hiddenColumns: [0, 1, 6, 20, 21], freezeRows: 1, freezeColumns: 3, filter: true,
    dateColumns: [6, 7, 8, 20, 21],
    numberFormats: [
      { columnIndex: 6, pattern: 'dd/mm/yyyy hh:mm', type: 'DATE_TIME' },
      { columnIndex: 7, pattern: 'dd/mm/yyyy hh:mm', type: 'DATE_TIME' },
      { columnIndex: 8, pattern: 'dd/mm/yyyy hh:mm', type: 'DATE_TIME' },
      { columnIndex: 9, pattern: 'R$ #,##0.00', type: 'CURRENCY' },
      { columnIndex: 20, pattern: 'dd/mm/yyyy hh:mm', type: 'DATE_TIME' },
      { columnIndex: 21, pattern: 'dd/mm/yyyy hh:mm', type: 'DATE_TIME' },
    ],
    centeredColumns: [10, 11, 14, 15, 18], wrappedColumns: [], checkboxColumns: [18],
    headerNotes: {
      0: 'Chave técnica estável da pessoa no Remarketing. Não editar ou remover.',
      1: 'Inscrição mais recente usada como referência da projeção. Não editar ou remover.',
      6: 'Primeira inscrição associada à pessoa. Campo estrutural obrigatório.',
      20: 'Última verificação de pagamento executada pelo sistema.',
      21: 'Última alteração relevante observada na projeção.',
    },
    conditionalFormatting: [
      { columnIndex: 12, palette: 'success', values: ['paid'] },
      { columnIndex: 12, palette: 'warning', values: ['pending_payment'] },
      { columnIndex: 12, palette: 'error', values: ['expired', 'payment_failed'] },
      { columnIndex: 12, palette: 'inactive', values: ['cancelled', 'refunded'] },
      { columnIndex: 13, palette: 'success', values: ['paid'] },
      { columnIndex: 13, palette: 'warning', values: ['pending_payment'] },
      { columnIndex: 13, palette: 'error', values: ['expired', 'payment_failed'] },
      { columnIndex: 13, palette: 'inactive', values: ['cancelled', 'refunded'] },
      { columnIndex: 17, palette: 'success', values: ['PAGAMENTO_CONFIRMADO'] },
      { columnIndex: 17, palette: 'warning', values: ['PAGAMENTO_PENDENTE', 'ABANDONOU_CHECKOUT'] },
      { columnIndex: 17, palette: 'error', values: ['PAGAMENTO_EXPIROU', 'PAGAMENTO_FALHOU'] },
      { columnIndex: 18, palette: 'info', customFormula: '=$S2=TRUE' },
      { columnIndex: 19, palette: 'inactive', values: ['PAID', 'TEST', 'ADMIN_CANCELLED'] },
    ],
    rowHeight: 26, headerHeight: 32,
  },
  confirmed_payments: {
    columnCount: 19,
    widths: [155, 220, 115, 125, 235, 90, 80, 105, 95, 105, 135, 180, 145, 180, 105, 105, 190, 190, 145],
    hiddenColumns: [16, 17, 18], freezeRows: 1, freezeColumns: 2, filter: true,
    dateColumns: [0],
    numberFormats: [
      { columnIndex: 0, pattern: 'dd/mm/yyyy hh:mm', type: 'DATE_TIME' },
      { columnIndex: 9, pattern: 'R$ #,##0.00', type: 'CURRENCY' },
      { columnIndex: 15, pattern: 'R$ #,##0.00', type: 'CURRENCY' },
    ],
    centeredColumns: [5, 6, 7, 8, 10, 12, 14], wrappedColumns: [], checkboxColumns: [],
    headerNotes: { 16: technicalIdNote, 17: technicalIdNote, 18: technicalIdNote },
    conditionalFormatting: [], rowHeight: 26, headerHeight: 32,
  },
};

function rgb(hex: string) {
  const normalized = hex.replace('#', '');
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16) / 255,
    green: Number.parseInt(normalized.slice(2, 4), 16) / 255,
    blue: Number.parseInt(normalized.slice(4, 6), 16) / 255,
  };
}

function gridRange(sheetId: number, startColumnIndex: number, endColumnIndex: number, startRowIndex = 0) {
  return { sheetId, startRowIndex, startColumnIndex, endColumnIndex };
}

function desiredConditionalFormats(layout: GoogleSheetLayout, sheetId: number, rowCount: number) {
  return layout.conditionalFormatting.flatMap((rule) => {
    const colors = STATUS_COLORS[rule.palette];
    const conditions = rule.customFormula
      ? [{ type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: rule.customFormula }] }]
      : (rule.values || []).map((value) => ({ type: 'TEXT_EQ', values: [{ userEnteredValue: value }] }));
    return conditions.map((condition) => ({
      ranges: [{ ...gridRange(sheetId, rule.columnIndex, rule.columnIndex + 1, 1), endRowIndex: rowCount }],
      booleanRule: {
        condition,
        format: {
          backgroundColorStyle: { rgbColor: rgb(colors.background) },
          textFormat: { foregroundColorStyle: { rgbColor: rgb(colors.text) } },
        },
      },
    }));
  });
}

function canonicalRange(value: unknown) {
  const range = (value || {}) as Record<string, unknown>;
  return {
    sheetId: range.sheetId,
    startRowIndex: range.startRowIndex || 0,
    endRowIndex: range.endRowIndex ?? null,
    startColumnIndex: range.startColumnIndex || 0,
    endColumnIndex: range.endColumnIndex ?? null,
  };
}

function canonicalColor(value: unknown) {
  const color = ((value as { rgbColor?: Record<string, unknown> } | undefined)?.rgbColor || value || {}) as Record<string, unknown>;
  return {
    red: Number(color.red || 0),
    green: Number(color.green || 0),
    blue: Number(color.blue || 0),
  };
}

function canonicalConditionalFormat(value: Record<string, unknown>) {
  const booleanRule = (value.booleanRule || {}) as Record<string, unknown>;
  const condition = (booleanRule.condition || {}) as Record<string, unknown>;
  const format = (booleanRule.format || {}) as Record<string, unknown>;
  const textFormat = (format.textFormat || {}) as Record<string, unknown>;
  return {
    ranges: ((value.ranges || []) as unknown[]).map(canonicalRange),
    condition: {
      type: condition.type,
      values: ((condition.values || []) as Array<Record<string, unknown>>).map((item) => item.userEnteredValue),
    },
    background: canonicalColor(format.backgroundColorStyle || format.backgroundColor),
    text: canonicalColor(textFormat.foregroundColorStyle || textFormat.foregroundColor),
  };
}

function conditionalFormatsMatch(actual: Array<Record<string, unknown>>, desired: Array<Record<string, unknown>>) {
  return JSON.stringify(actual.map(canonicalConditionalFormat)) === JSON.stringify(desired.map(canonicalConditionalFormat));
}

function sameManagedProtection(actual: Record<string, unknown>, desired: Record<string, unknown>) {
  const actualEditors = (actual.editors || {}) as { users?: string[] };
  const desiredEditors = (desired.editors || {}) as { users?: string[] };
  return actual.description === desired.description
    && actual.warningOnly !== true
    && JSON.stringify(canonicalRange(actual.range)) === JSON.stringify(canonicalRange(desired.range))
    && (desiredEditors.users || []).every((user) => (actualEditors.users || []).includes(user));
}

function bandingMatches(actual: Record<string, unknown>, desired: Record<string, unknown>) {
  const actualRows = (actual.rowProperties || {}) as Record<string, unknown>;
  const desiredRows = (desired.rowProperties || {}) as Record<string, unknown>;
  return JSON.stringify(canonicalRange(actual.range)) === JSON.stringify(canonicalRange(desired.range))
    && JSON.stringify({
      first: canonicalColor((actualRows.firstBandColorStyle || actualRows.firstBandColor) as unknown),
      second: canonicalColor((actualRows.secondBandColorStyle || actualRows.secondBandColor) as unknown),
    }) === JSON.stringify({
      first: canonicalColor((desiredRows.firstBandColorStyle || desiredRows.firstBandColor) as unknown),
      second: canonicalColor((desiredRows.secondBandColorStyle || desiredRows.secondBandColor) as unknown),
    });
}

export function googleSheetsDateSerial(value: string, timeZone = 'America/Manaus') {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const localWallClockUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return localWallClockUtc / 86_400_000 + 25_569;
}

export function buildGoogleSheetLayoutRequests(
  sheetKey: GoogleSheetLayoutKey,
  sheetId: number,
  actual: ActualGoogleSheetLayout,
  serviceAccountEmail: string,
  dataRowCount = Math.max((actual.properties?.gridProperties?.rowCount || 1) - 1, 0),
) {
  const layout = GOOGLE_SHEET_LAYOUTS[sheetKey];
  const requests: GoogleSheetsBatchRequest[] = [];
  const rowCount = Math.max(actual.properties?.gridProperties?.rowCount || 1000, 2);

  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: layout.freezeRows, frozenColumnCount: layout.freezeColumns },
      },
      fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
    },
  });

  if (layout.filter) {
    requests.push({ setBasicFilter: { filter: { range: gridRange(sheetId, 0, layout.columnCount) } } });
  } else if (actual.basicFilter) {
    requests.push({ clearBasicFilter: { sheetId } });
  }

  layout.widths.forEach((pixelSize, columnIndex) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: columnIndex, endIndex: columnIndex + 1 },
        properties: { pixelSize, hiddenByUser: layout.hiddenColumns.includes(columnIndex) },
        fields: 'pixelSize,hiddenByUser',
      },
    });
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: layout.headerHeight }, fields: 'pixelSize',
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: rowCount },
      properties: { pixelSize: layout.rowHeight }, fields: 'pixelSize',
    },
  });
  requests.push({
    repeatCell: {
      range: gridRange(sheetId, 0, layout.columnCount),
      cell: { userEnteredFormat: { textFormat: { fontFamily: 'Arial', fontSize: 10 }, verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat(textFormat.fontFamily,textFormat.fontSize,verticalAlignment)',
    },
  });
  requests.push({
    repeatCell: {
      range: { ...gridRange(sheetId, 0, layout.columnCount), endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          backgroundColorStyle: { rgbColor: rgb(HEADER_BACKGROUND) },
          textFormat: { fontFamily: 'Arial', fontSize: 10, bold: true, foregroundColorStyle: { rgbColor: rgb('#FFFFFF') } },
          verticalAlignment: 'MIDDLE', horizontalAlignment: 'LEFT', wrapStrategy: 'WRAP',
        },
      },
      fields: 'userEnteredFormat(backgroundColorStyle,textFormat,verticalAlignment,horizontalAlignment,wrapStrategy)',
    },
  });
  layout.numberFormats.forEach(({ columnIndex, pattern, type }) => {
    requests.push({
      repeatCell: {
        range: gridRange(sheetId, columnIndex, columnIndex + 1, 1),
        cell: { userEnteredFormat: { numberFormat: { type, pattern }, horizontalAlignment: 'RIGHT' } },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    });
  });
  layout.centeredColumns.forEach((columnIndex) => {
    requests.push({ repeatCell: {
      range: gridRange(sheetId, columnIndex, columnIndex + 1, 1),
      cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
      fields: 'userEnteredFormat.horizontalAlignment',
    } });
  });
  layout.wrappedColumns.forEach((columnIndex) => {
    requests.push({ repeatCell: {
      range: gridRange(sheetId, columnIndex, columnIndex + 1, 1),
      cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.wrapStrategy',
    } });
  });
  Object.entries(layout.headerNotes).forEach(([column, note]) => {
    const columnIndex = Number(column);
    requests.push({ updateCells: {
      range: { ...gridRange(sheetId, columnIndex, columnIndex + 1), endRowIndex: 1 },
      rows: [{ values: [{ note }] }], fields: 'note',
    } });
  });
  layout.checkboxColumns.forEach((columnIndex) => {
    requests.push({ setDataValidation: {
      range: gridRange(sheetId, columnIndex, columnIndex + 1, 1),
    } });
    if (dataRowCount === 0) return;
    requests.push({ setDataValidation: {
      range: { ...gridRange(sheetId, columnIndex, columnIndex + 1, 1), endRowIndex: dataRowCount + 1 },
      rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true },
    } });
  });

  const desiredConditional = desiredConditionalFormats(layout, sheetId, rowCount);
  const actualConditional = actual.conditionalFormats || [];
  if (!conditionalFormatsMatch(actualConditional, desiredConditional)) {
    for (let index = actualConditional.length - 1; index >= 0; index -= 1) {
      requests.push({ deleteConditionalFormatRule: { sheetId, index } });
    }
    desiredConditional.forEach((rule, index) => {
      requests.push({ addConditionalFormatRule: { rule, index } });
    });
  }

  const protectionDescription = `FUNPACE_MANAGED:${sheetKey}:synced-data`;
  const desiredProtection: Record<string, unknown> = {
    range: gridRange(sheetId, 0, layout.columnCount),
    description: protectionDescription,
    warningOnly: false,
    editors: { users: [serviceAccountEmail] },
  };
  const actualProtected = actual.protectedRanges || [];
  const managed = actualProtected.filter((item) => String(item.description || '').startsWith(`FUNPACE_MANAGED:${sheetKey}:`));
  const current = managed.find((item) => item.description === protectionDescription);
  for (const stale of managed.filter((item) => item !== current)) {
    if (typeof stale.protectedRangeId === 'number') requests.push({ deleteProtectedRange: { protectedRangeId: stale.protectedRangeId } });
  }
  if (!current) {
    requests.push({ addProtectedRange: { protectedRange: desiredProtection } });
  } else if (!sameManagedProtection(current, desiredProtection)) {
    requests.push({
      updateProtectedRange: {
        protectedRange: { ...desiredProtection, protectedRangeId: current.protectedRangeId },
        fields: 'range,description,warningOnly,editors',
      },
    });
  }

  const desiredBanding: Record<string, unknown> = {
    range: { ...gridRange(sheetId, 0, layout.columnCount, 1), endRowIndex: rowCount },
    rowProperties: {
      firstBandColorStyle: { rgbColor: rgb(BODY_ODD) },
      secondBandColorStyle: { rgbColor: rgb(BODY_EVEN) },
    },
  };
  const bandedRanges = actual.bandedRanges || [];
  const currentBanding = bandedRanges.find((item) => (
    JSON.stringify(canonicalRange(item.range)) === JSON.stringify(canonicalRange(desiredBanding.range))
  ));
  if (!currentBanding) {
    requests.push({ addBanding: { bandedRange: desiredBanding } });
  } else if (!bandingMatches(currentBanding, desiredBanding)) {
    requests.push({
      updateBanding: {
        bandedRange: { ...desiredBanding, bandedRangeId: currentBanding.bandedRangeId },
        fields: 'range,rowProperties',
      },
    });
  }

  return requests;
}
