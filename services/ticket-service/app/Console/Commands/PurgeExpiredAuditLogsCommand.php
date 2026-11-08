<?php

namespace App\Console\Commands;

use App\Exceptions\PurgeAlreadyInProgressException;
use App\Exceptions\PurgeExecutionFailedException;
use App\Models\AuditRetentionSetting;
use App\Services\AuditRetentionService;
use Illuminate\Console\Command;

class PurgeExpiredAuditLogsCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'tickets:purge-expired-audit-logs {--force : Run even when auto purge is disabled}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Purge expired ticket_audit_logs records in keyset-chunked batches with concurrency protection';

    /**
     * Execute the console command.
     */
    public function handle(AuditRetentionService $retentionService): int
    {
        $settings = AuditRetentionSetting::current();

        if (!$settings->is_auto_purge_enabled && !$this->option('force')) {
            $this->info('Automated audit log purge is disabled in retention settings. Skipping execution.');
            return Command::SUCCESS;
        }

        try {
            $run = $retentionService->executePurge('scheduled', null);
            $this->info(
                "Audit log purge completed [{$run->status}]: deleted {$run->records_deleted}/{$run->records_identified} expired records in {$run->duration_ms}ms."
            );
            return Command::SUCCESS;
        } catch (PurgeAlreadyInProgressException $e) {
            $this->warn($e->getMessage());
            return Command::FAILURE;
        } catch (PurgeExecutionFailedException $e) {
            $this->error('Audit log purge execution failed: ' . $e->getMessage());
            return Command::FAILURE;
        }
    }
}

