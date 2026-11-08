<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('feedback_questions', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('category')->index(); // 'IT', 'Service', 'Others'
            $table->text('text');
            $table->string('response_type')->default('Star Rating'); // 'Star Rating', 'Multiple Choice', 'Free Text'
            $table->json('options')->nullable();
            $table->boolean('is_enabled')->default(true);
            $table->integer('order_position')->default(0);
            $table->boolean('is_default')->default(false);
            $table->timestamps();
            $table->softDeletes();
        });

        // Seed default questions matching TS104 specs
        $defaults = [
            'IT' => [
                [
                    'text' => "How would you rate the technician's technical knowledge?",
                    'response_type' => 'Star Rating',
                    'options' => null,
                    'is_enabled' => true,
                    'order_position' => 1,
                    'is_default' => true,
                ],
                [
                    'text' => 'Was your issue resolved on the first visit?',
                    'response_type' => 'Multiple Choice',
                    'options' => json_encode(['Yes', 'No']),
                    'is_enabled' => true,
                    'order_position' => 2,
                    'is_default' => true,
                ],
                [
                    'text' => 'Do you have any additional feedback about the IT support provided?',
                    'response_type' => 'Free Text',
                    'options' => null,
                    'is_enabled' => false,
                    'order_position' => 3,
                    'is_default' => true,
                ],
            ],
            'Service' => [
                [
                    'text' => 'How satisfied are you with the timeliness and professionalism of the service engineer?',
                    'response_type' => 'Star Rating',
                    'options' => null,
                    'is_enabled' => true,
                    'order_position' => 1,
                    'is_default' => true,
                ],
                [
                    'text' => 'Did the technician explain the issue and repair clearly?',
                    'response_type' => 'Multiple Choice',
                    'options' => json_encode(['Yes', 'No']),
                    'is_enabled' => true,
                    'order_position' => 2,
                    'is_default' => true,
                ],
                [
                    'text' => 'Any suggestions for improving our on-site service experience?',
                    'response_type' => 'Free Text',
                    'options' => null,
                    'is_enabled' => true,
                    'order_position' => 3,
                    'is_default' => true,
                ],
            ],
            'Others' => [
                [
                    'text' => 'How would you rate your overall support experience?',
                    'response_type' => 'Star Rating',
                    'options' => null,
                    'is_enabled' => true,
                    'order_position' => 1,
                    'is_default' => true,
                ],
                [
                    'text' => 'Would you recommend our support team to others?',
                    'response_type' => 'Multiple Choice',
                    'options' => json_encode(['Yes', 'No']),
                    'is_enabled' => true,
                    'order_position' => 2,
                    'is_default' => true,
                ],
                [
                    'text' => 'Please share any additional comments or suggestions for our team.',
                    'response_type' => 'Free Text',
                    'options' => null,
                    'is_enabled' => false,
                    'order_position' => 3,
                    'is_default' => true,
                ],
            ],
        ];

        foreach ($defaults as $category => $questions) {
            foreach ($questions as $q) {
                DB::table('feedback_questions')->insert([
                    'category' => $category,
                    'text' => $q['text'],
                    'response_type' => $q['response_type'],
                    'options' => $q['options'],
                    'is_enabled' => $q['is_enabled'],
                    'order_position' => $q['order_position'],
                    'is_default' => $q['is_default'],
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('feedback_questions');
    }
};
