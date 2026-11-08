<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;

class AuditRetentionSetting extends Model
{
    use HasFactory;

    public const MIN_RETENTION_DAYS = 30;

    protected $table = 'audit_retention_settings';

    protected $fillable = [
        'retention_days',
        'is_auto_purge_enabled',
        'purge_schedule',
        'chunk_size',
        'updated_by_id',
    ];

    protected $casts = [
        'retention_days' => 'integer',
        'is_auto_purge_enabled' => 'boolean',
        'chunk_size' => 'integer',
        'updated_by_id' => 'integer',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::saving(function (self $setting): void {
            $floor = (int) config('audit.safety_floor_days', self::MIN_RETENTION_DAYS);
            if ((int) $setting->retention_days < $floor) {
                throw new InvalidArgumentException(
                    "Audit log retention period cannot be configured below {$floor} days."
                );
            }
        });
    }

    /**
     * Retrieve the active singleton retention policy, creating the default record if absent.
     */
    public static function current(): self
    {
        $setting = static::query()->orderBy('id')->first();
        if ($setting) {
            return $setting;
        }

        $floor = (int) config('audit.safety_floor_days', self::MIN_RETENTION_DAYS);
        $defaultDays = max($floor, (int) config('audit.purge_default_days', 365));
        $defaultChunkSize = max(1, (int) config('audit.purge_chunk_size', 1000));

        return static::query()->create([
            'retention_days' => $defaultDays,
            'is_auto_purge_enabled' => true,
            'purge_schedule' => (string) config('audit.default_schedule', '0 2 * * *'),
            'chunk_size' => $defaultChunkSize,
            'updated_by_id' => null,
        ]);
    }
}

