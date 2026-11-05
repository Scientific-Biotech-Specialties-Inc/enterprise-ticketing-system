<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Audit Log Retention & Scheduled Purge Configuration
    |--------------------------------------------------------------------------
    |
    | Governs automated and manual pruning of historical records in the
    | ticket_audit_logs table, including safety floors, keyset batch sizes,
    | concurrency lock timeouts, and failure alert routing.
    |
    */

    'purge_default_days' => (int) env('AUDIT_PURGE_DEFAULT_DAYS', 365),

    'purge_chunk_size' => (int) env('AUDIT_PURGE_CHUNK_SIZE', 1000),

    'purge_lock_ttl_minutes' => (int) env('AUDIT_PURGE_LOCK_TTL_MINUTES', 30),

    'safety_floor_days' => 30,

    'default_schedule' => '0 2 * * *',

    'lock_key' => 'audit_purge_in_progress',

    'max_retries' => 3,

    'retry_base_delay_ms' => (int) env('AUDIT_PURGE_RETRY_BASE_DELAY_MS', 100),

    'notification_service_url' => env('NOTIFICATION_SERVICE_URL', 'http://notification-service:8000'),

    'internal_service_token' => env('INTERNAL_SERVICE_SECRET', env('INTERNAL_TOKEN', 'internal-service-token')),
];

