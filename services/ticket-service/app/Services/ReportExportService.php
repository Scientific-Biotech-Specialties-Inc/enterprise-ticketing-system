<?php

namespace App\Services;

use Barryvdh\DomPDF\Facade\Pdf;
use Carbon\Carbon;
use ZipArchive;

/**
 * Renders an operational report snapshot (the exact payload the preview shows) into CSV, XLSX or PDF.
 *
 * The preview and every export format read the same array returned by
 * TicketDashboardService::getAdminReports(), which guarantees snapshot parity (spec 0029 AC-17).
 */
class ReportExportService
{
    public const REPORT_TYPES = [
        'ticket_volume',
        'sla_compliance',
        'department_performance',
        'employee_performance',
        'equipment_maintenance',
        'csat_satisfaction',
        'predictive_risk',
    ];

    public const FORMATS = ['csv', 'xlsx', 'pdf'];

    /**
     * Normalise a report payload into [headers, rows] where each row is a positional list of scalar strings.
     *
     * @return array{0: array<int,string>, 1: array<int,array<int,string>>}
     */
    public function tabulate(array $report): array
    {
        $headers = array_values(array_map('strval', $report['headers'] ?? []));
        $rows = [];

        foreach (($report['rows'] ?? []) as $row) {
            $row = (array) $row;
            $cells = [];
            foreach ($headers as $i => $header) {
                $value = array_key_exists($header, $row) ? $row[$header] : ($row[$i] ?? '');
                $cells[] = is_scalar($value) || $value === null ? (string) ($value ?? '') : json_encode($value);
            }
            $rows[] = $cells;
        }

        return [$headers, $rows];
    }

    /**
     * Human readable filter summary shown in the PDF header.
     */
    public function filterSummary(array $report): array
    {
        $period = $report['period'] ?? [];
        $branch = $report['branch'] ?? [];

        return array_filter([
            'Report' => $this->reportTitle((string) ($report['report_type'] ?? '')),
            'Branch' => $branch['name'] ?? null,
            'Period' => trim(($period['preset'] ?? '') . ' (' . ($period['date_from'] ?? '') . ' to ' . ($period['date_to'] ?? '') . ')'),
            'Rows' => (string) ($report['count'] ?? 0),
        ], fn ($v) => $v !== null && $v !== '');
    }

    public function reportTitle(string $type): string
    {
        return ucwords(str_replace('_', ' ', $type));
    }

    public function filename(array $report, string $format): string
    {
        return sprintf('%s_%s.%s', $report['report_type'] ?? 'report', Carbon::now()->format('Ymd_His'), $format);
    }

    public function toCsv(array $report): string
    {
        [$headers, $rows] = $this->tabulate($report);

        $handle = fopen('php://temp', 'r+');
        fputcsv($handle, $headers);
        foreach ($rows as $cells) {
            fputcsv($handle, array_map([$this, 'neutraliseFormula'], $cells));
        }
        rewind($handle);
        $csv = stream_get_contents($handle);
        fclose($handle);

        return "\xEF\xBB\xBF" . $csv; // UTF-8 BOM so Excel opens accents correctly
    }

    /**
     * Build a minimal valid .xlsx workbook (a zip of XML parts) without an external spreadsheet library.
     */
    public function toXlsx(array $report): string
    {
        [$headers, $rows] = $this->tabulate($report);

        $all = array_merge([$headers], array_map(fn ($r) => array_map([$this, 'neutraliseFormula'], $r), $rows));
        $sheetRows = [];
        foreach ($all as $r => $cells) {
            $xml = '<row r="' . ($r + 1) . '">';
            foreach ($cells as $c => $value) {
                $xml .= '<c r="' . $this->columnLetter($c) . ($r + 1) . '" t="inlineStr"><is><t xml:space="preserve">'
                    . htmlspecialchars($this->stripControl($value), ENT_XML1 | ENT_QUOTES, 'UTF-8')
                    . '</t></is></c>';
            }
            $sheetRows[] = $xml . '</row>';
        }

        $lastCol = $this->columnLetter(max(0, count($headers) - 1));
        $lastRow = max(1, count($all));
        $sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . '<dimension ref="A1:' . $lastCol . $lastRow . '"/>'
            . '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            . '<sheetData>' . implode('', $sheetRows) . '</sheetData>'
            . '<autoFilter ref="A1:' . $lastCol . $lastRow . '"/>'
            . '</worksheet>';

        $xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
        $parts = [
            '[Content_Types].xml' => $xmlHead . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
            '_rels/.rels' => $xmlHead . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
            'xl/workbook.xml' => $xmlHead . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels' => $xmlHead . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
            'xl/worksheets/sheet1.xml' => $sheet,
        ];

        $tmp = tempnam(sys_get_temp_dir(), 'xlsx');
        $zip = new ZipArchive();
        $zip->open($tmp, ZipArchive::OVERWRITE);
        foreach ($parts as $name => $content) {
            $zip->addFromString($name, $content);
        }
        $zip->close();
        $binary = file_get_contents($tmp);
        @unlink($tmp);

        return $binary;
    }

    public function toPdf(array $report): string
    {
        [$headers, $rows] = $this->tabulate($report);
        $e = fn ($v) => htmlspecialchars($this->stripControl((string) $v), ENT_QUOTES, 'UTF-8');

        $html = '<html><head><meta charset="utf-8"><style>'
            . 'body{font-family:DejaVu Sans,sans-serif;font-size:9px;color:#1E293B}'
            . 'h1{color:#252578;font-size:16px;margin:0 0 8px}'
            . '.meta{color:#8D8B8F;margin-bottom:16px}.meta div{margin-bottom:2px}'
            . 'table{width:100%;border-collapse:collapse}'
            . 'th{background:#F8F9FA;color:#94A3B8;text-align:left;padding:6px;border-bottom:1px solid #e2e8f0}'
            . 'td{padding:6px;border-bottom:1px solid #f1f5f9}'
            . '@page{margin:32px 24px 40px 24px}'
            . '</style></head><body>'
            . '<h1>' . $e($this->reportTitle((string) ($report['report_type'] ?? 'report'))) . '</h1><div class="meta">';

        foreach ($this->filterSummary($report) as $label => $value) {
            $html .= '<div><strong>' . $e($label) . ':</strong> ' . $e($value) . '</div>';
        }
        $html .= '<div><strong>Generated:</strong> ' . $e(Carbon::now()->toDateTimeString()) . '</div></div>';

        $html .= '<table><thead><tr>';
        foreach ($headers as $h) {
            $html .= '<th>' . $e($h) . '</th>';
        }
        $html .= '</tr></thead><tbody>';
        foreach ($rows as $cells) {
            $html .= '<tr>';
            foreach ($cells as $cell) {
                $html .= '<td>' . $e($cell) . '</td>';
            }
            $html .= '</tr>';
        }
        $html .= '</tbody></table></body></html>';

        $pdf = Pdf::loadHTML($html)->setPaper('a4', count($headers) > 6 ? 'landscape' : 'portrait');
        $pdf->render();
        $dompdf = $pdf->getDomPDF();
        $canvas = $dompdf->getCanvas();
        $canvas->page_text(
            $canvas->get_width() - 90,
            $canvas->get_height() - 24,
            'Page {PAGE_NUM} of {PAGE_COUNT}',
            $dompdf->getFontMetrics()->get_font('helvetica', 'normal'),
            8,
            [0.55, 0.55, 0.55]
        );

        return $pdf->output();
    }

    /**
     * Stop spreadsheet applications from executing cells that begin with a formula character.
     */
    protected function neutraliseFormula(string $value): string
    {
        return $value !== '' && in_array($value[0], ['=', '+', '-', '@', "\t", "\r"], true) ? "'" . $value : $value;
    }

    protected function stripControl(string $value): string
    {
        return preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $value) ?? '';
    }

    protected function columnLetter(int $index): string
    {
        $letter = '';
        for ($i = $index; $i >= 0; $i = intdiv($i, 26) - 1) {
            $letter = chr(65 + ($i % 26)) . $letter;
        }

        return $letter;
    }
}
