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
        if (Schema::hasTable('kb_articles') && !Schema::hasColumn('kb_articles', 'file_path')) {
            Schema::table('kb_articles', function (Blueprint $table) {
                $table->string('file_path', 500)->nullable()->after('file_type');
            });
        }

        if (!Schema::hasTable('kb_audit_logs')) {
            Schema::create('kb_audit_logs', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('article_id')->nullable();
                $table->string('article_title');
                $table->string('action', 50)->default('Deleted');
                $table->string('actor', 100)->default('Super Admin');
                $table->string('actor_role', 50)->default('Super Admin');
                $table->string('module', 50)->default('Knowledge Base');
                $table->json('details')->nullable();
                $table->string('ip_address', 45)->nullable();
                $table->timestamps();

                $table->index('action', 'idx_kb_audit_logs_action');
                $table->index('created_at', 'idx_kb_audit_logs_created_at');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('kb_audit_logs');
        if (Schema::hasTable('kb_articles') && Schema::hasColumn('kb_articles', 'file_path')) {
            Schema::table('kb_articles', function (Blueprint $table) {
                $table->dropColumn('file_path');
            });
        }
    }
};
