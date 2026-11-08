<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/**
 * Service to service guard: the caller must send X-Internal-Token equal to INTERNAL_TOKEN.
 * Compared with hash_equals; an unset INTERNAL_TOKEN rejects everything.
 */
class VerifyInternalToken
{
    public function handle(Request $request, Closure $next)
    {
        $expected = (string) env('INTERNAL_TOKEN', '');
        $provided = (string) $request->header('X-Internal-Token', '');

        if ($expected === '' || !hash_equals($expected, $provided)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return $next($request);
    }
}
