<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BranchTicketForecast extends Model
{
    use HasFactory;

    protected $table = 'branch_ticket_forecasts';

    protected $fillable = [
        'branch_id',
        'forecast_date',
        'predicted_volume',
        'lower_bound',
        'upper_bound',
        'historical_days_used',
        'calculation_status',
        'calculated_at',
    ];

    protected $casts = [
        'forecast_date' => 'date',
        'predicted_volume' => 'integer',
        'lower_bound' => 'integer',
        'upper_bound' => 'integer',
        'historical_days_used' => 'integer',
        'calculated_at' => 'datetime',
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'branch_id', 'id');
    }
}

