<?php

namespace Tests\Feature;

use App\Events\TicketNumberFormatUpdated;
use App\Models\Employee;
use App\Models\User;
use App\Services\TicketConfigurationService;
use App\Services\TicketNumberGeneratorService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class TicketNumberFormatTest extends TestCase
{
    protected Employee $superAdmin;
    protected Employee $regularEmployee;

    protected function setUp(): void
    {
        parent::setUp();

        // The number format now lives in configuration-service. Fake it statefully:
        // PUT stores and echoes the format, GET returns what was stored (503 before any save, so defaults apply).
        $stored = null;
        Http::fake([
            '*/api/ticket-configurations/number_format*' => function ($request) use (&$stored) {
                if (in_array($request->method(), ['PUT', 'PATCH'], true)) {
                    $stored = $request->data();
                    return Http::response(['value' => $stored], 200);
                }
                if ($request->method() === 'POST') { // reset
                    $stored = null;
                    return Http::response(['value' => \App\Services\TicketConfigurationService::DEFAULT_NUMBER_FORMAT], 200);
                }
                return $stored === null ? Http::response([], 503) : Http::response(['value' => $stored], 200);
            },
        ]);

        // Create or find a Super Admin employee for testing
        $superAdminRecord = DB::table('employees')->where('role', 'superadmin')->first();
        if (!$superAdminRecord) {
            $empId = DB::table('employees')->insertGetId([
                'first_name' => 'Super',
                'last_name' => 'Admin',
                'email' => 'superadmin@example.com',
                'role' => 'superadmin',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $this->superAdmin = Employee::find($empId);
        } else {
            $this->superAdmin = Employee::find($superAdminRecord->emp_id);
        }

        // Create or find a non-superadmin employee
        $techRecord = DB::table('employees')->where('role', 'technician')->first();
        if (!$techRecord) {
            $empId = DB::table('employees')->insertGetId([
                'first_name' => 'John',
                'last_name' => 'Technician',
                'email' => 'tech@example.com',
                'role' => 'technician',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $this->regularEmployee = Employee::find($empId);
        } else {
            $this->regularEmployee = Employee::find($techRecord->emp_id);
        }

        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateSubsystem::class);
    }

    /**
     * RBAC: Unauthenticated and non-superadmin users are rejected.
     */
    public function test_rbac_restricts_number_format_endpoints_to_superadmin(): void
    {
        // Unauthenticated
        $res = $this->getJson('/api/superadmin/number-format');
        $res->assertStatus(401);

        $res = $this->putJson('/api/superadmin/number-format', [
            'prefix' => 'TKT',
            'dateSegment' => 'none',
            'digitLength' => 4,
        ]);
        $res->assertStatus(401);

        // Non-superadmin authenticated user (role = technician)
        $res = $this->actingAs($this->regularEmployee)
            ->getJson('/api/superadmin/number-format');
        $res->assertStatus(403);

        $res = $this->actingAs($this->regularEmployee)
            ->putJson('/api/superadmin/number-format', [
                'prefix' => 'TKT',
                'dateSegment' => 'none',
                'digitLength' => 4,
            ]);
        $res->assertStatus(403);
    }

    /**
     * View endpoint returns active format configuration for superadmin.
     */
    public function test_superadmin_can_view_ticket_number_format(): void
    {
        $res = $this->actingAs($this->superAdmin)
            ->getJson('/api/superadmin/number-format');

        $res->assertStatus(200)
            ->assertJsonStructure([
                'key',
                'value' => [
                    'prefix',
                    'includeDeptCode',
                    'deptCode',
                    'dateSegment',
                    'digitLength',
                ],
            ]);
    }

    /**
     * Validation rejects configurations without a sequential component or invalid values.
     */
    public function test_format_validation_rejects_missing_or_invalid_sequential_digit_length(): void
    {
        // Missing digitLength (sequential component)
        $res = $this->actingAs($this->superAdmin)
            ->putJson('/api/superadmin/number-format', [
                'prefix' => 'TKT',
                'includeDeptCode' => false,
                'dateSegment' => 'YYYY',
            ]);
        $res->assertStatus(422)
            ->assertJsonValidationErrors(['digitLength']);

        // Non-numeric digitLength
        $res = $this->actingAs($this->superAdmin)
            ->putJson('/api/superadmin/number-format', [
                'prefix' => 'TKT',
                'includeDeptCode' => false,
                'dateSegment' => 'none',
                'digitLength' => 'abc',
            ]);
        $res->assertStatus(422)
            ->assertJsonValidationErrors(['digitLength']);

        // Out of bounds (< 3 or > 8)
        $res = $this->actingAs($this->superAdmin)
            ->putJson('/api/superadmin/number-format', [
                'prefix' => 'TKT',
                'includeDeptCode' => false,
                'dateSegment' => 'none',
                'digitLength' => 2,
            ]);
        $res->assertStatus(422)
            ->assertJsonValidationErrors(['digitLength']);

        $res = $this->actingAs($this->superAdmin)
            ->putJson('/api/superadmin/number-format', [
                'prefix' => 'TKT',
                'includeDeptCode' => false,
                'dateSegment' => 'none',
                'digitLength' => 12,
            ]);
        $res->assertStatus(422)
            ->assertJsonValidationErrors(['digitLength']);
    }

    /**
     * Validation rejects invalid prefixes and missing department codes.
     */
    public function test_format_validation_rejects_invalid_prefix_and_missing_dept_code(): void
    {
        // Invalid prefix characters (spaces, special characters, XSS)
        $res = $this->actingAs($this->superAdmin)
            ->putJson('/api/superadmin/number-format', [
                'prefix' => 'TKT <script>',
                'includeDeptCode' => false,
                'dateSegment' => 'none',
                'digitLength' => 4,
            ]);
        $res->assertStatus(422)
            ->assertJsonValidationErrors(['prefix']);

        // Dept code enabled but empty
        $res = $this->actingAs($this->superAdmin)
            ->putJson('/api/superadmin/number-format', [
                'prefix' => 'TKT',
                'includeDeptCode' => true,
                'deptCode' => '',
                'dateSegment' => 'none',
                'digitLength' => 4,
            ]);
        $res->assertStatus(422)
            ->assertJsonValidationErrors(['deptCode']);

        // Invalid date segment
        $res = $this->actingAs($this->superAdmin)
            ->putJson('/api/superadmin/number-format', [
                'prefix' => 'TKT',
                'includeDeptCode' => false,
                'dateSegment' => 'INVALID_SEGMENT',
                'digitLength' => 4,
            ]);
        $res->assertStatus(422)
            ->assertJsonValidationErrors(['dateSegment']);
    }

    /**
     * Updating ticket number format publishes event and creates comprehensive audit log.
     */
    public function test_update_publishes_event_and_records_audit_log(): void
    {
        Event::fake([TicketNumberFormatUpdated::class]);

        $newFormat = [
            'prefix' => 'INC',
            'includeDeptCode' => true,
            'deptCode' => 'OPS',
            'dateSegment' => 'YYYYMM',
            'digitLength' => 5,
        ];

        $res = $this->actingAs($this->superAdmin)
            ->putJson('/api/superadmin/number-format', $newFormat);

        $res->assertStatus(200);

        // Verify Event dispatched
        Event::assertDispatched(TicketNumberFormatUpdated::class, function ($event) use ($newFormat) {
            return $event->newFormat['prefix'] === 'INC'
                && $event->newFormat['digitLength'] === 5
                && $event->newFormat['dateSegment'] === 'YYYYMM'
                && $event->newFormat['deptCode'] === 'OPS';
        });

        // Verify Audit Log recorded in database
        $auditLog = DB::table('ticket_audit_logs')
            ->where('action_type', 'config_update')
            ->where('details', 'like', '%Ticket Number Format%')
            ->orderBy('log_ID', 'desc')
            ->first();

        $this->assertNotNull($auditLog);
        $this->assertEquals('superadmin', $auditLog->actor_type);

        $details = json_decode($auditLog->details, true);
        $this->assertEquals('Ticket Number Format', $details['module']);
        $this->assertArrayHasKey('super_admin', $details);
        $this->assertArrayHasKey('previous_format', $details);
        $this->assertArrayHasKey('new_format', $details);
        $this->assertArrayHasKey('timestamp', $details);
        $this->assertEquals('INC', $details['new_format']['prefix']);
        $this->assertEquals(5, $details['new_format']['digitLength']);
    }

    /**
     * Concurrency-safe sequence generator produces strictly unique numbers.
     */
    public function test_concurrency_safe_sequence_generator(): void
    {
        $generator = app(TicketNumberGeneratorService::class);

        $generated = [];
        for ($i = 0; $i < 20; $i++) {
            $num = $generator->getNextSequenceNumber('global');
            $this->assertNotContains($num, $generated, 'Duplicate sequence number produced!');
            $generated[] = $num;
        }

        // Sequences must be strictly increasing
        for ($i = 1; $i < count($generated); $i++) {
            $this->assertGreaterThan($generated[$i - 1], $generated[$i]);
        }
    }

    /**
     * Format changes do NOT retroactively alter already-created tickets.
     */
    public function test_format_change_does_not_retroactively_affect_existing_tickets(): void
    {
        $legacyNumber = 'LEGACY-' . uniqid();
        $this->seedMachine(1);

        // Insert a ticket with a specific ticket_number
        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => $legacyNumber,
            'machine_ID' => 1,
            'problem_category_ID' => 1,
            'created_by' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'title' => 'Historical Ticket Test',
            'created_at' => now()->subMonths(3),
            'updated_at' => now()->subMonths(3),
        ]);

        // Change the format to something completely different
        $this->actingAs($this->superAdmin)
            ->putJson('/api/superadmin/number-format', [
                'prefix' => 'NEWFMT',
                'includeDeptCode' => false,
                'dateSegment' => 'YYYYMMDD',
                'digitLength' => 6,
            ])
            ->assertStatus(200);

        // Fetch historical ticket directly and verify its number was NOT altered
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $this->assertEquals($legacyNumber, $ticket->ticket_number);

        // Reset format back to defaults
        $this->actingAs($this->superAdmin)
            ->postJson('/api/superadmin/number-format/reset')
            ->assertStatus(200);

        // Historical ticket is still untouched
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $this->assertEquals($legacyNumber, $ticket->ticket_number);
    }

    /**
     * Test generator assembly with different combinations of prefix, dept, date segment, and digit lengths.
     */
    public function test_generator_assembles_ticket_number_with_various_configurations(): void
    {
        $generator = app(TicketNumberGeneratorService::class);
        $date = new \DateTimeImmutable('2026-10-04 15:30:00');

        // Pattern: Prefix + 4 digits (default)
        $tkt1 = $generator->assembleTicketNumber('TKT', null, 'none', 4, 1, $date);
        $this->assertEquals('TKT-0001', $tkt1);

        // Pattern: Prefix + Dept + 5 digits
        $tkt2 = $generator->assembleTicketNumber('TKT', 'IT', 'none', 5, 42, $date);
        $this->assertEquals('TKT-IT-00042', $tkt2);

        // Pattern: Prefix + YYYY + 4 digits
        $tkt3 = $generator->assembleTicketNumber('INC', null, 'YYYY', 4, 100, $date);
        $this->assertEquals('INC-2026-0100', $tkt3);

        // Pattern: Prefix + Dept + YYYYMM + 6 digits
        $tkt4 = $generator->assembleTicketNumber('SUP', 'SVC', 'YYYYMM', 6, 7, $date);
        $this->assertEquals('SUP-SVC-202610-000007', $tkt4);

        // Pattern: Prefix + YYYYMMDD + 3 digits
        $tkt5 = $generator->assembleTicketNumber('TKT', null, 'YYYYMMDD', 3, 5, $date);
        $this->assertEquals('TKT-20261004-005', $tkt5);
    }
}
