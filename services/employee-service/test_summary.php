<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Services\EmployeeAssignmentService;

$service = app(EmployeeAssignmentService::class);

echo "=== Reymie Gonzaga (Manager: shelleysesantee@gmail.com) ===\n";
$managerTickets = $service->getEmployeeTickets('shelleysesantee@gmail.com');
echo "Tickets Count (should be 1 - TKT-0016 escalated): " . count($managerTickets) . "\n";
foreach ($managerTickets as $t) {
    echo "- ID: {$t['id']}, Title: {$t['title']}, Status: {$t['status']}, Escalated: " . ($t['escalated'] ? 'true' : 'false') . "\n";
}

$managerSummary = $service->getDepartmentSummaryForEmployee('shelleysesantee@gmail.com');
echo "Department Summary for Manager:\n";
print_r($managerSummary);

echo "\n=== Bernadette Tormo (Technician: employee1@gmail.com) ===\n";
$techTickets = $service->getEmployeeTickets('employee1@gmail.com');
echo "Tickets Count for Tech (should have breached tickets): " . count($techTickets) . "\n";
$techSummary = $service->getDepartmentSummaryForEmployee('employee1@gmail.com');
echo "Department Summary for Tech (should be null): " . ($techSummary === null ? 'NULL' : json_encode($techSummary)) . "\n";

