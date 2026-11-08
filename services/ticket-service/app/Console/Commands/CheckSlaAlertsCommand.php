<?php

namespace App\Console\Commands;

use App\Services\SLAService;
use Illuminate\Console\Command;

class CheckSlaAlertsCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'tickets:check-sla-alerts';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Evaluate all active tickets for SLA breach and at-risk milestones and dispatch notifications';

    /**
     * Execute the console command.
     */
    public function handle(SLAService $slaService): int
    {
        $this->info('Starting SLA alert evaluation across active tickets...');

        $maxAttempts = 3;
        $attempt = 1;
        $lastException = null;

        while ($attempt <= $maxAttempts) {
            try {
                $result = $slaService->checkAndNotifySlaAlerts();

                $this->info("Evaluated tickets: {$result['evaluated_tickets']}");
                $this->info("Breach alerts dispatched: {$result['breach_notifications_sent']}");
                $this->info("At-risk alerts dispatched: {$result['risk_notifications_sent']}");

                \Illuminate\Support\Facades\Log::info('SLA alert evaluation completed successfully.', [
                    'evaluated' => $result['evaluated_tickets'],
                    'breach_sent' => $result['breach_notifications_sent'],
                    'risk_sent' => $result['risk_notifications_sent'],
                    'attempt' => $attempt,
                ]);

                return Command::SUCCESS;
            } catch (\Throwable $e) {
                $lastException = $e;
                \Illuminate\Support\Facades\Log::warning("SLA alert evaluation attempt {$attempt}/{$maxAttempts} failed: {$e->getMessage()}");
                $this->warn("Attempt {$attempt}/{$maxAttempts} failed. Retrying...");
                $attempt++;
                if ($attempt <= $maxAttempts) {
                    usleep(500000); // 500ms pause before retry
                }
            }
        }

        // All attempts exhausted: Log critical failure and alert Super Admin
        $errorMsg = $lastException ? $lastException->getMessage() : 'Unknown error';
        \Illuminate\Support\Facades\Log::critical("SLA background monitoring job (tickets:check-sla-alerts) failed completely: {$errorMsg}");
        $this->error("SLA background monitoring failed after {$maxAttempts} attempts: {$errorMsg}");

        try {
            $notificationService = app(\App\Services\TicketNotificationService::class);
            $notificationService->notifySuperAdmin(
                'Background Job Alert: SLA Alert Monitor Failed',
                "The scheduled SLA monitoring job (tickets:check-sla-alerts) encountered an unrecoverable failure: {$errorMsg}",
                [
                    'type' => 'system_alert',
                    'error' => $errorMsg,
                    'command' => 'tickets:check-sla-alerts',
                    'time' => now()->toIso8601String(),
                ]
            );
        } catch (\Throwable $alertError) {
            \Illuminate\Support\Facades\Log::error("Failed to alert Super Admin about SLA monitor job failure: {$alertError->getMessage()}");
        }

        return Command::FAILURE;
    }
}
