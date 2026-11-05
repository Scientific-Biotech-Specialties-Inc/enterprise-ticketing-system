<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TicketAuditLog extends Model
{
    protected $table = 'ticket_audit_logs';

    protected $primaryKey = 'log_ID';

    public $timestamps = false;

    protected $fillable = [
        'ticket_ID',
        'action_type',
        'event_type',
        'action_by_ID',
        'actor_type',
        'actor_role',
        'before_state',
        'after_state',
        'details',
        'is_system',
        'is_internal',
        'created_at',
    ];

    protected $casts = [
        'before_state' => 'array',
        'after_state' => 'array',
        'is_system' => 'boolean',
        'is_internal' => 'boolean',
        'created_at' => 'datetime',
    ];

    /**
     * Permanent Immutability Guard: Invariant 1 (Strict Append Only Ledger).
     */
    protected static function booted()
    {
        static::updating(function () {
            throw new \RuntimeException('Ticket audit logs are permanently immutable and cannot be updated.');
        });

        static::deleting(function () {
            throw new \RuntimeException('Ticket audit logs are permanently immutable and cannot be deleted.');
        });
    }

    public function actor()
    {
        return $this->belongsTo(Employee::class, 'action_by_ID', 'emp_id');
    }
}

