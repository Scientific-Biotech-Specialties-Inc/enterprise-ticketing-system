<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Services\TicketDashboardService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

/**
 * Report export endpoint (spec 0029 AC-14, AC-16, AC-17). The dashboard service is mocked so these tests
 * check what the endpoint does with a snapshot: validation, role and branch checks, formats and parity.
 */
class ReportExportControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected Employee $admin;
    protected Employee $technician;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');

        DB::table('employees')->whereIn('email', ['admin.export.0029@example.com', 'tech.export.0029@example.com'])->delete();

        $this->admin = Employee::create([
            'emp_id' => 89501,
            'first_name' => 'Ada',
            'last_name' => 'Export',
            'email' => 'admin.export.0029@example.com',
            'role' => 'admin',
            'department' => 'Operations',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);

        $this->technician = Employee::create([
            'emp_id' => 89502,
            'first_name' => 'Tom',
            'last_name' => 'Tech',
            'email' => 'tech.export.0029@example.com',
            'role' => 'technician',
            'department' => 'Service',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);
    }

    private function snapshot(int $rows = 3): array
    {
        $data = [];
        for ($i = 1; $i <= $rows; $i++) {
            $data[] = ['Ticket ID' => "TKTS-{$i}", 'Subject' => "Issue {$i}"];
        }

        return [
            'status' => 'success',
            'report_type' => 'ticket_volume',
            'count' => $rows,
            'branch' => ['name' => 'Main Branch'],
            'period' => ['preset' => 'Last 30 Days', 'date_from' => '2026-10-06', 'date_to' => '2026-11-04'],
            'headers' => ['Ticket ID', 'Subject'],
            'rows' => $data,
        ];
    }

    private function mockService(array $snapshot): void
    {
        $mock = Mockery::mock(TicketDashboardService::class);
        $mock->shouldReceive('getAdminReports')->andReturn($snapshot);
        $this->app->instance(TicketDashboardService::class, $mock);
    }

    public function test_csv_export_returns_the_same_rows_as_the_preview_snapshot(): void
    {
        $this->mockService($this->snapshot(3));

        $response = $this->actingAs($this->admin, 'api')
            ->postJson('/api/admin/reports/export', ['report_type' => 'ticket_volume', 'format' => 'csv', 'filters' => ['preset' => 'Last 30 Days']])
            ->assertOk()
            ->assertHeader('X-Report-Row-Count', '3');

        $this->assertStringContainsString('text/csv', $response->headers->get('Content-Type'));
        $this->assertStringContainsString('attachment; filename="ticket_volume_', $response->headers->get('Content-Disposition'));
        $this->assertSame(4, count(preg_split('/\r?\n/', trim($response->getContent()))));
    }

    public function test_xlsx_and_pdf_exports_return_valid_files_with_the_same_row_count(): void
    {
        $this->mockService($this->snapshot(2));

        $xlsx = $this->actingAs($this->admin, 'api')
            ->postJson('/api/admin/reports/export', ['report_type' => 'ticket_volume', 'format' => 'xlsx'])
            ->assertOk()
            ->assertHeader('X-Report-Row-Count', '2');
        $this->assertStringStartsWith('PK', $xlsx->getContent());

        $pdf = $this->actingAs($this->admin, 'api')
            ->postJson('/api/admin/reports/export', ['report_type' => 'ticket_volume', 'format' => 'pdf'])
            ->assertOk()
            ->assertHeader('X-Report-Row-Count', '2');
        $this->assertStringStartsWith('%PDF', $pdf->getContent());
    }

    public function test_unknown_report_type_or_format_is_rejected_with_422(): void
    {
        $this->mockService($this->snapshot());

        $this->actingAs($this->admin, 'api')
            ->postJson('/api/admin/reports/export', ['report_type' => 'bogus', 'format' => 'csv'])
            ->assertStatus(422);

        $this->actingAs($this->admin, 'api')
            ->postJson('/api/admin/reports/export', ['report_type' => 'ticket_volume', 'format' => 'docx'])
            ->assertStatus(422);
    }

    public function test_non_admin_role_is_forbidden(): void
    {
        $this->mockService($this->snapshot());

        $this->actingAs($this->technician, 'api')
            ->postJson('/api/admin/reports/export', ['report_type' => 'ticket_volume', 'format' => 'csv'])
            ->assertStatus(403);
    }

    public function test_cross_branch_request_is_forbidden_with_a_clean_message(): void
    {
        $mock = Mockery::mock(TicketDashboardService::class);
        $mock->shouldReceive('getAdminReports')->andThrow(new HttpException(403, 'Access denied: You are restricted to your assigned branch scope.'));
        $this->app->instance(TicketDashboardService::class, $mock);

        $response = $this->actingAs($this->admin, 'api')
            ->postJson('/api/admin/reports/export', ['report_type' => 'ticket_volume', 'format' => 'csv', 'filters' => ['branch_id' => 999]])
            ->assertStatus(403);

        $this->assertArrayNotHasKey('trace', $response->json());
        $this->assertSame('Access denied: You are restricted to your assigned branch scope.', $response->json('message'));
    }

    public function test_export_over_the_row_ceiling_returns_422_instead_of_a_huge_file(): void
    {
        putenv('PDF_MAX_ROWS=2');
        $_ENV['PDF_MAX_ROWS'] = '2';
        try {
            $this->mockService($this->snapshot(3));

            $this->actingAs($this->admin, 'api')
                ->postJson('/api/admin/reports/export', ['report_type' => 'ticket_volume', 'format' => 'pdf'])
                ->assertStatus(422)
                ->assertJsonPath('row_count', 3);
        } finally {
            putenv('PDF_MAX_ROWS');
            unset($_ENV['PDF_MAX_ROWS']);
        }
    }

    public function test_unauthenticated_request_is_rejected(): void
    {
        $this->postJson('/api/admin/reports/export', ['report_type' => 'ticket_volume', 'format' => 'csv'])
            ->assertStatus(401);
    }
}
