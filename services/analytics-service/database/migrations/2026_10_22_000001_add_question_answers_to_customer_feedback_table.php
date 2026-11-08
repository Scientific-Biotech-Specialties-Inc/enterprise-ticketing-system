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
        Schema::table('customer_feedback', function (Blueprint $table) {
            if (!Schema::hasColumn('customer_feedback', 'question_answers')) {
                $table->json('question_answers')->nullable()->after('employee_ratings');
            }
            if (!Schema::hasColumn('customer_feedback', 'category_questions_snapshot')) {
                $table->json('category_questions_snapshot')->nullable()->after('question_answers');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('customer_feedback', function (Blueprint $table) {
            if (Schema::hasColumn('customer_feedback', 'category_questions_snapshot')) {
                $table->dropColumn('category_questions_snapshot');
            }
            if (Schema::hasColumn('customer_feedback', 'question_answers')) {
                $table->dropColumn('question_answers');
            }
        });
    }
};
