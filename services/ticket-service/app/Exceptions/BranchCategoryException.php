<?php

namespace App\Exceptions;

use RuntimeException;

class BranchCategoryException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $statusCode = 422,
        public readonly array $context = []
    ) {
        parent::__construct($message);
    }

    public function render($request)
    {
        return response()->json([
            'message' => $this->getMessage(),
            'code' => 'BRANCH_CATEGORY_ERROR',
            ...$this->context,
        ], $this->statusCode);
    }
}
