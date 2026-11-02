<?php

namespace App\Actions\Dashboards;

use App\Services\TicketDashboardService;

class GetCustomerDashboardMetricsAction
{
    public function __construct(
        protected TicketDashboardService $dashboardService
    ) {}

    /**
     * Retrieve Customer Dashboard metrics strictly for the authenticated customer.
     *
     * @param int $customerId
     * @param int $limit
     * @param array $filters
     * @return array
     */
    public function execute(int $customerId, int $limit = 5, array $filters = []): array
    {
        return $this->dashboardService->getCustomerDashboard($customerId, $limit, $filters);
    }
}

