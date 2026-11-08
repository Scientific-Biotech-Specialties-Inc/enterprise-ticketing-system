<?php

namespace App\Services;

use App\Exceptions\TicketLimitExceededException;
use Closure;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class TicketLimitService
{
    public const COUNTED_OPEN_STATUSES = [
        'Open',
        'Pending Assignment',
        'In Progress',
        'Pending',
        'Pending Evaluation',
        'On Hold',
        'Escalated',
        'Reopened',
    ];

    /**
     * Execute a ticket insert while serializing submissions for one requester.
     * Configuration and status metadata are resolved before taking the row lock.
     */
    public function createWithinLimit(int $requesterId, bool $isInternal, Closure $createTicket): int
    {
        $config = TicketConfigurationService::getLimitConfig();
        if ($config['isUnlimited']) {
            return (int) $createTicket();
        }

        $countContext = $this->countContext();

        return DB::transaction(function () use ($requesterId, $isInternal, $createTicket, $config, $countContext) {
            $identityTable = $isInternal ? 'employees' : 'clients';
            $identityColumn = $isInternal ? 'emp_id' : 'id';

            $requesterExists = DB::table($identityTable)
                ->select($identityColumn)
                ->where($identityColumn, $requesterId)
                ->lockForUpdate()
                ->first();

            if (!$requesterExists) {
                throw new \LogicException('Authenticated ticket requester was not found.');
            }

            $openTicketCount = $this->countWithContext($requesterId, $isInternal, $countContext);
            if ($openTicketCount >= $config['limit']) {
                throw new TicketLimitExceededException($config['limit'], $openTicketCount);
            }

            return (int) $createTicket();
        }, 3);
    }

    /**
     * Count active tickets plus closed tickets still inside the configured reopen window.
     * Discarded/cancelled, resolved, and closed tickets outside that window are excluded.
     */
    public function countCurrentOpenTickets(int $requesterId, bool $isInternal): int
    {
        return $this->countWithContext($requesterId, $isInternal, $this->countContext());
    }

    private function countWithContext(int $requesterId, bool $isInternal, array $context): int
    {
        $requesterColumn = $isInternal ? 'requested_by' : 'created_by';
        $indexName = $isInternal
            ? 'idx_tickets_requester_open_limit'
            : 'idx_tickets_customer_open_limit';

        $activeCount = DB::table('tickets')
            ->useIndex($indexName)
            ->where($requesterColumn, $requesterId)
            ->where('is_internal', $isInternal)
            ->whereIn('ticket_status_ID', $context['open_status_ids'])
            ->count();

        if (!$context['closed_status_id'] || !$context['closed_cutoff']) {
            return $activeCount;
        }

        $recentlyClosedCount = DB::table('tickets')
            ->useIndex($indexName)
            ->where($requesterColumn, $requesterId)
            ->where('is_internal', $isInternal)
            ->where('ticket_status_ID', $context['closed_status_id'])
            ->where(function ($query) use ($context) {
                $query->where('closed_at', '>=', $context['closed_cutoff'])
                    ->orWhere(function ($fallback) use ($context) {
                        $fallback->whereNull('closed_at')
                            ->where('resolved_at', '>=', $context['closed_cutoff']);
                    });
            })
            ->count();

        return $activeCount + $recentlyClosedCount;
    }

    private function countContext(): array
    {
        $statusIds = Cache::remember('ticket:limit:status-ids', 3600, function () {
            return DB::table('ticket_statuses')
                ->pluck('ticket_status_ID', 'status_name')
                ->mapWithKeys(fn ($id, $name) => [strtolower(trim((string) $name)) => (int) $id])
                ->all();
        });

        $openStatusIds = collect(self::COUNTED_OPEN_STATUSES)
            ->map(fn ($name) => $statusIds[strtolower($name)] ?? null)
            ->filter()
            ->values()
            ->all();

        $windowConfig = TicketConfigurationService::getWindowConfig();
        $reopenEnabled = (bool) ($windowConfig['reopenEnabled'] ?? true);
        $reopenDays = max(1, (int) ($windowConfig['reopenWindowDays'] ?? 2));

        return [
            'open_status_ids' => $openStatusIds,
            'closed_status_id' => $statusIds['closed'] ?? null,
            'closed_cutoff' => $reopenEnabled ? now()->subDays($reopenDays) : null,
        ];
    }
}
