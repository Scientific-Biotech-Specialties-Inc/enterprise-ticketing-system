<?php

namespace App\Console\Commands;

use App\Http\Controllers\AuthController;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

class SyncEmployeesFromAuth extends Command
{
    protected $signature = 'employees:sync-auth';
    protected $description = 'Synchronize employees, managers, and roles from the central Auth Module REST API into customer-service';

    public function handle(): int
    {
        $this->info('Starting customer-service employee synchronization from central Auth Module...');
        Cache::forget('employees_synced_lock');
        AuthController::autoSyncWithAuthModule();
        $this->info('Customer service synchronization completed successfully.');
        return Command::SUCCESS;
    }
}

