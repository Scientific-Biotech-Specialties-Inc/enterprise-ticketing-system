<?php

namespace App\Exceptions;

use RuntimeException;

class ArticleProcessingInProgressException extends RuntimeException
{
    public function __construct(string $message = "Cannot delete article while an extraction or indexing process is currently in progress. Please wait for the process to complete or cancel it.")
    {
        parent::__construct($message, 409);
    }
}
