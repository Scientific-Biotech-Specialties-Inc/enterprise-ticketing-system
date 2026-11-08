<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Spec 0036: another request already holds the kb:index:{id} lock for this article.
 */
class IndexingInProgressException extends RuntimeException
{
    public function __construct(string $message = 'This article is already being indexed. Please wait for it to finish and try again.')
    {
        parent::__construct($message, 409);
    }
}
