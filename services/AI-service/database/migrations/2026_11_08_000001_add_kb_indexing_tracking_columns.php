<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0036: track which model produced each embedding, the hash of the indexed text,
 * the last indexing failure, and the self retrieval probe score.
 * Every column is nullable so the rollout is safe on a live database.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('kb_embeddings', function (Blueprint $table) {
            if (!Schema::hasColumn('kb_embeddings', 'embedding_model')) {
                $table->string('embedding_model', 64)->nullable()->after('dimensions');
                $table->index('embedding_model', 'idx_kb_embeddings_model');
            }
        });

        Schema::table('kb_articles', function (Blueprint $table) {
            if (!Schema::hasColumn('kb_articles', 'content_hash')) {
                $table->char('content_hash', 64)->nullable()->after('processing_status');
            }
            if (!Schema::hasColumn('kb_articles', 'index_error')) {
                $table->text('index_error')->nullable()->after('content_hash');
            }
            if (!Schema::hasColumn('kb_articles', 'probe_score')) {
                $table->decimal('probe_score', 5, 4)->nullable()->after('index_error');
            }
        });

        // Every vector stored before this migration came from the crc32 word hash fallback
        // (text-embedding-004 returned 404). Label them so retrieval can exclude them.
        DB::table('kb_embeddings')
            ->whereNull('embedding_model')
            ->update(['embedding_model' => 'hash-fallback-v1']);
    }

    public function down(): void
    {
        Schema::table('kb_embeddings', function (Blueprint $table) {
            if (Schema::hasColumn('kb_embeddings', 'embedding_model')) {
                $table->dropIndex('idx_kb_embeddings_model');
                $table->dropColumn('embedding_model');
            }
        });

        Schema::table('kb_articles', function (Blueprint $table) {
            foreach (['content_hash', 'index_error', 'probe_score'] as $column) {
                if (Schema::hasColumn('kb_articles', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
