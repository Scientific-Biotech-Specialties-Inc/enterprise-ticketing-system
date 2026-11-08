<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TicketDraft extends Model
{
    protected $table = 'ticket_drafts';

    protected $fillable = [
        'client_id',
        'title',
        'description',
        'machine_ID',
        'problem_category_ID',
        'priority_ID',
        'attachments',
    ];

    protected $casts = [
        'attachments' => 'array',
        'machine_ID' => 'integer',
        'problem_category_ID' => 'integer',
        'priority_ID' => 'integer',
        'client_id' => 'integer',
    ];
}
