function xmlEscape(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function createExcelXml(sheetName: string, headers: string[], rows: unknown[][]) {
  const rowXml = (row: unknown[], header = false) => `<Row>${row.map((cell) => `<Cell${header ? ' ss:StyleID="Header"' : ''}><Data ss:Type="${typeof cell === 'number' ? 'Number' : 'String'}">${xmlEscape(cell)}</Data></Cell>`).join('')}</Row>`;
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D7FF00" ss:Pattern="Solid"/></Style></Styles>
<Worksheet ss:Name="${xmlEscape(sheetName).slice(0, 31)}"><Table>${rowXml(headers, true)}${rows.map((row) => rowXml(row)).join('')}</Table></Worksheet></Workbook>`;
}

function pdfEscape(value: unknown) {
  return String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/([\\()])/g, '\\$1');
}

export function createSimplePdf(title: string, headers: string[], rows: unknown[][]) {
  const printable = [headers.join(' | '), ...rows.map((row) => row.join(' | '))];
  const pages = Array.from({ length: Math.max(Math.ceil(printable.length / 42), 1) }, (_, index) => printable.slice(index * 42, (index + 1) * 42));
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const pageIds: number[] = [];
  pages.forEach((lines, index) => {
    const pageId = 4 + index * 2; const contentId = pageId + 1; pageIds.push(pageId);
    const commands = [`BT /F1 13 Tf 36 806 Td (${pdfEscape(title)}) Tj`, '/F1 7 Tf 0 -22 Td'];
    lines.forEach((line) => { commands.push(`(${pdfEscape(line).slice(0, 145)}) Tj 0 -17 Td`); });
    commands.push('ET');
    const stream = commands.join('\n');
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  let output = '%PDF-1.4\n'; const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) { offsets[id] = Buffer.byteLength(output, 'latin1'); output += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const xref = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output, 'latin1');
}

