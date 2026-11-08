<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ClientCredential extends Model
{
    use HasFactory;

    protected $table = 'clients_credentials';
    protected $primaryKey = 'client_id';
    public $incrementing = false;
    protected $keyType = 'int';

    protected $fillable = [
        'client_id',
        'password_hash',
        'failed_login_count',
        'locked_until',
        'last_login_at',
        'password_change_at',
    ];

    // Never expose password hash or internal lockout counters in API responses
    protected $hidden = [
        'password_hash',
        'failed_login_count',
        'locked_until',
    ];

    protected $casts = [
        'failed_login_count' => 'integer',
        'locked_until' => 'datetime',
        'last_login_at' => 'datetime',
        'password_change_at' => 'datetime',
    ];

    public function client()
    {
        return $this->belongsTo(Client::class, 'client_id');
    }
}
