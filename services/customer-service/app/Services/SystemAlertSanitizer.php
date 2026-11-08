<?php

namespace App\Services;

class SystemAlertSanitizer
{
    protected static array $sensitiveKeys = [
        'password',
        'passwd',
        'current_password',
        'new_password',
        'password_confirmation',
        'secret',
        'api_key',
        'apikey',
        'token',
        'access_token',
        'refresh_token',
        'bearer',
        'authorization',
        'private_key',
        'client_secret',
        'encryption_key',
        'database_url',
        'db_password',
        'redis_password',
    ];

    public static function scrub(mixed $data): mixed
    {
        if (is_null($data) || is_bool($data) || is_numeric($data)) {
            return $data;
        }

        if (is_string($data)) {
            return self::scrubString($data);
        }

        if (is_array($data)) {
            $cleaned = [];
            foreach ($data as $key => $value) {
                $lowerKey = strtolower((string) $key);
                $isSensitive = false;
                foreach (self::$sensitiveKeys as $pattern) {
                    if (str_contains($lowerKey, $pattern)) {
                        $isSensitive = true;
                        break;
                    }
                }

                if ($isSensitive) {
                    $cleaned[$key] = '[REDACTED]';
                } else {
                    $cleaned[$key] = self::scrub($value);
                }
            }
            return $cleaned;
        }

        if (is_object($data)) {
            return self::scrub((array) $data);
        }

        return $data;
    }

    public static function scrubString(string $text): string
    {
        $text = preg_replace('/(Bearer\s+)[A-Za-z0-9\-_\.=]+/i', '$1[REDACTED_TOKEN]', $text);

        foreach (self::$sensitiveKeys as $key) {
            $text = preg_replace('/(' . preg_quote($key, '/') . '\s*[:=]\s*)[^\s,;&"\']+/i', '$1[REDACTED]', $text);
        }

        $text = preg_replace('/(mysql|postgres|postgresql|redis|mongodb):\/\/([^:]+):([^@]+)@/i', '$1://$2:[REDACTED]@', $text);
        $text = preg_replace('/-----BEGIN [A-Z0-9_-]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z0-9_-]+ PRIVATE KEY-----/i', '[REDACTED_PRIVATE_KEY]', $text);
        $text = str_replace(['/var/www/html/', 'c:\\Users\\Shelley\\Desktop\\projects\\php\\enterprise-ticketing-system\\'], ['', ''], $text);

        return $text;
    }
}
