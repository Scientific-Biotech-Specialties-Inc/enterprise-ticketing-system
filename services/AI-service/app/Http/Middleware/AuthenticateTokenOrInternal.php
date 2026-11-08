<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/**
 * Spec 0034 (AC-10): AI chat routes need a verified token (customer, or staff for reading) or a
 * valid X-Internal-Token. Anything else is stopped here with 401, before any controller code runs.
 */
class AuthenticateTokenOrInternal
{
    public function handle(Request $request, Closure $next)
    {
        if (self::hasValidInternalToken($request)) {
            $request->attributes->set('internal_call', true);

            return $next($request);
        }

        // AuthenticateSubsystem verifies a staff JWT or a customer Passport token and answers 401 otherwise.
        return app(AuthenticateSubsystem::class)->handle($request, $next);
    }

    public static function hasValidInternalToken(Request $request): bool
    {
        $provided = (string) $request->header('X-Internal-Token', '');
        $expected = (string) env('INTERNAL_TOKEN', '');

        return $provided !== '' && $expected !== '' && hash_equals($expected, $provided);
    }
}
