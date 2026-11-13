<?php

namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Throwable;

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
            //
        });
    }

    protected function unauthenticated($request, \Illuminate\Auth\AuthenticationException $exception)
    {
        return response()->json(['message' => $exception->getMessage() ?: 'Unauthenticated.'], 401);
    }

    /**
     * Client errors (4xx) keep their message. Server errors never send SQL, file paths or stack
     * traces to the browser, even with APP_DEBUG on; the full exception is still logged by report().
     */
    protected function convertExceptionToArray(Throwable $e)
    {
        if ($e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface && $e->getStatusCode() < 500) {
            return ['message' => $e->getMessage() !== '' ? $e->getMessage() : 'Request could not be completed.'];
        }

        return ['message' => 'Something went wrong on our side. Please try again in a moment.'];
    }
}
