<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class CustomerFeedback extends Model
{
    use HasFactory;

    protected $table = 'customer_feedback';

    protected $fillable = [
        'ticket_id',
        'customer_id',
        'overall_rating',
        'overall_comment',
        'employee_ratings',
        'question_answers',
        'category_questions_snapshot',
    ];

    protected $casts = [
        'overall_rating'              => 'float',
        'employee_ratings'            => 'array',
        'question_answers'            => 'array',
        'category_questions_snapshot' => 'array',
    ];
}
