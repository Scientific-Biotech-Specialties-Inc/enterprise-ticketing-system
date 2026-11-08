<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Services\TicketConfigurationService;
use App\Services\TicketService;
use App\Services\TicketStateMachine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The superadmin Transition Matrix is the source of truth: transitions that used
 * to be forced through in code (e.g. Open -> Assigned) now obey the matrix, and
 * Customer Service can close an Open ticket without assigning it when the matrix
 * allows Open -> Closed.
 */
class TransitionMatrixEnforcementTest extends TestCase
{
    use DatabaseTransactions;

    private const CACHE_KEY = 'ticket:config:transitions';

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(['*' => Http::response(['status' => 'success'], 200)]);
    }

    protected function tearDown(): void
    {
        Cache::forget(self::CACHE_KEY);
        parent::tearDown();
    }

    private function useMatrix(array $overrides): void
    {
        Cache::put(self::CACHE_KEY, array_merge(TicketConfigurationService::DEFAULT_TRANSITIONS, $overrides), 300);
    }

    private function createOpenTicket(): int
    {
        $openStatusId = (int) (DB::table('ticket_statuses')->whereRaw('LOWER(status_name) = ?', ['open'])->value('ticket_status_ID') ?? 1);

        return (int) DB::table('tickets')->insertGetId([
            'ticket_number' => 'MATRIX-' . uniqid(),
            'title' => 'Matrix enforcement',
            'description' => 'Matrix enforcement',
            'problem_category_ID' => (int) DB::table('problem_categories')->value('problem_category_ID'),
            'created_by' => (int) (DB::table('clients')->value('id') ?? 1),
            'ticket_type_ID' => (int) (DB::table('ticket_types')->value('ticket_type_ID') ?? 1),
            'priority_ID' => (int) (DB::table('ticket_priorities')->value('priority_ID') ?? 1),
            'ticket_status_ID' => $openStatusId,
            'is_internal' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function csUser(): Employee
    {
        $user = new Employee();
        $user->emp_id = (int) (DB::table('employees')->value('emp_id') ?? 1);
        $user->role = 'Customer Service';
        $user->department = 'Customer Service';

        return $user;
    }

    public function test_unchecked_transition_is_blocked_even_if_it_used_to_be_forced(): void
    {
        $machine = app(TicketStateMachine::class);

        $this->useMatrix(['Open' => ['allowed' => ['In Progress (CS-owned)', 'Cancelled'], 'type' => 'editable']]);
        $this->assertFalse($machine->canTransition('Open', 'Assigned'));

        $this->useMatrix(['Open' => ['allowed' => ['Assigned'], 'type' => 'editable']]);
        $this->assertTrue($machine->canTransition('Open', 'Assigned'));
    }

    public function test_system_rules_still_apply_regardless_of_matrix(): void
    {
        $machine = app(TicketStateMachine::class);
        $this->useMatrix(['Cancelled' => ['allowed' => ['Open'], 'type' => 'terminal']]);

        $this->assertFalse($machine->canTransition('Cancelled', 'Open'));
        $this->assertTrue($machine->canTransition('Reopened', 'In Progress (CS-owned)'));
    }

    public function test_cs_can_close_open_ticket_without_assigning_when_matrix_allows_it(): void
    {
        $this->useMatrix(['Open' => ['allowed' => ['Assigned', 'Closed'], 'type' => 'editable']]);
        $ticketId = $this->createOpenTicket();

        $result = app(TicketService::class)->closeTicket($ticketId, $this->csUser());

        $this->assertSame(200, $result['status'], json_encode($result['data']));
        $closedId = (int) DB::table('ticket_statuses')->whereRaw('LOWER(status_name) = ?', ['closed'])->value('ticket_status_ID');
        $this->assertSame($closedId, (int) DB::table('tickets')->where('ticket_ID', $ticketId)->value('ticket_status_ID'));
        $this->assertNull(DB::table('tickets')->where('ticket_ID', $ticketId)->value('assigned_to'));
    }

    public function test_closing_open_ticket_is_rejected_when_matrix_disallows_it(): void
    {
        $this->useMatrix(['Open' => ['allowed' => ['Assigned'], 'type' => 'editable']]);
        $ticketId = $this->createOpenTicket();

        $result = app(TicketService::class)->closeTicket($ticketId, $this->csUser());

        $this->assertSame(422, $result['status']);
        $this->assertSame('INVALID_TICKET_TRANSITION', $result['data']['code']);
    }
}
