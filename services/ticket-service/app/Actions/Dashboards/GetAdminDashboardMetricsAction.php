<?php

namespace App\Actions\Dashboards;

use App\Services\TicketDashboardService;

class GetAdminDashboardMetricsAction
{
    public function __construct(
        protected TicketDashboardService $dashboardService
    ) {}

    /**
     * Retrieve Admin dashboard metrics with branch scoping.
     *
     * @param mixed $user
     * @param array $filters
     * @param bool $forceRefresh
     * @return array
     */
    public function execute($user, array $filters = [], bool $forceRefresh = false): array
    {
        return $this->dashboardService->getAdminDashboard($user, $filters, $forceRefresh);
    }
}

