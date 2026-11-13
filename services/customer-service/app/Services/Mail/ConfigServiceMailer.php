<?php

namespace App\Services\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Sends email through configuration-service first (Brevo API, SuperAdmin managed key and
 * sender), and falls back to Laravel Mail over the Brevo SMTP relay when that call fails
 * (spec 0040, AC-7 and AC-8).
 *
 * The same class lives in customer-service, employee-service and messaging-service; keep the
 * copies in step. Neither the email HTML nor the recipient's full address is ever logged.
 */
class ConfigServiceMailer
{
    public const CATEGORY_SECURITY = 'security';

    public const CATEGORY_NOTIFICATION = 'notification';

    /** Service name written to fallback logs (differs per copy). */
    protected const SERVICE = 'customer-service';

    /**
     * Sends a Mailable. Returns true when either path accepted it (or configuration-service
     * deliberately skipped it). Throws when the SMTP backup also fails, so callers keep their
     * existing error handling.
     */
    public function send(string $to, Mailable $mailable, ?string $alertKey = null, ?string $category = null): bool
    {
        $subject = $this->subjectOf($mailable);
        $html = $mailable->render();

        if ($this->sendViaConfigurationService($to, $subject, $html, $alertKey, $category)) {
            return true;
        }

        Mail::to($to)->send($mailable);

        return true;
    }

    /**
     * Sends raw HTML (for callers that do not build a Mailable).
     */
    public function sendHtml(string $to, string $subject, string $html, ?string $alertKey = null, ?string $category = null, ?string $eventKey = null): bool
    {
        if ($this->sendViaConfigurationService($to, $subject, $html, $alertKey, $category, $eventKey)) {
            return true;
        }

        Mail::html($html, function ($message) use ($to, $subject) {
            $message->to($to)->subject($subject);
        });

        return true;
    }

    /**
     * Posts to configuration-service. Returns false (after one warning log) when the caller
     * should fall back to SMTP: timeout, connection error, non 2xx, or a 2xx with status=error.
     * A status=skipped reply is a deliberate outcome (notification channel set to in app only).
     */
    protected function sendViaConfigurationService(string $to, string $subject, string $html, ?string $alertKey, ?string $category, ?string $eventKey = null): bool
    {
        $isSecurity = $category === self::CATEGORY_SECURITY;
        $baseUrl = rtrim((string) env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000'), '/');

        $payload = array_filter([
            'to' => $to,
            'subject' => $subject,
            'html' => $html,
            'alert_key' => $alertKey,
            'event_key' => $eventKey,
            'category' => $category,
        ], fn ($value) => $value !== null);

        try {
            $request = Http::timeout($isSecurity ? 5 : 6)
                ->acceptJson()
                ->withHeaders(['X-Internal-Token' => (string) env('INTERNAL_TOKEN', '')]);

            // Security mail: no retry, so the user is not kept waiting before the SMTP backup.
            if (!$isSecurity) {
                $request = $request->retry(2, 100, null, false);
            }

            $response = $request->post("{$baseUrl}/api/email/dispatch", $payload);

            if ($response->successful() && $response->json('status') !== 'error') {
                return true;
            }

            $reason = 'HTTP ' . $response->status() . ($response->json('error') ? ': ' . $response->json('error') : '');
        } catch (\Throwable $e) {
            $reason = class_basename($e) . ': ' . $e->getMessage();
        }

        Log::warning('Email sent through SMTP backup because configuration-service failed', [
            'service' => static::SERVICE,
            'recipient_domain' => $this->domainOf($to),
            'category' => $category ?? self::CATEGORY_NOTIFICATION,
            'reason' => $reason,
        ]);

        return false;
    }

    protected function subjectOf(Mailable $mailable): string
    {
        if (!empty($mailable->subject)) {
            return (string) $mailable->subject;
        }

        if (method_exists($mailable, 'envelope')) {
            $subject = $mailable->envelope()->subject ?? null;
            if (!empty($subject)) {
                return (string) $subject;
            }
        }

        return 'Notification';
    }

    protected function domainOf(string $email): string
    {
        $at = strrpos($email, '@');

        return $at === false ? 'unknown' : strtolower(substr($email, $at + 1));
    }
}
