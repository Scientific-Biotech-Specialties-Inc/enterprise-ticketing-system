<?php

namespace Tests\Unit;

use App\Support\TicketStatusBuckets;
use PHPUnit\Framework\TestCase;

class TicketStatusBucketsTest extends TestCase
{
    public function test_pending_assignment_and_discarded_are_classified_correctly(): void
    {
        // Regression: SuperAdmin once used [3,4,10,12], which hid Pending Assignment (10)
        // and counted Discarded (9) as active, so its totals disagreed with CS and customers.
        $this->assertTrue(TicketStatusBuckets::isActive(10), 'Pending Assignment is active');
        $this->assertFalse(TicketStatusBuckets::isActive(9), 'Discarded is finished');
    }

    public function test_only_resolved_closed_and_discarded_are_finished(): void
    {
        $this->assertSame([3, 4, 9], TicketStatusBuckets::FINISHED_IDS);
        $this->assertSame([4, 9], TicketStatusBuckets::CLOSED_IDS);

        foreach ([1, 2, 5, 6, 7, 8, 10, 11] as $activeId) {
            $this->assertTrue(TicketStatusBuckets::isActive($activeId), "status {$activeId} is active");
        }
    }
}
