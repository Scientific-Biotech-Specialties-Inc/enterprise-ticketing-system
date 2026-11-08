<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ForecastJobRun extends Model
{
    use HasFactory;

    protected $table = 'forecast_job_runs';

    protected $fillable = [
        'job_name',
        'branch_id',
        'status',
        'records_processed',
        'duration_ms',
        'error_message',
        'completed_at',
    ];

    protected $casts = [
        'records_processed' => 'integer',
        'duration_ms' => 'integer',
        'completed_at' => 'datetime',
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'branch_id', 'id');
    }
}

