<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;

class TicketConfiguration extends Model
{
    use HasFactory;

    protected $table = 'ticket_configurations';

    protected $fillable = [
        'key',
        'value',
    ];

    protected $casts = [
        'value' => 'array',
    ];

    /**
     * Retrieve configuration value by section key, returning default if not found.
     */
    public static function getByKey(string $key, mixed $default = null): mixed
    {
        return Cache::remember("ticket_configuration:{$key}", 3600, function () use ($key, $default) {
            $record = static::where('key', $key)->first();
            return $record ? $record->value : $default;
        });
    }

    /**
     * Store or update configuration value by section key.
     */
    public static function setByKey(string $key, mixed $value): self
    {
        Cache::forget("ticket_configuration:{$key}");
        return static::updateOrCreate(
            ['key' => $key],
            ['value' => $value]
        );
    }
}
