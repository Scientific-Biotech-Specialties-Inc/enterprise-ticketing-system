<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (!Schema::hasTable('kb_articles')) {
            Schema::create('kb_articles', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->string('title');
                $table->string('category', 100)->default('Troubleshooting Guides');
                $table->string('machine', 100)->nullable();
                $table->string('version', 20)->default('1.0');
                $table->string('file_type', 20)->default('PDF');
                $table->string('uploaded_by', 100)->default('Super Admin');
                $table->string('size', 50)->default('1.5 MB');
                $table->enum('status', ['Draft', 'Published', 'Archived'])->default('Draft');
                $table->string('processing_status', 50)->default('Ready for AI Search');
                $table->json('tags')->nullable();
                $table->text('description')->nullable();
                $table->longText('content')->nullable();
                $table->json('history')->nullable();
                $table->timestamp('published_at')->nullable();
                $table->timestamp('archived_at')->nullable();
                $table->timestamps();

                $table->index('status', 'idx_kb_articles_status');
                $table->index('category', 'idx_kb_articles_category');
                $table->index('machine', 'idx_kb_articles_machine');
                $table->index('created_at', 'idx_kb_articles_created_at');
            });
        }

        if (!Schema::hasTable('kb_chunks')) {
            Schema::create('kb_chunks', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('article_id');
                $table->integer('chunk_index')->default(0);
                $table->text('content');
                $table->integer('token_count')->default(0);
                $table->json('metadata')->nullable();
                $table->timestamps();

                $table->foreign('article_id')->references('id')->on('kb_articles')->cascadeOnDelete();
                $table->index('article_id', 'idx_kb_chunks_article_id');
            });
        }

        if (!Schema::hasTable('kb_embeddings')) {
            Schema::create('kb_embeddings', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('chunk_id');
                $table->unsignedBigInteger('article_id');
                $table->longText('embedding'); // JSON float array representation
                $table->integer('dimensions')->default(768);
                $table->boolean('is_active')->default(true);
                $table->timestamps();

                $table->foreign('chunk_id')->references('id')->on('kb_chunks')->cascadeOnDelete();
                $table->foreign('article_id')->references('id')->on('kb_articles')->cascadeOnDelete();
                $table->index(['article_id', 'is_active'], 'idx_kb_embeddings_art_active');
                $table->index('chunk_id', 'idx_kb_embeddings_chunk_id');
                $table->index('is_active', 'idx_kb_embeddings_is_active');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('kb_embeddings');
        Schema::dropIfExists('kb_chunks');
        Schema::dropIfExists('kb_articles');
    }
};
