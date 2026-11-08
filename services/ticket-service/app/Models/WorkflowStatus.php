<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class WorkflowStatus extends Model
{
    use HasFactory;

    protected $table = 'workflow_statuses';

    protected $fillable = [
        'name',
        'description',
        'bg_color',
        'text_color',
        'order_position',
        'is_system',
        'requires_previous_fulfilled',
        'prerequisite_status_id',
    ];

    protected $casts = [
        'is_system' => 'boolean',
        'requires_previous_fulfilled' => 'boolean',
        'order_position' => 'integer',
        'prerequisite_status_id' => 'integer',
    ];

    public function prerequisite()
    {
        return $this->belongsTo(WorkflowStatus::class, 'prerequisite_status_id');
    }

    public function dependents()
    {
        return $this->hasMany(WorkflowStatus::class, 'prerequisite_status_id');
    }
}
