<?php

namespace App\Console\Commands;

use App\Services\EmployeeDirectorySyncService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

class SyncEmployeesFromAuth extends Command
{
    protected $signature = 'employees:sync-directory';
    protected $aliases = ['employees:sync-auth'];
    protected $description = 'Synchronize employees, managers, and roles from the central Auth Module REST API into the ticketing employees table';

    public function handle(EmployeeDirectorySyncService $sync): int
    {
        Cache::forget('department_managers:cache');
        $result = $sync->sync(true);

        $this->info(sprintf(
            'Employee directory sync %s: %d synced, %d deactivated.',
            $result['status'],
            $result['synced'],
            $result['deactivated']
        ));

        return $result['status'] === 'failed' ? Command::FAILURE : Command::SUCCESS;
    }
}
