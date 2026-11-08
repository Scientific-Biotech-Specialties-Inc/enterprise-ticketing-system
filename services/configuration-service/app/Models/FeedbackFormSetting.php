<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class FeedbackFormSetting extends Model
{
    use HasFactory;

    protected $table = 'feedback_form_settings';

    protected $fillable = [
        'key',
        'is_enabled',
        'description',
        'updated_by',
    ];

    protected $casts = [
        'is_enabled' => 'boolean',
    ];

    /**
     * Check if customer feedback forms and analytics collection are globally enabled.
     */
    public static function isFeedbackFormEnabled(): bool
    {
        return (bool) static::where('key', 'master_toggle')->value('is_enabled') ?? true;
    }
}
