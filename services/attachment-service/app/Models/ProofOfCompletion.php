<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProofOfCompletion extends Model
{
    protected $table = 'proof_of_completion';
    protected $primaryKey = 'proof_ID';
    public $timestamps = false;

    protected $fillable = [
        'assignment_ID',
        'file_name',
        'file_path',
        'file_type',
        'file_size',
        'uploaded_at',
        'uploaded_by_id',
        'uploaded_by_type'
    ];

    protected $casts = [
        'uploaded_at' => 'datetime',
        'assignment_ID' => 'integer',
        'file_size' => 'integer'
    ];
}
