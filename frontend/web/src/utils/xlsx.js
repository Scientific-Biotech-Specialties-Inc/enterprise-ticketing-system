import { zipSync, strToU8 } from 'fflate';

/**
 * Minimal writer for genuine Office Open XML workbooks (.xlsx).
 *
 * The earlier export wrote "XML Spreadsheet 2003" text under an .xlsx name, which Excel warns about.
 * An .xlsx file is a zip of a few XML parts; this builds exactly those parts, so the file opens cleanly,
 * keeps real numbers as numbers, freezes the header row and has filter arrows on the header row
 * (sortable and filterable in Excel, spec 0029 AC-16).
 */

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// Style ids defined in styles.xml below.
const STYLE = { default: 0, header: 1, title: 2, metaLabel: 3 };

/** Escape text and drop characters that are not allowed in XML 1.0. */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 0 -> A, 25 -> Z, 26 -> AA */
export function columnLetter(index) {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Excel sheet names: at most 31 characters and none of  [ ] : * ? / \ */
export function safeSheetName(name) {
  const cleaned = String(name || 'Report').replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31);
  return cleaned || 'Report';
}

/** Only true numbers become numeric cells. Ids such as "0012" or "TKT-0005" stay text. */
function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text)) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function cell(ref, value, style = STYLE.default) {
  const num = style === STYLE.default ? asNumber(value) : null;
  if (num !== null) {
    return `<c r="${ref}" t="n"${style ? ` s="${style}"` : ''}><v>${num}</v></c>`;
  }
  const text = value === null || value === undefined ? '' : String(value);
  if (text === '') {
    return style ? `<c r="${ref}" s="${style}"/>` : '';
  }
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS_MAIN}">
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FF1E293B"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><color rgb="FF475569"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF252578"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * Build a single sheet workbook.
 *
 * @param {object} options
 * @param {string} [options.sheetName]
 * @param {string} [options.title]            Large title row at the top.
 * @param {Array<[string, string]>} [options.meta]  Label and value rows under the title (filters, timestamp).
 * @param {string[]} options.headers
 * @param {Array<Array<string|number|null>>} options.rows  Row arrays in the same order as headers.
 * @returns {Uint8Array} the .xlsx file bytes
 */
export function buildXlsx({ sheetName = 'Report', title = '', meta = [], headers, rows }) {
  const name = safeSheetName(sheetName);
  const sheetRows = [];
  let rowNumber = 0;

  if (title) {
    rowNumber += 1;
    sheetRows.push(`<row r="${rowNumber}">${cell(`A${rowNumber}`, title, STYLE.title)}</row>`);
  }
  meta.forEach(([label, value]) => {
    rowNumber += 1;
    sheetRows.push(
      `<row r="${rowNumber}">${cell(`A${rowNumber}`, label, STYLE.metaLabel)}${cell(`B${rowNumber}`, value, STYLE.metaLabel)}</row>`
    );
  });
  if (title || meta.length) rowNumber += 1; // one blank row before the table

  const headerRow = rowNumber + 1;
  rowNumber = headerRow;
  sheetRows.push(
    `<row r="${headerRow}">${headers.map((h, i) => cell(`${columnLetter(i)}${headerRow}`, h, STYLE.header)).join('')}</row>`
  );

  rows.forEach((values) => {
    rowNumber += 1;
    const cells = headers.map((_, i) => cell(`${columnLetter(i)}${rowNumber}`, values[i]));
    sheetRows.push(`<row r="${rowNumber}">${cells.join('')}</row>`);
  });

  const lastCol = columnLetter(Math.max(0, headers.length - 1));
  const lastRow = Math.max(headerRow, rowNumber);
  const tableRange = `A${headerRow}:${lastCol}${lastRow}`;

  // Column widths follow the longest value, within sensible limits.
  const widths = headers.map((h, i) => {
    const longest = rows.reduce((max, r) => Math.max(max, String(r[i] ?? '').length), String(h).length);
    return Math.min(60, Math.max(10, longest + 2));
  });
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">
<dimension ref="A1:${lastCol}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${sheetRows.join('')}</sheetData>
<autoFilter ref="${tableRange}"/>
</worksheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">
<sheets><sheet name="${escapeXml(name)}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${escapeXml(name).replace(/'/g, "''")}'!$A$${headerRow}:$${lastCol}$${lastRow}</definedName></definedNames>
</workbook>`;

  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(workbookXml),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': strToU8(STYLES_XML),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
  };

  return zipSync(files, { level: 6 });
}
