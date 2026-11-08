<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DailyEmployeePerformance extends Model
{
    use HasFactory;

    protected $table = 'daily_employee_performance';

    protected $fillable = [
        'branch_id',
        'employee_id',
        'date',
        'tickets_assigned',
        'tickets_resolved',
        'total_resolution_seconds',
        'sla_met_count',
        'sla_breached_count',
        'reassignments_approved',
        'csat_sum',
        'csat_count',
    ];

    protected $casts = [
        'date' => 'date',
        'tickets_assigned' => 'integer',
        'tickets_resolved' => 'integer',
        'total_resolution_seconds' => 'integer',
        'sla_met_count' => 'integer',
        'sla_breached_count' => 'integer',
        'reassignments_approved' => 'integer',
        'csat_sum' => 'float',
        'csat_count' => 'integer',
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'branch_id', 'id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'employee_id', 'emp_id');
    }
}

