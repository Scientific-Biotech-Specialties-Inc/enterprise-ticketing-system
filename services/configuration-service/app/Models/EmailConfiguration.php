<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class EmailConfiguration extends Model
{
    use HasFactory;

    protected $table = 'email_configurations';

    protected $fillable = [
        'provider',
        'api_key',
        'from_name',
        'from_email',
        'is_active',
        'last_tested_at',
    ];

    /**
     * The attributes that should be hidden for serialization.
     * Prevents raw or encrypted api_key from ever leaking into JSON responses.
     */
    protected $hidden = [
        'api_key',
    ];

    /**
     * The attributes that should be cast.
     * Uses Laravel's native AES-256 encrypted casting for database at-rest security.
     */
    protected $casts = [
        'api_key' => 'encrypted',
        'is_active' => 'boolean',
        'last_tested_at' => 'datetime',
    ];

    /**
     * Returns a safe representation with masked API key for frontend consumption.
     */
    public function toMaskedResponse(): array
    {
        $lastTestedFormatted = $this->last_tested_at ? $this->last_tested_at->format('M j, h:i A') : null;

        return [
            'id' => $this->id,
            'provider' => 'Resend',
            'api_key' => 're_•••••••••',
            'apiKey' => 're_•••••••••',
            'from_name' => $this->from_name,
            'fromName' => $this->from_name,
            'from_email' => $this->from_email,
            'fromEmail' => $this->from_email,
            'is_configured' => true,
            'isConfigured' => true,
            'is_active' => (bool) $this->is_active,
            'isActive' => (bool) $this->is_active,
            'last_tested' => $lastTestedFormatted,
            'lastTested' => $lastTestedFormatted,
            'last_tested_at' => $this->last_tested_at?->toISOString(),
        ];
    }
}
