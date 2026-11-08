<?php

namespace App\Actions\Dashboards;

use App\Services\TicketDashboardService;

class GetCsDashboardMetricsAction
{
    public function __construct(
        protected TicketDashboardService $dashboardService
    ) {}

    /**
     * Retrieve Customer Support dashboard metrics.
     *
     * @param int $limit
     * @return array
     */
    public function execute(int $limit = 10): array
    {
        return $this->dashboardService->getCsDashboard($limit);
    }
}

