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
        if (!Schema::hasTable('customer_feedback')) {
            Schema::create('customer_feedback', function (Blueprint $table) {
                $table->id();
                $table->string('ticket_id')->index();
                $table->string('customer_id')->nullable()->index();
                $table->decimal('overall_rating', 3, 2)->default(0.00);
                $table->text('overall_comment')->nullable();
                $table->json('employee_ratings')->nullable();
                $table->timestamps();
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('customer_feedback');
    }
};
