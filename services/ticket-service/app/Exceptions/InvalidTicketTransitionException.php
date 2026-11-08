<?php

namespace App\Exceptions;

use RuntimeException;

class InvalidTicketTransitionException extends RuntimeException
{
    public function __construct(
        public readonly string $fromStatus,
        public readonly string $toStatus,
        public readonly array $allowedStatuses = [],
        string $customMessage = ''
    ) {
        if (!empty($customMessage)) {
            $msg = $customMessage;
        } elseif (empty($allowedStatuses)) {
            $msg = "Transition from '{$fromStatus}' to '{$toStatus}' is not permitted. '{$fromStatus}' has no permitted next transitions.";
        } else {
            $allowedList = implode(', ', array_map(fn($s) => "'{$s}'", $allowedStatuses));
            $msg = "Transition from '{$fromStatus}' to '{$toStatus}' is not permitted. Permitted next statuses from '{$fromStatus}' are: [{$allowedList}].";
        }
        parent::__construct($msg);
    }

    public function render($request)
    {
        return response()->json([
            'message' => $this->getMessage(),
            'code' => 'INVALID_TICKET_TRANSITION',
            'from_status' => $this->fromStatus,
            'to_status' => $this->toStatus,
            'allowed_statuses' => $this->allowedStatuses,
        ], 422);
    }
}
