<?php

namespace App\Exceptions;

use App\Models\AuditPurgeRun;
use RuntimeException;
use Throwable;

class PurgeExecutionFailedException extends RuntimeException
{
    protected ?AuditPurgeRun $purgeRun;

    public function __construct(string $message, ?AuditPurgeRun $purgeRun = null, ?Throwable $previous = null)
    {
        parent::__construct($message, 500, $previous);
        $this->purgeRun = $purgeRun;
    }

    public function getPurgeRun(): ?AuditPurgeRun
    {
        return $this->purgeRun;
    }
}

