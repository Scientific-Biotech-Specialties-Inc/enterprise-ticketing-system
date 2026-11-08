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
        if (!Schema::hasTable('employees')) {
            Schema::create('employees', function (Blueprint $table) {
                $table->bigIncrements('emp_id');
                $table->string('email')->unique();
                $table->string('password_hash')->default('');
                $table->string('first_name')->default('');
                $table->string('last_name')->default('');
                $table->string('role')->default('service');
                $table->string('department')->nullable();
                $table->string('branch')->nullable()->index();
                $table->unsignedBigInteger('branch_id')->nullable()->index();
                $table->string('phone_number')->nullable();
                $table->string('position_level')->nullable()->index();
                $table->string('technical_role')->nullable()->index();
                $table->boolean('is_active')->default(true)->index();
                $table->unsignedInteger('failed_login_count')->default(0);
                $table->timestamp('locked_until')->nullable();
                $table->timestamp('last_login_at')->nullable();
                $table->timestamp('last_seen_at')->nullable();
                $table->timestamp('password_change_at')->nullable();
                $table->timestamp('last_synced_at')->nullable();
                $table->timestamps();
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('employees');
    }
};

