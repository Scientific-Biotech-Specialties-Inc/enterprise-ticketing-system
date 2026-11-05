<?php

namespace Tests\Unit;

use App\Exceptions\Handler;
use Illuminate\Container\Container;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Plain unit test: it does not boot the app or touch any database.
 * Client errors such as a branch scope 403 must never carry file paths or stack traces.
 */
class HandlerClientErrorBodyTest extends TestCase
{
    private function render(\Throwable $e): array
    {
        $handler = new Handler(new Container());
        $method = new ReflectionMethod($handler, 'convertExceptionToArray');
        $method->setAccessible(true);

        return $method->invoke($handler, $e);
    }

    public function test_forbidden_response_has_message_only(): void
    {
        $body = $this->render(new HttpException(403, 'Access denied: You are restricted to your assigned branch scope.'));

        $this->assertSame(['message' => 'Access denied: You are restricted to your assigned branch scope.'], $body);
        $this->assertArrayNotHasKey('trace', $body);
        $this->assertArrayNotHasKey('file', $body);
    }

    public function test_empty_client_error_message_gets_a_safe_default(): void
    {
        $body = $this->render(new HttpException(404, ''));

        $this->assertSame(['message' => 'Request could not be completed.'], $body);
    }
}
