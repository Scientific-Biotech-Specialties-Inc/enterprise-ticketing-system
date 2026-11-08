<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Domain error raised by BranchPriorityService. Carries the HTTP status
 * and any extra payload the controller should surface to the client.
 */
class BranchPriorityException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $status = 422,
        public readonly array $extra = []
    ) {
        parent::__construct($message);
    }
}
