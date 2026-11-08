<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Spec 0036 (AC-2, AC-8): the embedding API could not produce vectors.
 * The message is always safe to show to a superadmin: it names the failure category and
 * HTTP status or exception class, never the request URL or the API key.
 */
class EmbeddingFailedException extends RuntimeException
{
    public function __construct(string $message = 'Embedding failed.', public readonly ?int $httpStatus = null)
    {
        parent::__construct($message, 502);
    }
}
