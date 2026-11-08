<?php

namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Throwable;

use App\Services\SystemAlertDispatcher;
use App\Services\SystemAlertSanitizer;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use PDOException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class Handler extends ExceptionHandler
{
    /**
     * The list of the inputs that are never flashed to the session on validation exceptions.
     *
     * @var array<int, string>
     */
    protected $dontFlash = [
        'current_password',
        'password',
        'password_confirmation',
    ];

    /**
     * Register the exception handling callbacks for the application.
     */
    public function register(): void
    {
        $this->reportable(function (Throwable $e) {
            // Ignore standard user validation, 404, or 401 authentication errors
            // Passport reports every rejected or expired bearer token as an OAuthServerException.
            // That is an expected 401, not a system failure; alerting on it cost each such request
            // a blocking call to notification-service (and timed out file access checks).
            if (
                $e instanceof ValidationException ||
                $e instanceof NotFoundHttpException ||
                $e instanceof AuthenticationException ||
                $e instanceof \League\OAuth2\Server\Exception\OAuthServerException
            ) {
                return;
            }

            if ($e instanceof HttpException && $e->getStatusCode() < 500) {
                return;
            }

            $isSqlError = ($e instanceof QueryException || $e instanceof PDOException);
            $category = $isSqlError ? 'sql_error' : 'unhandled_error';
            $severity = $isSqlError ? 'critical' : 'high';
            $title = $isSqlError ? 'Database SQL Error' : 'Unhandled System Exception: ' . class_basename($e);

            $formatted = SystemAlertSanitizer::formatException($e);

            SystemAlertDispatcher::dispatchIssue(
                category: $category,
                severity: $severity,
                service: 'ticket-service',
                title: $title,
                message: $e->getMessage(),
                context: [
                    'exception' => $formatted,
                    'url' => request()?->fullUrl(),
                    'method' => request()?->method(),
                ],
                ip: request()?->ip(),
                userAgent: request()?->userAgent()
            );
        });
    }

    /**
     * Client errors (403, 404 and other 4xx) are expected outcomes, so they never expose file paths or stack
     * traces even when APP_DEBUG is on. Real server errors keep the full debug detail.
     */
    protected function convertExceptionToArray(Throwable $e)
    {
        if ($e instanceof HttpException && $e->getStatusCode() < 500) {
            return ['message' => $e->getMessage() !== '' ? $e->getMessage() : 'Request could not be completed.'];
        }

        return parent::convertExceptionToArray($e);
    }

    protected function unauthenticated($request, AuthenticationException $exception)
    {
        return response()->json(['message' => $exception->getMessage() ?: 'Unauthenticated.'], 401);
    }
}
