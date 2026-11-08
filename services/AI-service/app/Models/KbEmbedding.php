<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class KbEmbedding extends Model
{
    use HasFactory;

    protected $table = 'kb_embeddings';

    protected $fillable = [
        'chunk_id',
        'article_id',
        'embedding',
        'dimensions',
        'embedding_model',
        'is_active',
    ];

    protected $casts = [
        'embedding' => 'array',
        'is_active' => 'boolean',
        'dimensions' => 'integer',
    ];

    public function chunk()
    {
        return $this->belongsTo(KbChunk::class, 'chunk_id');
    }

    public function article()
    {
        return $this->belongsTo(KbArticle::class, 'article_id');
    }
}
