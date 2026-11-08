<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Passport\HasApiTokens;

class Client extends Authenticatable
{
    use HasFactory;
    use HasApiTokens;

    protected $fillable = [ 
        'client_name',
        'address',
        'contact_number',
        'email',
    ];

    protected $hidden = [
        'credential',
    ];

    protected $casts = [
        'status' => 'boolean',
    ];

    public function credential()
    {
        return $this->hasOne(ClientCredential::class, 'client_id');
    }
}
