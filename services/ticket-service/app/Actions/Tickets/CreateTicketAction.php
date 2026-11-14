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
use App\Services\TicketNotificationService;

class CreateTicketAction
{
    public function __construct(
        protected SLAService $slaService,
        protected TicketCacheService $cacheService,
        protected TicketLimitService $ticketLimitService,
        protected TicketNumberGeneratorService $numberGeneratorService,
        protected TicketNotificationService $notificationService
    ) {}

    /**
     * Execute ticket creation wrapped in a database transaction.
     *
     * @param array $validated
     * @param mixed $user
     * @param int|null $departmentId
     * @return array
     */
    public function execute(array $validated, $user, ?int $departmentId = null): array
    {
        if (!$user instanceof Client) {
            throw new \LogicException('Only authenticated customers can create external tickets.');
        }

        $clientId = (int) $user->id;
        $rawTitle = strip_tags($validated['title'] ?? '');
        $cleanedTitle = preg_replace('/^(?:\d+[\.\)\-:](?!\d)|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item)[:\-])\s*/i', '', $rawTitle);
        $finalTitle = !empty(trim($cleanedTitle)) ? trim($cleanedTitle) : $rawTitle;

        $externalTypeId = DB::table('ticket_types')->where('type_name', 'External')->value('ticket_type_ID') ?? 2;

        // Spec 0043 (AC-7): the department segment is the department's own code, read at creation.
        // An unclassified ticket has no department, so the segment is left out.
        $deptCodeParam = $departmentId
            ? (DB::table('departments')->where('id', $departmentId)->value('code') ?: null)
            : null;
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

        $result = DB::transaction(function () use ($validated, $clientId, $externalTypeId, $priorityId, $statusId, $finalTitle, $ticketNumber, $departmentId, $defaults) {
            $ticketData = [
                'ticket_number' => $ticketNumber,
                'machine_ID' => !empty($validated['machine_ID']) ? (int) $validated['machine_ID'] : null,
                'problem_category_ID' => $validated['problem_category_ID'] ?? null,
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
                    (int) ($departmentId ?? 0),
                    isset($validated['problem_category_ID']) ? (int) $validated['problem_category_ID'] : null,
                    $priorityName,
                    now(),
                    $defaults['slaPolicy'] ?? 'dynamic',
                    $validated['branch_id'] ?? null
                );
            } catch (\Throwable $e) {
                // Spec 0037 (AC-10): the ticket is still created; flag it so tickets:backfill-sla repairs it.
                Log::error('CreateTicketAction: SLA assignment failed', ['ticket_ID' => $ticketId, 'error' => $e->getMessage()]);
                try {
                    DB::table('tickets')->where('ticket_ID', $ticketId)->update(['sla_status' => 'SLA Unavailable']);
                } catch (\Throwable $inner) {
                    Log::error('CreateTicketAction: could not flag SLA Unavailable', ['ticket_ID' => $ticketId, 'error' => $inner->getMessage()]);
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

        // Bind attachments only after the ticket row is committed. attachment-service writes
        // ticket_attachments.ticket_id, whose foreign key on tickets would wait on our uncommitted
        // row while we wait on the HTTP call, stalling ticket creation until the 30s timeout.
        $attachmentIds = $validated['attachments'] ?? [];
        // Spec 0043 AC-14 instrumentation: times the steps between commit and the `created` broadcast.
        $bindStartedAt = microtime(true);
        if (!empty($attachmentIds)) {
            try {
                Http::post('http://attachment-service:8000/api/bind', [
                    'ticket_id' => $result['ticket_id'],
                    'attachment_ids' => $attachmentIds,
                    'is_proof' => false
                ]);
            } catch (\Throwable $e) {
                Log::error('CreateTicketAction: Failed to bind attachments: ' . $e->getMessage());
            }
        }

        $bindMs = (int) round((microtime(true) - $bindStartedAt) * 1000);

        $this->dispatchCreatedSideEffects($result, $validated, $clientId, $finalTitle, $ticketNumber);

        Log::info('CreateTicketAction: created broadcast timing', [
            'ticket_ID' => $result['ticket_id'],
            'attachment_count' => count($attachmentIds),
            'bind_ms' => $bindMs,
            'commit_to_side_effects_done_ms' => (int) round((microtime(true) - $bindStartedAt) * 1000),
        ]);

        return $result;
    }

    /**
     * Post-commit side effects of a new customer ticket: CS new_ticket alert, customer notification
     * and email, the realtime `created` broadcast, and the welcome chat message.
     * Each step is non-blocking so a downstream failure never undoes a committed ticket.
     */
    protected function dispatchCreatedSideEffects(array $result, array $validated, int $clientId, string $finalTitle, string $ticketNumber): void
    {
        $ticketId = (int) $result['ticket_id'];
        $ticketRef = TicketNumberGeneratorService::refFor($ticketId);
        $clientName = DB::table('clients')->where('id', $clientId)->value('client_name') ?? 'Customer';
        $ticketRow = $result['ticket'] ?? [];

        try {
            $this->notificationService->dispatchAlert(
                'new_ticket',
                'New Ticket Created',
                "New Ticket {$ticketRef}: \"{$finalTitle}\" has been created by {$clientName}.",
                $ticketId,
                ['ticket_id' => $ticketId, 'title' => $finalTitle]
            );

            $this->notificationService->notifyCustomer(
                $clientId,
                'Ticket Created',
                "Your ticket {$ticketRef}: \"{$finalTitle}\" has been created successfully. Our team will review it shortly.",
                $ticketId
            );

            $categoryName = !empty($validated['problem_category_ID'])
                ? (DB::table('problem_categories')->where('problem_category_ID', $validated['problem_category_ID'])->value('category_name') ?? '')
                : 'Unclassified';
            $priorityName = DB::table('ticket_priorities')->where('priority_ID', $ticketRow['priority_ID'] ?? ($validated['priority_ID'] ?? 1))->value('priority_name') ?? '';
            $this->notificationService->sendCustomerEmail(
                $clientId,
                'Ticket Created',
                "Your ticket {$ticketNumber}: \"{$finalTitle}\" has been created successfully.",
                $ticketId,
                $finalTitle,
                $categoryName,
                $priorityName
            );
        } catch (\Throwable $e) {
            Log::error('CreateTicketAction: Failed to dispatch creation notifications: ' . $e->getMessage());
        }

        try {
            $statusName = DB::table('ticket_statuses')->where('ticket_status_ID', $ticketRow['ticket_status_ID'] ?? null)->value('status_name') ?? 'Open';
            $this->notificationService->broadcastTicketChange('created', $ticketId, [
                'status' => $statusName,
                'title' => $finalTitle,
                'customer_id' => $clientId,
            ]);
        } catch (\Throwable $e) {
            Log::error('CreateTicketAction: Failed to broadcast ticket creation: ' . $e->getMessage());
        }

        try {
            Http::withHeaders([
                'X-Internal-Token' => env('INTERNAL_TOKEN'),
            ])->post("http://messaging-service:8000/api/internal/tickets/{$ticketId}/messages", [
                'message' => "Hi! I am the Customer Support Assistant. A representative will be with you shortly. For your reference, this chat is for your ticket: {$ticketNumber}.",
                'sender_name' => 'Customer Support Assistant',
                'sender_type' => 'cs',
                'sender_id' => null,
            ]);
        } catch (\Throwable $e) {
            Log::error('CreateTicketAction: Failed to send initial chat message: ' . $e->getMessage());
        }
    }
}

