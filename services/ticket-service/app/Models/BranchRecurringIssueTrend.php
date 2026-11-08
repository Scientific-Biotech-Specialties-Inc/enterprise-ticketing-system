<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BranchRecurringIssueTrend extends Model
{
    use HasFactory;

    protected $table = 'branch_recurring_issue_trends';

    protected $fillable = [
        'branch_id',
        'issue_type',
        'item_id',
        'item_name',
        'recent_frequency',
        'baseline_frequency',
        'change_percentage',
        'trend_signal',
        'calculated_at',
    ];

    protected $casts = [
        'item_id' => 'integer',
        'recent_frequency' => 'integer',
        'baseline_frequency' => 'float',
        'change_percentage' => 'float',
        'calculated_at' => 'datetime',
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'branch_id', 'id');
    }
}

