<?php

namespace App\Exceptions;

use RuntimeException;

class PurgeAlreadyInProgressException extends RuntimeException
{
    public function __construct(string $message = 'PURGE_ALREADY_IN_PROGRESS')
    {
        parent::__construct($message, 409);
    }
}

