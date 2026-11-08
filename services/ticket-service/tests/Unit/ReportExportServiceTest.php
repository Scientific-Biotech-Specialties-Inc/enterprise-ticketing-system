<?php

namespace Tests\Unit;

use App\Services\ReportExportService;
use PHPUnit\Framework\TestCase;
use ZipArchive;

/**
 * Plain unit tests for the report export renderer (spec 0029 AC-16, AC-17).
 * They boot no app and use no database. PDF output is covered in the feature test.
 */
class ReportExportServiceTest extends TestCase
{
    private ReportExportService $service;

    protected function setUp(): void
    {
        $this->service = new ReportExportService();
    }

    private function report(array $rows, array $headers = ['Ticket ID', 'Subject']): array
    {
        return [
            'report_type' => 'ticket_volume',
            'count' => count($rows),
            'branch' => ['name' => 'Main Branch'],
            'period' => ['preset' => 'Last 30 Days', 'date_from' => '2026-10-06', 'date_to' => '2026-11-04'],
            'headers' => $headers,
            'rows' => $rows,
        ];
    }

    public function test_tabulate_follows_header_order_for_keyed_and_positional_rows(): void
    {
        [$headers, $rows] = $this->service->tabulate($this->report([
            ['Subject' => 'Printer down', 'Ticket ID' => 'TKTS-1'],
            ['TKTS-2', 'Router'],
        ]));

        $this->assertSame(['Ticket ID', 'Subject'], $headers);
        $this->assertSame([['TKTS-1', 'Printer down'], ['TKTS-2', 'Router']], $rows);
    }

    public function test_tabulate_turns_null_and_missing_values_into_empty_strings_and_encodes_arrays(): void
    {
        [, $rows] = $this->service->tabulate($this->report([
            ['Ticket ID' => null],
            ['Ticket ID' => 'TKTS-3', 'Subject' => ['a' => 1]],
        ]));

        $this->assertSame(['', ''], $rows[0]);
        $this->assertSame('{"a":1}', $rows[1][1]);
    }

    public function test_tabulate_handles_a_report_with_no_rows(): void
    {
        [$headers, $rows] = $this->service->tabulate($this->report([]));

        $this->assertSame(['Ticket ID', 'Subject'], $headers);
        $this->assertSame([], $rows);
    }

    public function test_csv_starts_with_bom_and_header_row_and_quotes_special_characters(): void
    {
        $csv = $this->service->toCsv($this->report([
            ['Ticket ID' => 'TKTS-1', 'Subject' => 'Says "hello", then fails'],
        ]));

        $this->assertStringStartsWith("\xEF\xBB\xBF", $csv);
        $lines = preg_split('/\r?\n/', trim(substr($csv, 3)));
        $this->assertSame('"Ticket ID",Subject', $lines[0]);
        $this->assertSame('TKTS-1,"Says ""hello"", then fails"', $lines[1]);
    }

    public function test_csv_and_xlsx_neutralise_spreadsheet_formulas(): void
    {
        $report = $this->report([['Ticket ID' => '=HYPERLINK("http://evil")', 'Subject' => '@SUM(A1)']]);

        $csv = $this->service->toCsv($report);
        $this->assertStringContainsString("'=HYPERLINK", $csv);
        $this->assertStringContainsString("'@SUM(A1)", $csv);

        $sheet = $this->sheetXml($this->service->toXlsx($report));
        // XML writes the leading apostrophe as &apos;, and the raw formula must not start a cell.
        $this->assertStringContainsString('&apos;=HYPERLINK', $sheet);
        $this->assertStringNotContainsString('<t xml:space="preserve">=HYPERLINK', $sheet);
    }

    public function test_xlsx_is_a_valid_zip_with_one_row_per_record_plus_header(): void
    {
        $binary = $this->service->toXlsx($this->report([
            ['Ticket ID' => 'TKTS-1', 'Subject' => 'A & B <c>'],
            ['Ticket ID' => 'TKTS-2', 'Subject' => 'Second'],
        ]));

        $this->assertStringStartsWith('PK', $binary);
        $sheet = $this->sheetXml($binary);
        $this->assertSame(3, substr_count($sheet, '<row '));
        $this->assertStringContainsString('A &amp; B &lt;c&gt;', $sheet);
        $this->assertStringContainsString('<dimension ref="A1:B3"/>', $sheet);
    }

    public function test_xlsx_column_letters_continue_past_z(): void
    {
        $headers = [];
        for ($i = 1; $i <= 28; $i++) {
            $headers[] = "H{$i}";
        }
        $sheet = $this->sheetXml($this->service->toXlsx($this->report([], $headers)));

        $this->assertStringContainsString('r="Z1"', $sheet);
        $this->assertStringContainsString('r="AA1"', $sheet);
        $this->assertStringContainsString('r="AB1"', $sheet);
    }

    public function test_xlsx_strips_control_characters_that_would_corrupt_the_file(): void
    {
        $sheet = $this->sheetXml($this->service->toXlsx($this->report([['Ticket ID' => "bad\x01value", 'Subject' => 'ok']])));

        $this->assertStringContainsString('badvalue', $sheet);
        $this->assertNotFalse(simplexml_load_string($sheet), 'Sheet XML must stay well formed');
    }

    public function test_filter_summary_and_filename_describe_the_snapshot(): void
    {
        $report = $this->report([['a', 'b']]);

        $summary = $this->service->filterSummary($report);
        $this->assertSame('Ticket Volume', $summary['Report']);
        $this->assertSame('Main Branch', $summary['Branch']);
        $this->assertStringContainsString('2026-10-06 to 2026-11-04', $summary['Period']);
        $this->assertSame('1', $summary['Rows']);

        $this->assertMatchesRegularExpression('/^ticket_volume_\d{8}_\d{6}\.csv$/', $this->service->filename($report, 'csv'));
    }

    public function test_allowed_report_types_and_formats_match_the_spec(): void
    {
        $this->assertEqualsCanonicalizing(
            ['ticket_volume', 'sla_compliance', 'department_performance', 'equipment_maintenance', 'csat_satisfaction', 'predictive_risk'],
            ReportExportService::REPORT_TYPES
        );
        $this->assertSame(['csv', 'xlsx', 'pdf'], ReportExportService::FORMATS);
    }

    private function sheetXml(string $binary): string
    {
        $tmp = tempnam(sys_get_temp_dir(), 'xlsxtest');
        file_put_contents($tmp, $binary);
        $zip = new ZipArchive();
        $this->assertTrue($zip->open($tmp) === true, 'XLSX must open as a zip');
        $xml = $zip->getFromName('xl/worksheets/sheet1.xml');
        $zip->close();
        @unlink($tmp);
        $this->assertIsString($xml);

        return $xml;
    }
}
