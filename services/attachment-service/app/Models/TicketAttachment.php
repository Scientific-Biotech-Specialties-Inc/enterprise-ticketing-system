<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TicketAttachment extends Model
{
    protected $table = 'ticket_attachments';
    protected $primaryKey = 'attachment_id';
    public $timestamps = false;

    protected $fillable = [
        'ticket_id',
        'file_name',
        'file_path',
        'file_type',
        'uploaded_at',
        'uploaded_by_id',
        'uploaded_by_type'
    ];

    protected $casts = [
        'uploaded_at' => 'datetime',
        'ticket_id' => 'integer'
    ];
}
