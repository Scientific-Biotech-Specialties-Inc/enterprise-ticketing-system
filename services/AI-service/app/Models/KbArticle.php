<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class KbArticle extends Model
{
    use HasFactory;

    protected $table = 'kb_articles';

    protected $fillable = [
        'title',
        'category',
        'machine',
        'version',
        'file_type',
        'file_path',
        'uploaded_by',
        'size',
        'status',
        'processing_status',
        'content_hash',
        'index_error',
        'probe_score',
        'tags',
        'description',
        'content',
        'history',
        'published_at',
        'archived_at',
    ];

    protected $casts = [
        'tags' => 'array',
        'history' => 'array',
        'published_at' => 'datetime',
        'archived_at' => 'datetime',
        'probe_score' => 'float',
    ];

    public function chunks()
    {
        return $this->hasMany(KbChunk::class, 'article_id')->orderBy('chunk_index');
    }

    public function embeddings()
    {
        return $this->hasMany(KbEmbedding::class, 'article_id');
    }

    public function isPublished(): bool
    {
        return $this->status === 'Published';
    }

    public function isArchived(): bool
    {
        return $this->status === 'Archived';
    }
}
