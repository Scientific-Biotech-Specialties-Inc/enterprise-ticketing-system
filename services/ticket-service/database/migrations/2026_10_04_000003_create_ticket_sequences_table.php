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
        if (!Schema::hasTable('ticket_sequences')) {
            Schema::create('ticket_sequences', function (Blueprint $table) {
                $table->id();
                $table->string('scope', 64)->unique();
                $table->unsignedBigInteger('current_value')->default(0);
                $table->timestamps();
            });

            // Initialize global sequence from highest existing ticket_ID to prevent collision
            $maxId = 0;
            if (Schema::hasTable('tickets')) {
                $maxId = (int) (DB::table('tickets')->max('ticket_ID') ?? 0);
            }

            DB::table('ticket_sequences')->insert([
                'scope' => 'global',
                'current_value' => $maxId,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('ticket_sequences');
    }
};
