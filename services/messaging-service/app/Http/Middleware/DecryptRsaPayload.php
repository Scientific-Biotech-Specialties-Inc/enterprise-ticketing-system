<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class DecryptRsaPayload
{
    /**
     * Handle an incoming request.
     *
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     * @param  string  ...$fields
     */
    public function handle(Request $request, Closure $next, ...$fields)
    {
        \Illuminate\Support\Facades\Log::info('Headers in DecryptRsaPayload: ' . json_encode($request->headers->all()));
        $keyId = $request->header('X-Key-Id');

        if (!$keyId) {
            if (app()->environment('testing')) {
                return $next($request);
            }
            return response()->json(['message' => 'Missing X-Key-Id header for encryption.'], 400);
        }

        $privateKey = Cache::get("rsa_key_{$keyId}");

        if (!$privateKey) {
            return response()->json(['message' => 'Encryption key expired or invalid. Please refresh the page and try again.'], 400);
        }

        foreach ($fields as $field) {
            if ($request->has($field)) {
                $encryptedValue = $request->input($field);
                
                // Decrypt the value using the private key
                $decrypted = '';
                $success = openssl_private_decrypt(base64_decode($encryptedValue), $decrypted, $privateKey);

                if (!$success) {
                    \Illuminate\Support\Facades\Log::error('RSA Decryption Failed');
                    return response()->json(['message' => 'Failed to decrypt payload.'], 400);
                }

                // Replace the encrypted value with the decrypted one in the request
                $request->merge([$field => $decrypted]);
            }
        }

        return $next($request);
    }
}
