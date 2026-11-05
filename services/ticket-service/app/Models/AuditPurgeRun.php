<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use RuntimeException;

class AuditPurgeRun extends Model
{
    use HasFactory;

    protected $table = 'audit_purge_runs';

    public $timestamps = false;

    protected $fillable = [
        'trigger_source',
        'retention_days',
        'cutoff_timestamp',
        'records_identified',
        'records_deleted',
        'duration_ms',
        'status',
        'error_message',
        'executed_by_id',
        'created_at',
    ];

    protected $casts = [
        'retention_days' => 'integer',
        'cutoff_timestamp' => 'datetime',
        'records_identified' => 'integer',
        'records_deleted' => 'integer',
        'duration_ms' => 'integer',
        'executed_by_id' => 'integer',
        'created_at' => 'datetime',
    ];

    /**
     * Permanent Immutability Guard: Records in audit_purge_runs can never be updated or deleted.
     */
    protected static function booted(): void
    {
        static::creating(function (self $run): void {
            if ($run->created_at === null) {
                $run->created_at = now();
            }
        });

        static::updating(function (): void {
            throw new RuntimeException('Audit purge run records are permanently immutable and cannot be updated.');
        });

        static::deleting(function (): void {
            throw new RuntimeException('Audit purge run records are permanently immutable and cannot be deleted.');
        });
    }

    /**
     * Format the purge run meta-log record for API serialization.
     */
    public function toApiArray(): array
    {
        return [
            'id' => $this->id,
            'trigger_source' => $this->trigger_source,
            'retention_days' => (int) $this->retention_days,
            'cutoff_timestamp' => $this->cutoff_timestamp?->toIso8601String(),
            'records_identified' => (int) $this->records_identified,
            'records_deleted' => (int) $this->records_deleted,
            'duration_ms' => (int) $this->duration_ms,
            'status' => $this->status,
            'error_message' => $this->error_message,
            'executed_by_id' => $this->executed_by_id,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}

