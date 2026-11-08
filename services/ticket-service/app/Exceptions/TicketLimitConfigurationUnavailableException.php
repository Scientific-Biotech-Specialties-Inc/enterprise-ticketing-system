<?php

namespace App\Exceptions;

use Symfony\Component\HttpKernel\Exception\ServiceUnavailableHttpException;

class TicketLimitConfigurationUnavailableException extends ServiceUnavailableHttpException
{
    public function __construct()
    {
        parent::__construct(
            null,
            'Max-open-ticket policy is temporarily unavailable. Ticket creation is disabled until configuration can be verified.'
        );
    }
}
