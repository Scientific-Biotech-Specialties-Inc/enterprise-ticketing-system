<?php

namespace App\Exceptions;

use RuntimeException;

class TicketLimitExceededException extends RuntimeException
{
    public function __construct(
        public readonly int $limit,
        public readonly int $openTicketCount
    ) {
        parent::__construct(
            "Maximum open-ticket limit reached. You currently have {$openTicketCount} tickets that count toward the limit of {$limit}. Close or cancel an eligible ticket before submitting another."
        );
    }
}
