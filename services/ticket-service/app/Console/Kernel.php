<?php

namespace App\Console;

use App\Models\AuditRetentionSetting;
use Cron\CronExpression;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;
use Illuminate\Support\Facades\Schema;
use Throwable;

class Kernel extends ConsoleKernel
{
    /**
     * Define the application's command schedule.
     */
    protected function schedule(Schedule $schedule): void
    {
        $schedule->command('tickets:auto-close-internal')->everyFiveMinutes();
        $schedule->command('tickets:check-sla-alerts')->everyMinute();
        // Precompute the longest horizon the UI offers (30 days) so both the 7 and 30 day views are served from fresh rows.
        $schedule->command('tickets:calculate-forecasts', ['--horizon' => 30])->dailyAt('02:00')->onOneServer()->runInBackground();

        $purgeCron = '0 2 * * *';
        try {
            if (Schema::hasTable('audit_retention_settings')) {
                $configuredCron = trim((string) AuditRetentionSetting::query()->value('purge_schedule'));
                if ($configuredCron !== '' && CronExpression::isValidExpression($configuredCron)) {
                    $purgeCron = $configuredCron;
                }
            }
        } catch (Throwable $e) {
            $purgeCron = '0 2 * * *';
        }

        $schedule->command('tickets:purge-expired-audit-logs')->cron($purgeCron);
    }

    /**
     * Register the commands for the application.
     */
    protected function commands(): void
    {
        $this->load(__DIR__.'/Commands');

        require base_path('routes/console.php');
    }
}
