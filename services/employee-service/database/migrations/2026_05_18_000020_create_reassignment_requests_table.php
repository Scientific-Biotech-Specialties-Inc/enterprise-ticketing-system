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
        if (!Schema::hasTable('reassignment_requests')) {
            Schema::create('reassignment_requests', function (Blueprint $table) {
                $table->bigIncrements('request_id');
                $table->unsignedBigInteger('ticket_id')->index();
                $table->unsignedBigInteger('employee_id')->index();
                $table->text('reason');
                $table->text('deny_reason')->nullable();
                $table->string('status')->default('pending')->index(); // pending, approved, denied
                $table->timestamp('requested_at')->nullable();
                $table->timestamp('reviewed_at')->nullable();
                $table->timestamps();
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('reassignment_requests');
    }
};

