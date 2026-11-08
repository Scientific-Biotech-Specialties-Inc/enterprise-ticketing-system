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
        if (!Schema::hasTable('system_security_alerts')) {
            Schema::create('system_security_alerts', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->string('incident_id', 64)->unique();
                $table->string('category', 64)->index();
                $table->string('severity', 32)->default('medium')->index();
                $table->string('service', 64)->index();
                $table->string('title');
                $table->text('message');
                $table->longText('context_data')->nullable();
                $table->unsignedInteger('burst_count')->default(1);
                $table->string('ip_address', 45)->nullable();
                $table->text('user_agent')->nullable();
                $table->timestamp('first_seen_at')->useCurrent();
                $table->timestamp('last_seen_at')->useCurrent();
                $table->timestamp('resolved_at')->nullable();
                $table->unsignedBigInteger('resolved_by')->nullable();
                $table->timestamps();

                $table->index(['created_at', 'severity']);
                $table->index(['category', 'created_at']);
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('system_security_alerts');
    }
};

