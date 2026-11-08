<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (!Schema::hasTable('audit_retention_settings')) {
            Schema::create('audit_retention_settings', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('retention_days')->default(365);
                $table->boolean('is_auto_purge_enabled')->default(true);
                $table->string('purge_schedule', 64)->default('0 2 * * *');
                $table->unsignedInteger('chunk_size')->default(1000);
                $table->unsignedInteger('updated_by_id')->nullable()->index();
                $table->timestamps();
            });
        }

        if (DB::table('audit_retention_settings')->count() === 0) {
            $defaultDays = max(30, (int) config('audit.purge_default_days', 365));
            $defaultChunkSize = max(1, (int) config('audit.purge_chunk_size', 1000));

            DB::table('audit_retention_settings')->insert([
                'retention_days' => $defaultDays,
                'is_auto_purge_enabled' => true,
                'purge_schedule' => '0 2 * * *',
                'chunk_size' => $defaultChunkSize,
                'updated_by_id' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        if (!Schema::hasTable('audit_purge_runs')) {
            Schema::create('audit_purge_runs', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->enum('trigger_source', ['scheduled', 'manual']);
                $table->unsignedInteger('retention_days');
                $table->dateTime('cutoff_timestamp');
                $table->unsignedInteger('records_identified')->default(0);
                $table->unsignedInteger('records_deleted')->default(0);
                $table->unsignedInteger('duration_ms')->default(0);
                $table->enum('status', ['success', 'failed', 'partial']);
                $table->text('error_message')->nullable();
                $table->unsignedInteger('executed_by_id')->nullable()->index();
                $table->timestamp('created_at')->nullable()->index();

                $table->index(['status', 'created_at']);
                $table->index('trigger_source');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('audit_purge_runs');
        Schema::dropIfExists('audit_retention_settings');
    }
};

