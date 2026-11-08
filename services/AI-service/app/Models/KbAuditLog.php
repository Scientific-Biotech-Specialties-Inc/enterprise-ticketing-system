<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class KbAuditLog extends Model
{
    use HasFactory;

    protected $table = 'kb_audit_logs';

    protected $fillable = [
        'article_id',
        'article_title',
        'action',
        'actor',
        'actor_role',
        'module',
        'details',
        'ip_address',
    ];

    protected $casts = [
        'details' => 'array',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];
}
