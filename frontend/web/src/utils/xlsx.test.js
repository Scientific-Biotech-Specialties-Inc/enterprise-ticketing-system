import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildXlsx, columnLetter, escapeXml, safeSheetName } from './xlsx';

const open = (bytes) => {
  const files = unzipSync(bytes);
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
};

const sample = () =>
  buildXlsx({
    sheetName: 'Report',
    title: 'Employee Report',
    meta: [['Generated At:', '2026-11-04 10:00:00'], ['Branch Scope:', 'Main Branch']],
    headers: ['Name', 'Tickets', 'SLA %', 'Ticket Ref'],
    rows: [
      ['Ana & Co <Lead>', 12, '97.5', 'TKT-0005'],
      ['Ben', '8', null, '0012'],
    ],
  });

describe('xlsx writer (spec 0029 AC-16)', () => {
  it('produces a real Office Open XML package, not XML Spreadsheet 2003', () => {
    const parts = open(sample());

    expect(Object.keys(parts).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(parts['[Content_Types].xml']).toContain('spreadsheetml.sheet.main+xml');
    expect(parts['xl/workbook.xml']).toContain('<sheet name="Report" sheetId="1" r:id="rId1"/>');
    expect(Object.values(parts).join('')).not.toContain('urn:schemas-microsoft-com:office:spreadsheet');
  });

  it('starts with the zip signature so Excel recognises the file', () => {
    const bytes = sample();
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
  });

  it('keeps real numbers numeric and ids as text', () => {
    const sheet = open(sample())['xl/worksheets/sheet1.xml'];

    expect(sheet).toContain('t="n"><v>12</v>'); // number stays a number
    expect(sheet).toContain('t="n"><v>8</v>'); // numeric looking string becomes a number
    expect(sheet).toContain('t="n"><v>97.5</v>');
    expect(sheet).toMatch(/t="inlineStr"[^>]*><is><t[^>]*>TKT-0005</); // id stays text
    expect(sheet).toMatch(/t="inlineStr"[^>]*><is><t[^>]*>0012</); // leading zero is preserved
  });

  it('escapes markup characters in cell text', () => {
    const sheet = open(sample())['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('Ana &amp; Co &lt;Lead&gt;');
    expect(sheet).not.toContain('Ana & Co <Lead>');
  });

  it('puts the header below the title and filter rows, frozen and filterable', () => {
    const sheet = open(sample())['xl/worksheets/sheet1.xml'];
    // Title row 1, two meta rows, one blank row, header on row 5.
    expect(sheet).toContain('<row r="5">');
    expect(sheet).toContain('<pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<autoFilter ref="A5:D7"/>');
    expect(sheet).toContain('<dimension ref="A1:D7"/>');
  });

  it('registers the filter range in the workbook', () => {
    const workbook = open(sample())['xl/workbook.xml'];
    expect(workbook).toContain("'Report'!$A$5:$D$7");
  });

  it('writes an empty table with only the header when there are no rows', () => {
    const parts = open(buildXlsx({ headers: ['A', 'B'], rows: [] }));
    expect(parts['xl/worksheets/sheet1.xml']).toContain('<autoFilter ref="A1:B1"/>');
  });

  it('removes characters that are invalid in XML', () => {
    expect(escapeXml('a\u0000b\u0008c')).toBe('abc');
    expect(escapeXml('say "hi"')).toBe('say &quot;hi&quot;');
  });

  it('builds column letters and safe sheet names', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(safeSheetName('Q1/Q2: [draft]?')).toBe('Q1 Q2   draft');
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31);
    expect(safeSheetName('')).toBe('Report');
  });
});
