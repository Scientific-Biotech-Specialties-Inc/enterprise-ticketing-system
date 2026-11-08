<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AutoCloseInternalTickets extends Command
{
    protected $signature = 'tickets:auto-close-internal';
    protected $description = 'Auto-close internal tickets that have been resolved beyond the configured auto-close window';

    public function handle()
    {
        $windowConfig = [
            'autoCloseEnabled' => true,
            'autoCloseWindowDays' => 2,
        ];

        try {
            $configUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
            $response = Http::timeout(3)->get("{$configUrl}/api/ticket-configurations/windows");
            if ($response->successful()) {
                $json = $response->json();
                $val = $json['value'] ?? $json;
                $windowConfig['autoCloseEnabled'] = (bool) ($val['autoCloseEnabled'] ?? true);
                $windowConfig['autoCloseWindowDays'] = (int) ($val['autoCloseWindowDays'] ?? 2);
            }
        } catch (\Throwable $e) {
            Log::warning('Failed to fetch window config in employee-service: ' . $e->getMessage());
        }

        if (!($windowConfig['autoCloseEnabled'] ?? true)) {
            $this->info('Auto-close is disabled by administrative operational policy. No tickets closed.');
            return;
        }

        $autoCloseDays = (int) ($windowConfig['autoCloseWindowDays'] ?? 2);
        $autoCloseHours = $autoCloseDays * 24;
        $cutoff = now()->subHours($autoCloseHours);

        $tickets = DB::table('tickets')
            ->whereNotNull('requested_by')
            ->where('ticket_status_ID', 3)
            ->where('resolved_at', '<=', $cutoff)
            ->get();

        $count = 0;
        foreach ($tickets as $ticket) {
            DB::transaction(function () use ($ticket, &$count, $autoCloseDays, $autoCloseHours) {
                $now = now();
                DB::table('tickets')->where('ticket_ID', $ticket->ticket_ID)->update([
                    'ticket_status_ID' => 4,
                    'closed_at' => $now,
                    'updated_at' => $now,
                ]);

                DB::table('ticket_audit_logs')->insert([
                    'ticket_ID' => $ticket->ticket_ID,
                    'action_type' => 'status_change',
                    'action_by_ID' => 1,
                    'actor_type' => 'system',
                    'details' => json_encode([
                        'status' => 'Closed',
                        'remarks' => "Auto-closed after {$autoCloseDays} day(s) ({$autoCloseHours} hours) of inactivity following resolution.",
                    ]),
                    'created_at' => $now,
                ]);
                $count++;
            });
        }

        $this->info("Auto-closed {$count} internal ticket(s) resolved more than {$autoCloseDays} day(s) ago.");
    }
}
