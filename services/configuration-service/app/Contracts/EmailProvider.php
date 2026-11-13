<?php

namespace App\Contracts;

/**
 * Transactional email provider used by configuration-service (spec 0040).
 *
 * Controllers depend on this contract, never on a vendor class, so the provider
 * can change by binding a different implementation in AppServiceProvider.
 */
interface EmailProvider
{
    /**
     * Human readable provider name, stored in email_configurations.provider.
     */
    public function name(): string;

    /**
     * Verifies that an API key is well formed, active and authorized.
     *
     * @return array{valid: bool, error: ?string}
     */
    public function verifyApiKey(string $apiKey): array;

    /**
     * Sends the delivery verification email used by the SuperAdmin "Send Test Email" action.
     *
     * @return array{success: bool, id: ?string, error: ?string}
     */
    public function sendTestEmail(string $apiKey, string $fromName, string $fromEmail, string $toEmail): array;

    /**
     * Sends an arbitrary transactional HTML email.
     *
     * @return array{success: bool, id: ?string, error: ?string}
     */
    public function sendRawEmail(string $apiKey, string $fromName, string $fromEmail, string $toEmail, string $subject, string $html): array;
}
