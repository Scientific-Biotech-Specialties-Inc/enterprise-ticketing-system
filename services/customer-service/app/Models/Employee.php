<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Passport\HasApiTokens;

class Employee extends Authenticatable
{
    use HasApiTokens;
    use HasFactory;

    protected $table = 'employees';
    protected $primaryKey = 'emp_id';
    public $timestamps = false;

    protected $fillable = [
        'email',
        'phone_number',
        'password_hash',
        'first_name',
        'last_name',
        'role',
        'position_level',
        'technical_role',
        'department',
        'branch',
        'branch_id',
        'is_active',
        'failed_login_count',
        'locked_until',
        'last_login_at',
        'last_seen_at',
        'password_change_at',
    ];

    protected $hidden = [
        'password_hash',
    ];

    protected $appends = [
        'name',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'failed_login_count' => 'integer',
        'locked_until' => 'datetime',
        'last_login_at' => 'datetime',
        'last_seen_at' => 'datetime',
        'password_change_at' => 'datetime',
    ];

    public function getNameAttribute(): string
    {
        $fullName = trim("{$this->first_name} {$this->last_name}");
        return $fullName !== '' ? $fullName : ($this->email ?? 'Employee');
    }

    public function getAuthPassword()
    {
        return $this->password_hash;
    }
}
