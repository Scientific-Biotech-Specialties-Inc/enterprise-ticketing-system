<?php

namespace App\Console\Commands;

use App\Http\Controllers\EmployeeDirectoryController;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

class SyncEmployeesFromAuth extends Command
{
    protected $signature = 'employees:sync-auth';
    protected $description = 'Synchronize employees, managers, and roles from the central Auth Module REST API into the ticketing employees table';

    public function handle(): int
    {
        $this->info('Starting employee synchronization from central Auth Module REST API...');
        Cache::forget('employees_synced_lock');
        Cache::forget('department_managers:cache');
        EmployeeDirectoryController::autoSyncWithAuthModule();
        $this->info('Synchronization completed successfully via internal REST API.');
        return Command::SUCCESS;
    }
}
