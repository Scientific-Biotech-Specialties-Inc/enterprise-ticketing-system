<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/**
 * Secures the configuration service. Identity comes only from the verified token or a valid
 * X-Internal-Token, never from X-User-* headers, request bodies or hand decoded tokens.
 *
 * Access levels, decided from the method and path (anything not listed fails closed to admin):
 *  - public:   RSA encryption key, and GET reads of non secret settings (system status, windows,
 *              limits, feedback questions and form status). The login page and other services read these.
 *  - internal: email dispatch. Only another service with a valid X-Internal-Token.
 *  - admin:    every write, and all email, template and channel settings. A verified admin or
 *              superadmin, or a service with a valid X-Internal-Token.
 */
class ConfigAccess
{
    private const ADMIN_ROLES = ['admin', 'superadmin'];

    public function handle(Request $request, Closure $next)
    {
        $level = $this->levelFor($request);

        if ($level === 'public') {
            return $next($request);
        }

        if (self::hasValidInternalToken($request)) {
            return $next($request);
        }

        if ($level === 'internal') {
            return response()->json(['message' => 'Unauthorized internal service request.'], 401);
        }

        // Admin level: a verified staff token with an admin role.
        return app(AuthenticateSubsystem::class)->handle($request, function (Request $verified) use ($next) {
            $user = $verified->user();
            $role = str_replace([' ', '_', '-'], '', strtolower(trim((string) ($user->role ?? ''))));

            if ($user && (int) ($user->emp_id ?? 0) > 0 && in_array($role, self::ADMIN_ROLES, true)) {
                return $next($verified);
            }

            return response()->json(['message' => 'Forbidden: administrator access required.'], 403);
        });
    }

    public static function hasValidInternalToken(Request $request): bool
    {
        $provided = (string) $request->header('X-Internal-Token', '');
        $expected = (string) env('INTERNAL_TOKEN', '');

        return $provided !== '' && $expected !== '' && hash_equals($expected, $provided);
    }

    private function levelFor(Request $request): string
    {
        $path = trim($request->path(), '/');
        $path = preg_replace('#^api/#', '', $path);
        $path = preg_replace('#^(ticketing/configuration|configuration)/#', '', $path);
        $isRead = in_array($request->method(), ['GET', 'HEAD'], true);

        if ($path === 'encryption-key') {
            return 'public';
        }
        if (str_starts_with($path, 'email/dispatch')) {
            return 'internal';
        }
        if ($path === 'email' || str_starts_with($path, 'email/')
            || str_starts_with($path, 'email-templates') || str_starts_with($path, 'notification-channels')) {
            return 'admin';
        }

        $publicReadPrefixes = ['ticket-configurations', 'windows', 'messaging', 'feedback-questions', 'feedback-form', 'feedback-config'];
        foreach ($publicReadPrefixes as $prefix) {
            if ($path === $prefix || str_starts_with($path, $prefix . '/')) {
                return $isRead ? 'public' : 'admin';
            }
        }

        return 'admin';
    }
}
