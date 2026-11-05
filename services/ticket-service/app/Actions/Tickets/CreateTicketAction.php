<?php

namespace App\Actions\Tickets;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;
use App\Models\Client;
use App\Services\SLAService;
use App\Services\TicketCacheService;
use App\Services\TicketLimitService;
use App\Services\TicketNumberGeneratorService;
use App\Services\TicketConfigurationService;

class CreateTicketAction
{
    public function __construct(
        protected SLAService $slaService,
        protected TicketCacheService $cacheService,
        protected TicketLimitService $ticketLimitService,
        protected TicketNumberGeneratorService $numberGeneratorService
    ) {}

    /**
     * Execute ticket creation wrapped in a database transaction.
     *
     * @param array $validated
     * @param mixed $user
     * @param int|null $departmentId
     * @return array
     */
    public function execute(array $validated, $user, ?int $departmentId = 2): array
    {
        if (!$user instanceof Client) {
            throw new \LogicException('Only authenticated customers can create external tickets.');
        }

        $clientId = (int) $user->id;
        $rawTitle = strip_tags($validated['title'] ?? '');
        $cleanedTitle = preg_replace('/^(?:\d+[\.\)\-:]|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item)[:\-])\s*/i', '', $rawTitle);
        $finalTitle = !empty(trim($cleanedTitle)) ? trim($cleanedTitle) : $rawTitle;

        $externalTypeId = DB::table('ticket_types')->where('type_name', 'External')->value('ticket_type_ID') ?? 2;

        $deptCodeParam = null;
        if ($departmentId) {
            $deptName = DB::table('departments')->where('id', $departmentId)->value('name') ?? '';
            if (stripos($deptName, 'IT') !== false) {
                $deptCodeParam = 'IT';
            } elseif (stripos($deptName, 'Service') !== false) {
                $deptCodeParam = 'SVC';
            } elseif (!empty($deptName)) {
                $deptCodeParam = strtoupper(substr(preg_replace('/[^A-Za-z0-9]/', '', $deptName), 0, 4));
            }
        }
        $ticketNumber = $this->numberGeneratorService->generateNextTicketNumber($deptCodeParam);

        $defaults = TicketConfigurationService::getDefaultsConfig();

        $priorityId = $validated['priority_ID'] ?? null;
        if (empty($priorityId)) {
            $defaultPriorityName = $defaults['priority'] ?? 'Low';
            $priorityId = DB::table('ticket_priorities')
                ->whereRaw('LOWER(priority_name) = ?', [strtolower(trim($defaultPriorityName))])
                ->value('priority_ID') ?: 1;
        }

        $statusId = $validated['ticket_status_ID'] ?? null;
        if (empty($statusId)) {
            $defaultStatusName = $defaults['status'] ?? 'Open';
            $statusId = DB::table('ticket_statuses')
                ->whereRaw('LOWER(status_name) = ?', [strtolower(trim($defaultStatusName))])
                ->value('ticket_status_ID') ?: 1;
        }

        return DB::transaction(function () use ($validated, $clientId, $externalTypeId, $priorityId, $statusId, $finalTitle, $ticketNumber, $departmentId, $defaults) {
            $ticketData = [
                'ticket_number' => $ticketNumber,
                'machine_ID' => !empty($validated['machine_ID']) ? (int) $validated['machine_ID'] : null,
                'problem_category_ID' => $validated['problem_category_ID'],
                'created_by' => $clientId,
                'requested_by' => null,
                'assigned_to' => null,
                'ticket_type_ID' => $externalTypeId,
                'is_internal' => false,
                'priority_ID' => $priorityId,
                'branch_id' => $validated['branch_id'] ?? null,
                'ticket_status_ID' => $statusId,
                'sla_ID' => null,
                'title' => $finalTitle,
                'description' => strip_tags($validated['description'] ?? ''),
                'origin' => $validated['origin'] ?? 'manual',
                'resolved_at' => null,
                'closed_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ];

            $ticketId = $this->ticketLimitService->createWithinLimit(
                $clientId,
                false,
                fn () => DB::table('tickets')->insertGetId($ticketData)
            );

            try {
                $priorityName = DB::table('ticket_priorities')->where('priority_ID', $priorityId)->value('priority_name') ?? 'Low';
                $this->slaService->assignSlaToTicket(
                    $ticketId,
                    (int) $departmentId,
                    (int) $validated['problem_category_ID'],
                    $priorityName,
                    now(),
                    $defaults['slaPolicy'] ?? 'dynamic',
                    $validated['branch_id'] ?? null
                );
            } catch (\Throwable $e) {
                Log::warning('CreateTicketAction: Failed to assign SLA: ' . $e->getMessage());
            }

            // Bind attachments
            $attachmentIds = $validated['attachments'] ?? [];
            if (!empty($attachmentIds)) {
                try {
                    Http::post('http://attachment-service:8000/api/bind', [
                        'ticket_id' => $ticketId,
                        'attachment_ids' => $attachmentIds,
                        'is_proof' => false
                    ]);
                } catch (\Throwable $e) {
                    Log::error('CreateTicketAction: Failed to bind attachments: ' . $e->getMessage());
                }
            }

            // Create initial audit log
            DB::table('ticket_audit_logs')->insert([
                'ticket_ID' => $ticketId,
                'action_type' => 'created',
                'event_type' => 'ticket_created',
                'actor_type' => 'customer',
                'action_by_ID' => $clientId,
                'details' => json_encode(['ticket_number' => $ticketNumber, 'origin' => $ticketData['origin'], 'actor_name' => DB::table('clients')->where('id', $clientId)->value('client_name') ?? 'Customer']),
                'created_at' => now(),
            ]);

            $this->cacheService->clearTicketCaches();

            $createdTicket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();

            return [
                'success' => true,
                'message' => 'Ticket created successfully.',
                'ticket_id' => $ticketId,
                'ticket_number' => $ticketNumber,
                'ticket' => (array) $createdTicket,
            ];
        });
    }
}

