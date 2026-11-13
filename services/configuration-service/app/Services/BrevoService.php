<?php

namespace App\Services;

use App\Contracts\EmailProvider;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Brevo (formerly Sendinblue) transactional email provider, REST API v3 (spec 0040).
 *
 * Auth uses the `api-key` header with an API v3 key (`xkeysib-...`). Brevo SMTP keys
 * (`xsmtpsib-...`) only work on the SMTP relay and are rejected here with a clear message.
 */
class BrevoService implements EmailProvider
{
    public const NAME = 'Brevo';

    public const MASK = 'xkeysib-•••••••••';

    protected const API_BASE = 'https://api.brevo.com/v3';

    protected const API_KEY_PREFIX = 'xkeysib-';

    protected const SMTP_KEY_PREFIX = 'xsmtpsib-';

    public function name(): string
    {
        return self::NAME;
    }

    /**
     * Live verification against Brevo: GET /v3/account returns 200 for a valid key.
     */
    public function verifyApiKey(string $apiKey): array
    {
        $key = trim($apiKey);

        if ($key === '') {
            return $this->invalid('API Key is required and cannot be empty.');
        }

        if (str_starts_with($key, self::SMTP_KEY_PREFIX)) {
            return $this->invalid('This is a Brevo SMTP key. Paste an API v3 key (starts with "xkeysib-") instead.');
        }

        if (!str_starts_with($key, self::API_KEY_PREFIX)) {
            return $this->invalid('API Key format is invalid. Brevo API v3 keys must start with "xkeysib-".');
        }

        // Allow mock/dev keys in local environments
        if (app()->environment('local') && (str_starts_with($key, 'xkeysib-test') || str_starts_with($key, 'xkeysib-dev'))) {
            return ['valid' => true, 'error' => null];
        }

        try {
            $response = $this->client($key, 8)->get(self::API_BASE . '/account');

            if ($response->successful()) {
                return ['valid' => true, 'error' => null];
            }

            $status = $response->status();
            $message = (string) ($response->json('message') ?? 'Brevo returned an unexpected response.');

            Log::warning('Brevo API key verification rejected', ['status' => $status, 'error' => $message]);

            if ($status === 401 && stripos($message, 'unrecognised ip') !== false) {
                return $this->invalid('Brevo blocked this server\'s IP address. Add it under Security > Authorised IPs in your Brevo account, then try again.');
            }

            if ($status === 401) {
                return $this->invalid('Brevo rejected this API key. It may be invalid or revoked.');
            }

            return $this->invalid("Brevo API key verification failed ({$status}): {$message}");
        } catch (\Throwable $e) {
            Log::error('Brevo API connection error during key verification: ' . $e->getMessage());

            return $this->invalid('Unable to reach Brevo. Please check your network or try again.');
        }
    }

    /**
     * Dispatches the delivery verification email.
     */
    public function sendTestEmail(string $apiKey, string $fromName, string $fromEmail, string $toEmail): array
    {
        $formattedFrom = $fromName !== '' ? "{$fromName} <{$fromEmail}>" : $fromEmail;

        $html = '
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px;">
                <h2 style="color: #252578; margin-bottom: 12px;">Enterprise Ticketing System</h2>
                <p style="font-size: 15px; color: #374151; line-height: 1.5;">This is a test notification confirming that your Brevo email delivery gateway has been successfully configured and validated.</p>
                <div style="background-color: #f3f4f6; padding: 12px 16px; border-radius: 6px; font-size: 13px; color: #4b5563; margin: 16px 0;">
                    <strong>Sender:</strong> ' . htmlspecialchars($formattedFrom) . '<br/>
                    <strong>Recipient:</strong> ' . htmlspecialchars($toEmail) . '<br/>
                    <strong>Timestamp:</strong> ' . now()->toRfc850String() . '
                </div>
                <p style="font-size: 12px; color: #9ca3af;">You are receiving this email because a Super Admin initiated a test email verification in the Ticket Configuration settings.</p>
            </div>
        ';

        return $this->sendRawEmail(
            $apiKey,
            $fromName,
            $fromEmail,
            $toEmail,
            'Verification Email: Brevo Delivery Gateway Configured',
            $html
        );
    }

    /**
     * Sends an arbitrary transactional email via POST /v3/smtp/email.
     */
    public function sendRawEmail(string $apiKey, string $fromName, string $fromEmail, string $toEmail, string $subject, string $html): array
    {
        $sender = ['email' => trim($fromEmail)];
        if (trim($fromName) !== '') {
            $sender['name'] = trim($fromName);
        }

        try {
            $response = $this->client(trim($apiKey), 10)->post(self::API_BASE . '/smtp/email', [
                'sender'      => $sender,
                'to'          => [['email' => trim($toEmail)]],
                'subject'     => $subject,
                'htmlContent' => $html,
            ]);

            if ($response->successful()) {
                return [
                    'success' => true,
                    'id'      => $response->json('messageId'),
                    'error'   => null,
                ];
            }

            $error = (string) ($response->json('message') ?? 'Failed to dispatch email through Brevo.');

            Log::warning('Brevo email dispatch failed', [
                'status' => $response->status(),
                'code'   => $response->json('code'),
                'error'  => $error,
            ]);

            return ['success' => false, 'id' => null, 'error' => $error];
        } catch (\Throwable $e) {
            Log::error('Brevo email dispatch exception: ' . $e->getMessage());

            return ['success' => false, 'id' => null, 'error' => 'Failed to reach Brevo: ' . $e->getMessage()];
        }
    }

    protected function client(string $apiKey, int $timeout)
    {
        return Http::withHeaders(['api-key' => $apiKey])
            ->acceptJson()
            ->asJson()
            ->timeout($timeout);
    }

    /**
     * @return array{valid: bool, error: string}
     */
    protected function invalid(string $error): array
    {
        return ['valid' => false, 'error' => $error];
    }
}
