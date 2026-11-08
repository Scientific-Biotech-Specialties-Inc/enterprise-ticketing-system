<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class SystemAlertDispatcher
{
    /**
     * Dispatch an issue to the centralized notification service alert pipeline.
     */
    public static function dispatchIssue(
        string $category,
        string $severity,
        string $service,
        string $title,
        string $message,
        array $context = [],
        ?string $ip = null,
        ?string $userAgent = null
    ): void {
        try {
            $notificationUrl = env('NOTIFICATION_SERVICE_URL', 'http://notification-service:8000');
            $cleanContext = SystemAlertSanitizer::scrub($context);
            $cleanTitle = SystemAlertSanitizer::scrubString($title);
            $cleanMessage = SystemAlertSanitizer::scrubString($message);

            Http::timeout(3)
                ->withHeaders([
                    'X-Internal-Call' => 'system-monitoring',
                    'Content-Type' => 'application/json',
                ])
                ->post("{$notificationUrl}/api/internal/system-alerts", [
                    'category' => $category,
                    'severity' => $severity,
                    'service' => $service,
                    'title' => $cleanTitle,
                    'message' => $cleanMessage,
                    'context' => $cleanContext,
                    'ip_address' => $ip ?? request()?->ip(),
                    'user_agent' => $userAgent ?? request()?->userAgent(),
                ]);
        } catch (\Throwable $e) {
            Log::warning("SystemAlertDispatcher failed in {$service}: " . $e->getMessage());
        }
    }
}
