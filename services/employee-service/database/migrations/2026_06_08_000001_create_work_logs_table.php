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
        if (!Schema::hasTable('work_logs')) {
            Schema::create('work_logs', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('employee_id')->index();
                $table->unsignedBigInteger('ticket_id')->nullable()->index();
                $table->text('task_description');
                $table->decimal('hours_spent', 8, 2);
                $table->date('log_date')->index();
                $table->string('status')->default('pending')->index();
                $table->timestamps();
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('work_logs');
    }
};

