<?php

namespace App\Console\Commands;

use App\Services\SLAService;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Spec 0037 (AC-11): repair open tickets that never got their SLA link saved
 * (branch category policies were dropped, or assignment failed at creation).
 *
 * Each ticket is resolved from its own created_at, category, priority, branch, and
 * department, exactly as creation resolves it. A ticket on hold keeps its paused clock.
 * Rows whose stored values already match are not written, so a rerun changes nothing.
 */
class BackfillTicketSla extends Command
{
    protected $signature = 'tickets:backfill-sla {--dry-run : Report what would change without writing}';

    protected $description = 'Backfill the SLA source and due dates on open tickets that are missing them (spec 0037).';

    private const CHUNK = 200;

    public function handle(SLAService $sla): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $scanned = 0;
        $changed = 0;
        $failed = 0;

        $this->candidates()->chunkById(self::CHUNK, function ($tickets) use ($sla, $dryRun, &$scanned, &$changed, &$failed) {
            foreach ($tickets as $ticket) {
                $scanned++;
                try {
                    $update = $this->resolveUpdate($sla, $ticket);
                } catch (\Throwable $e) {
                    $failed++;
                    $this->error("ticket {$ticket->ticket_ID}: {$e->getMessage()}");
                    continue;
                }

                if (!$this->differs($ticket, $update)) {
                    continue;
                }

                $changed++;
                if ($dryRun) {
                    $this->line("would update ticket {$ticket->ticket_ID}: " . json_encode($update));
                    continue;
                }

                DB::table('tickets')->where('ticket_ID', $ticket->ticket_ID)->update($update + ['updated_at' => now()]);
            }
        }, 't.ticket_ID', 'ticket_ID');

        $verb = $dryRun ? 'Would update' : 'Updated';
        $this->info("Scanned {$scanned} ticket(s). {$verb} {$changed}. {$failed} failed.");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }

    /** Open tickets with no source column, no resolution due date, or a failed SLA assignment. */
    protected function candidates()
    {
        return DB::table('tickets as t')
            ->leftJoin('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->where(function ($q) {
                $q->whereNull('ts.status_name')
                  ->orWhereNotIn(DB::raw('LOWER(ts.status_name)'), ['closed', 'resolved', 'discarded']);
            })
            ->where(function ($q) {
                $q->where(function ($none) {
                    foreach (SLAService::SLA_SOURCE_COLUMNS as $column) {
                        $none->whereNull("t.{$column}");
                    }
                })
                  ->orWhereNull('t.resolution_due_at')
                  ->orWhere('t.sla_status', 'SLA Unavailable');
            })
            ->select('t.*');
    }

    /** The column values this ticket should have, resolved from its own data. */
    protected function resolveUpdate(SLAService $sla, object $ticket): array
    {
        $priorityName = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID)->value('priority_name') ?? 'Low';
        $departmentId = $sla->resolveDepartmentForTicket($ticket);
        $categoryId = $ticket->problem_category_ID !== null ? (int) $ticket->problem_category_ID : null;

        $resolved = $sla->resolveSlaPolicy($departmentId, $categoryId, $priorityName, $ticket->branch_id ?: null);

        $update = $sla->slaSourceColumns($resolved);

        if ($sla->hasNoSlaSource($resolved)) {
            return $update + [
                'response_due_at' => null,
                'resolution_due_at' => null,
                'sla_status' => 'No SLA Configured',
            ];
        }

        $start = Carbon::parse($ticket->sla_started_at ?: $ticket->created_at ?: now());
        $pausedSeconds = (int) ($ticket->sla_paused_total_seconds ?? 0);

        $resolutionDueAt = $sla->addBusinessHours($start->copy(), (int) $resolved['resolution_time_limit'])->addSeconds($pausedSeconds);
        $update['sla_started_at'] = $start->toDateTimeString();
        $update['resolution_due_at'] = $resolutionDueAt->toDateTimeString();
        if (empty($ticket->first_response_at)) {
            $update['response_due_at'] = $sla->addBusinessHours($start->copy(), (int) $resolved['response_time_limit'])
                ->addSeconds($pausedSeconds)->toDateTimeString();
        }

        $now = now();
        if (!empty($ticket->sla_paused_at)) {
            $update['sla_status'] = 'Paused';
        } elseif ($now->gt($resolutionDueAt)) {
            $update['sla_status'] = 'Breached';
        } elseif ($now->diffInMinutes($resolutionDueAt, false) <= 240) {
            $update['sla_status'] = 'At Risk';
        } else {
            $update['sla_status'] = 'On Track';
        }

        return $update;
    }

    protected function differs(object $ticket, array $update): bool
    {
        foreach ($update as $column => $value) {
            $current = $ticket->{$column} ?? null;
            if ($current === null && $value === null) {
                continue;
            }
            if ($current === null || $value === null) {
                return true;
            }
            if (in_array($column, ['sla_started_at', 'response_due_at', 'resolution_due_at'], true)) {
                if (!Carbon::parse($current)->equalTo(Carbon::parse($value))) {
                    return true;
                }
                continue;
            }
            if ((string) $current !== (string) $value) {
                return true;
            }
        }
        return false;
    }
}
