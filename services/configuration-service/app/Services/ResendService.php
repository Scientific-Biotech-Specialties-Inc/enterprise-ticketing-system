<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ResendService
{
    protected const API_BASE = 'https://api.resend.com';

    /**
     * Live ping verification against Resend API.
     * Verifies that the provided API key is valid, active, and authorized.
     */
    public function verifyApiKey(string $apiKey): array
    {
        $trimmedKey = trim($apiKey);

        if (empty($trimmedKey) || !str_starts_with($trimmedKey, 're_')) {
            return [
                'valid' => false,
                'error' => 'API Key format is invalid. Resend API keys must start with "re_".',
            ];
        }

        // Allow mock/dev keys in local environments
        if (app()->environment('local') && (
            str_starts_with($trimmedKey, 're_test_')
            || str_starts_with($trimmedKey, 're_dev_')
            || $trimmedKey === 're_placeholder_key'
            || !preg_match('/^re_[A-Za-z0-9]{30,}$/', $trimmedKey)
        )) {
            return [
                'valid' => true,
                'error' => null,
            ];
        }

        try {
            $response = Http::withToken($trimmedKey)
                ->timeout(8)
                ->acceptJson()
                ->get(self::API_BASE . '/api-keys');

            if ($response->successful()) {
                return [
                    'valid' => true,
                    'error' => null,
                ];
            }

            $statusCode = $response->status();
            $body = $response->json();
            $message = $body['message'] ?? 'Provider returned an unauthorized or forbidden response.';

            // Resend returns "This API key is restricted to only send emails" when a valid,
            // active sending-only (least-privilege) API key is used against management endpoints.
            if (
                ($statusCode === 401 || $statusCode === 403) &&
                (stripos($message, 'only send emails') !== false || stripos($message, 'restricted to send') !== false)
            ) {
                Log::info('Resend API key validated as active sending-access key.');
                return [
                    'valid' => true,
                    'error' => null,
                ];
            }

            Log::warning('Resend API key ping validation rejected', [
                'status' => $statusCode,
                'error' => $message,
            ]);

            return [
                'valid' => false,
                'error' => "Resend API key verification failed ({$statusCode}): {$message}",
            ];
        } catch (\Throwable $e) {
            Log::error('Resend API connection error during ping verification: ' . $e->getMessage());
            if (app()->environment('local')) {
                return [
                    'valid' => true,
                    'error' => null,
                ];
            }
            return [
                'valid' => false,
                'error' => 'Unable to reach Resend API gateway. Please check your network or try again.',
            ];
        }
    }

    /**
     * Dispatches a test email through Resend API.
     */
    public function sendTestEmail(string $apiKey, string $fromName, string $fromEmail, string $toEmail): array
    {
        $formattedFrom = !empty($fromName) ? "{$fromName} <{$fromEmail}>" : $fromEmail;

        try {
            $response = Http::withToken(trim($apiKey))
                ->timeout(10)
                ->acceptJson()
                ->post(self::API_BASE . '/emails', [
                    'from' => $formattedFrom,
                    'to' => [trim($toEmail)],
                    'subject' => 'Verification Email: Resend Delivery Gateway Configured',
                    'html' => '
                        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px;">
                            <h2 style="color: #252578; margin-bottom: 12px;">Enterprise Ticketing System</h2>
                            <p style="font-size: 15px; color: #374151; line-height: 1.5;">This is a test notification confirming that your Resend email delivery gateway has been successfully configured and validated.</p>
                            <div style="background-color: #f3f4f6; padding: 12px 16px; border-radius: 6px; font-size: 13px; color: #4b5563; margin: 16px 0;">
                                <strong>Sender:</strong> ' . htmlspecialchars($formattedFrom) . '<br/>
                                <strong>Recipient:</strong> ' . htmlspecialchars($toEmail) . '<br/>
                                <strong>Timestamp:</strong> ' . now()->toRfc850String() . '
                            </div>
                            <p style="font-size: 12px; color: #9ca3af;">You are receiving this email because a Super Admin initiated a test email verification in the Ticket Configuration settings.</p>
                        </div>
                    ',
                ]);

            if ($response->successful()) {
                $data = $response->json();
                return [
                    'success' => true,
                    'id' => $data['id'] ?? null,
                    'error' => null,
                ];
            }

            $body = $response->json();
            $errorMsg = $body['message'] ?? 'Failed to send test email through Resend.';

            Log::warning('Resend test email failed', [
                'status' => $response->status(),
                'error' => $errorMsg,
            ]);

            return [
                'success' => false,
                'error' => $errorMsg,
            ];
        } catch (\Throwable $e) {
            Log::error('Resend test email dispatch exception: ' . $e->getMessage());
            return [
                'success' => false,
                'error' => 'Failed to reach Resend API: ' . $e->getMessage(),
            ];
        }
    }

    /**
     * Sends an arbitrary transactional email via Resend using the active configuration.
     */
    public function sendRawEmail(string $apiKey, string $fromName, string $fromEmail, string $toEmail, string $subject, string $html): array
    {
        $formattedFrom = !empty($fromName) ? "{$fromName} <{$fromEmail}>" : $fromEmail;

        try {
            $response = Http::withToken(trim($apiKey))
                ->timeout(10)
                ->acceptJson()
                ->post(self::API_BASE . '/emails', [
                    'from' => $formattedFrom,
                    'to' => [trim($toEmail)],
                    'subject' => $subject,
                    'html' => $html,
                ]);

            if ($response->successful()) {
                $data = $response->json();
                return [
                    'success' => true,
                    'id' => $data['id'] ?? null,
                    'error' => null,
                ];
            }

            $body = $response->json();
            $errorMsg = $body['message'] ?? 'Failed to dispatch email through Resend.';

            Log::warning('Resend email dispatch failed', [
                'status' => $response->status(),
                'error' => $errorMsg,
            ]);

            return [
                'success' => false,
                'error' => $errorMsg,
            ];
        } catch (\Throwable $e) {
            Log::error('Resend email dispatch exception: ' . $e->getMessage());
            return [
                'success' => false,
                'error' => 'Failed to reach Resend API: ' . $e->getMessage(),
            ];
        }
    }
}
