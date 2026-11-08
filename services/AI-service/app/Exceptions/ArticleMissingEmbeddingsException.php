<?php

namespace App\Exceptions;

use RuntimeException;

class ArticleMissingEmbeddingsException extends RuntimeException
{
    public function __construct(string $message = "Cannot publish article: no successfully processed embeddings exist for this article. Please extract and process document content before publishing.")
    {
        parent::__construct($message, 422);
    }
}
