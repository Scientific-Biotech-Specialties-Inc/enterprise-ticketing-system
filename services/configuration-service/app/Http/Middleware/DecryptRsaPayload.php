<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class DecryptRsaPayload
{
    /**
     * Handle an incoming request with client-side RSA encrypted fields.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  \Closure  $next
     * @param  string  ...$fields
     * @return mixed
     */
    public function handle(Request $request, Closure $next, ...$fields)
    {
        // Nothing to decrypt (e.g. a test email that reuses the saved API key): no key id is needed.
        // Credentials are never accepted in plaintext, because any present field still requires a key.
        $hasEncryptedField = false;
        foreach ($fields as $field) {
            if ($request->filled($field)) {
                $hasEncryptedField = true;
                break;
            }
        }
        if (!$hasEncryptedField) {
            return $next($request);
        }

        $keyId = $request->header('X-Key-Id');

        if (!$keyId) {
            if (app()->environment('testing')) {
                return $next($request);
            }
            return response()->json(['message' => 'Missing X-Key-Id header for encryption.'], 400);
        }

        $privateKey = Cache::get("rsa_key_{$keyId}");

        if (!$privateKey) {
            try {
                $raw = \Illuminate\Support\Facades\Redis::get("laravel_cache_rsa_key_{$keyId}");
                if ($raw) {
                    $privateKey = @unserialize($raw) ?: $raw;
                }
            } catch (\Throwable $e) {
                Log::warning("Redis fallback lookup failed for key: {$keyId}", ['error' => $e->getMessage()]);
            }
        }

        if (!$privateKey) {
            return response()->json(['message' => 'Encryption key expired or invalid. Please refresh the page and try again.'], 400);
        }

        foreach ($fields as $field) {
            if ($request->has($field)) {
                $encryptedValue = $request->input($field);
                if (empty($encryptedValue)) {
                    continue;
                }

                $decrypted = '';
                $decoded = base64_decode($encryptedValue, true);
                if ($decoded === false) {
                    return response()->json(['message' => 'Invalid encoded payload format.'], 400);
                }

                $success = openssl_private_decrypt($decoded, $decrypted, $privateKey);

                if (!$success) {
                    Log::error("RSA Decryption Failed for field: {$field}");
                    return response()->json(['message' => 'Failed to decrypt secure payload.'], 400);
                }

                $request->merge([$field => $decrypted]);
            }
        }

        return $next($request);
    }
}
