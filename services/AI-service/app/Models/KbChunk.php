<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class KbChunk extends Model
{
    use HasFactory;

    protected $table = 'kb_chunks';

    protected $fillable = [
        'article_id',
        'chunk_index',
        'content',
        'token_count',
        'metadata',
    ];

    protected $casts = [
        'metadata' => 'array',
    ];

    public function article()
    {
        return $this->belongsTo(KbArticle::class, 'article_id');
    }

    public function embedding()
    {
        return $this->hasOne(KbEmbedding::class, 'chunk_id');
    }
}
