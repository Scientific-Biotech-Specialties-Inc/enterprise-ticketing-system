<?php

namespace App\Http\Controllers;

use App\Services\SystemAlertSanitizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class SystemAlertController extends Controller
{
    /**
     * Ingest and process system and security alerts from any microservice.
     */
    public function receiveAlert(Request $request): JsonResponse
    {
        $raw = $request->all();

        // 1. Scrub credentials, tokens, and sensitive stack traces at ingestion
        $scrubbed = SystemAlertSanitizer::scrub($raw);

        $category = (string) ($scrubbed['category'] ?? 'unhandled_error');
        $severity = strtolower((string) ($scrubbed['severity'] ?? 'medium'));
        $service = (string) ($scrubbed['service'] ?? 'unknown-service');
        $title = (string) ($scrubbed['title'] ?? 'System Issue Detected');
        $message = (string) ($scrubbed['message'] ?? 'An unexpected system-level issue occurred.');
        $context = is_array($scrubbed['context'] ?? null) ? $scrubbed['context'] : (array) ($scrubbed['context_data'] ?? []);
        $ipAddress = (string) ($scrubbed['ip_address'] ?? $request->ip() ?? '127.0.0.1');
        $userAgent = (string) ($scrubbed['user_agent'] ?? $request->userAgent() ?? 'System/Internal');

        // Normalize severity
        if (!in_array($severity, ['critical', 'high', 'medium', 'low'], true)) {
            $severity = 'medium';
        }

        // 2. Fetch configurable burst cooldown from Configuration Service with fallback defaults
        $burstCooldown = $this->resolveBurstCooldown($category);

        // 3. Compute normalized fingerprint for sliding window burst rate-limiting
        $normalizedMessage = preg_replace('/[0-9a-f]{8,}/i', '#ID', $message);
        $normalizedMessage = preg_replace('/\d+/', '#NUM', $normalizedMessage);
        $fingerprint = md5("{$service}:{$category}:" . substr($normalizedMessage, 0, 150));
        $burstKey = "system_alert:burst:{$fingerprint}";
        $countKey = "system_alert:burst_count:{$fingerprint}";

        $isGrouped = false;
        $incidentId = null;
        $burstCount = 1;

        try {
            $existingIncidentId = Redis::get($burstKey);
            if ($existingIncidentId) {
                // Subsequent event within burst window: group and increment counter
                $isGrouped = true;
                $incidentId = (string) $existingIncidentId;
                $burstCount = (int) Redis::incr($countKey);

                // Update system_security_alerts with incremented burst count and last_seen_at
                if (Schema::hasTable('system_security_alerts')) {
                    DB::table('system_security_alerts')
                        ->where('incident_id', $incidentId)
                        ->update([
                            'burst_count' => $burstCount,
                            'last_seen_at' => now(),
                            'updated_at' => now(),
                        ]);
                }

                // Still record every individual event in ticket_audit_logs (AC-5)
                $this->writeAuditLog($incidentId, $category, $severity, $service, $title, $message, $context, true, $burstCount);

                return response()->json([
                    'success' => true,
                    'status' => 'grouped',
                    'incident_id' => $incidentId,
                    'burst_count' => $burstCount,
                    'message' => 'Event grouped into active incident burst window.',
                ], 200);
            }
        } catch (\Throwable $e) {
            Log::warning("Redis burst check failed: {$e->getMessage()}");
        }

        // 4. First occurrence of issue: generate unique incident reference
        $incidentId = 'INC-SYS-' . date('Ymd') . '-' . strtoupper(Str::random(6));

        try {
            Redis::setex($burstKey, $burstCooldown, $incidentId);
            Redis::setex($countKey, $burstCooldown, 1);
        } catch (\Throwable $e) {
            Log::warning("Redis burst cache write failed: {$e->getMessage()}");
        }

        // 5. Persist to system_security_alerts table
        try {
            if (Schema::hasTable('system_security_alerts')) {
                DB::table('system_security_alerts')->insert([
                    'incident_id' => $incidentId,
                    'category' => $category,
                    'severity' => $severity,
                    'service' => $service,
                    'title' => $title,
                    'message' => $message,
                    'context_data' => json_encode($context),
                    'burst_count' => 1,
                    'ip_address' => $ipAddress,
                    'user_agent' => $userAgent,
                    'first_seen_at' => now(),
                    'last_seen_at' => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        } catch (\Throwable $e) {
            Log::error("Failed to insert system_security_alerts: {$e->getMessage()}");
        }

        // 6. Write to security audit logs (AC-5)
        $this->writeAuditLog($incidentId, $category, $severity, $service, $title, $message, $context, false, 1);

        // 7. Resolve Super Admin recipients and insert in-app notifications (AC-2)
        $notificationData = [
            'alert_type' => 'security_alert',
            'incident_id' => $incidentId,
            'category' => $category,
            'severity' => $severity,
            'service' => $service,
            'title' => $title,
            'message' => $message,
            'context' => $context,
            'link' => "/superadmin/audit-logs?incidentId={$incidentId}",
            'created_at' => now()->toIso8601String(),
        ];

        try {
            $adminIds = DB::table('employees')
                ->whereIn(DB::raw('LOWER(role)'), ['superadmin', 'super admin'])
                ->pluck('emp_id');

            if ($adminIds->isEmpty()) {
                // Fallback to employee with ID 1
                $adminIds = collect([1]);
            }

            if (Schema::hasTable('notifications')) {
                foreach ($adminIds as $adminId) {
                    DB::table('notifications')->insert([
                        'recipient_id' => $adminId,
                        'recipient_type' => 'employee',
                        'title' => "System Alert [{$severity}]: {$title}",
                        'message' => $message,
                        'ticket_id' => null,
                        'data' => json_encode($notificationData),
                        'is_read' => false,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                }
            }
        } catch (\Throwable $e) {
            Log::error("Failed to insert Super Admin notifications: {$e->getMessage()}");
        }

        // 8. Broadcast real-time event over Reverb WebSocket
        $this->broadcastAlert($notificationData);

        return response()->json([
            'success' => true,
            'status' => 'alerted',
            'incident_id' => $incidentId,
            'burst_count' => 1,
            'message' => 'System alert registered, persisted, and broadcasted to Super Admins.',
        ], 201);
    }

    /**
     * Resolve burst cooldown seconds from Configuration Service or defaults.
     */
    protected function resolveBurstCooldown(string $category): int
    {
        try {
            $configUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
            $res = Http::timeout(2)->get("{$configUrl}/api/ticket-configurations/system_alert_thresholds");
            if ($res->successful()) {
                $val = $res->json('value') ?? $res->json();
                $catKey = match ($category) {
                    'failed_login_spike', 'failed_login' => 'failed_logins',
                    'unusual_login' => 'unusual_logins',
                    'sql_error', 'database_error' => 'sql_errors',
                    default => 'unhandled_errors',
                };
                if (!empty($val[$catKey]['burst_cooldown_seconds'])) {
                    return (int) $val[$catKey]['burst_cooldown_seconds'];
                }
            }
        } catch (\Throwable $e) {
            // Silently fall back
        }

        return 300; // 5 minutes default
    }

    /**
     * Record security audit log entry.
     */
    protected function writeAuditLog(
        string $incidentId,
        string $category,
        string $severity,
        string $service,
        string $title,
        string $message,
        array $context,
        bool $isBurst,
        int $burstCount
    ): void {
        try {
            if (Schema::hasTable('ticket_audit_logs')) {
                DB::table('ticket_audit_logs')->insert([
                    'ticket_ID' => null,
                    'action_type' => $isBurst ? 'system_alert_burst' : 'system_alert',
                    'action_by_ID' => 1,
                    'actor_type' => 'system',
                    'details' => json_encode([
                        'module' => 'Security & System',
                        'target' => $incidentId,
                        'text' => $isBurst
                            ? "Repeat [{$severity}] {$category} in {$service}: {$title} (Burst count: {$burstCount})"
                            : "[{$severity}] {$category} in {$service}: {$title}",
                        'incident_id' => $incidentId,
                        'category' => $category,
                        'severity' => $severity,
                        'service' => $service,
                        'message' => $message,
                        'context' => $context,
                        'burst_count' => $burstCount,
                    ]),
                    'created_at' => now(),
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning("Failed to write to ticket_audit_logs: {$e->getMessage()}");
        }
    }

    /**
     * Broadcast real-time Reverb notification with retry logic.
     */
    protected function broadcastAlert(array $payload): void
    {
        $maxRetries = 3;
        for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
            try {
                // Check if TicketChanged or broadcast event exists
                if (class_exists(\App\Events\TicketChanged::class)) {
                    event(new \App\Events\TicketChanged([
                        'action' => 'system_alert',
                        'incident' => $payload,
                    ]));
                    return;
                }

                // If event class not bound in notification-service, push via Pusher / Reverb HTTP API
                $pusherAppId = env('PUSHER_APP_ID', 'app-id');
                $pusherKey = env('PUSHER_APP_KEY', 'app-key');
                $pusherSecret = env('PUSHER_APP_SECRET', 'app-secret');
                $pusherHost = env('PUSHER_HOST', 'reverb');
                $pusherPort = env('PUSHER_PORT', 8080);
                $pusherScheme = env('PUSHER_SCHEME', 'http');

                $url = "{$pusherScheme}://{$pusherHost}:{$pusherPort}/apps/{$pusherAppId}/events";
                $body = json_encode([
                    'name' => 'ticket.changed',
                    'channels' => ['ticket-updates'],
                    'data' => json_encode([
                        'action' => 'system_alert',
                        'incident' => $payload,
                    ]),
                ]);

                $authTimestamp = time();
                $authVersion = '1.0';
                $bodyMd5 = md5($body);
                $stringToSign = "POST\n/apps/{$pusherAppId}/events\nauth_key={$pusherKey}&auth_timestamp={$authTimestamp}&auth_version={$authVersion}&body_md5={$bodyMd5}";
                $authSignature = hash_hmac('sha256', $stringToSign, $pusherSecret);

                $fullUrl = "{$url}?auth_key={$pusherKey}&auth_timestamp={$authTimestamp}&auth_version={$authVersion}&body_md5={$bodyMd5}&auth_signature={$authSignature}";

                $res = Http::timeout(2)
                    ->withHeaders(['Content-Type' => 'application/json'])
                    ->withBody($body, 'application/json')
                    ->post($fullUrl);

                if ($res->successful()) {
                    return;
                }
            } catch (\Throwable $e) {
                if ($attempt === $maxRetries) {
                    Log::error("Alerting pipeline: Reverb broadcasting failed after {$maxRetries} attempts: {$e->getMessage()}");
                    // Self-monitoring: write pipeline health log (AC-9)
                    $this->logPipelineHealthFailure($payload['incident_id'] ?? 'UNKNOWN', $e->getMessage());
                } else {
                    usleep(100000 * $attempt); // Exponential backoff: 100ms, 200ms
                }
            }
        }
    }

    /**
     * Record failure in the alerting pipeline's own health monitor (AC-9).
     */
    protected function logPipelineHealthFailure(string $incidentId, string $errorMessage): void
    {
        try {
            if (Schema::hasTable('system_security_alerts')) {
                DB::table('system_security_alerts')->insert([
                    'incident_id' => 'INC-HLTH-' . date('Ymd') . '-' . strtoupper(Str::random(6)),
                    'category' => 'pipeline_health',
                    'severity' => 'high',
                    'service' => 'notification-service',
                    'title' => 'Alerting Pipeline Delivery Failure',
                    'message' => "Reverb broadcast failed for incident {$incidentId}: {$errorMessage}",
                    'context_data' => json_encode(['failed_incident_id' => $incidentId, 'error' => $errorMessage]),
                    'burst_count' => 1,
                    'first_seen_at' => now(),
                    'last_seen_at' => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        } catch (\Throwable $e) {}
    }
}
