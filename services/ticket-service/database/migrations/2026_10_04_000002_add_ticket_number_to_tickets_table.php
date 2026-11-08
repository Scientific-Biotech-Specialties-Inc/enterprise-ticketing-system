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
        if (Schema::hasTable('tickets') && !Schema::hasColumn('tickets', 'ticket_number')) {
            Schema::table('tickets', function (Blueprint $table) {
                $table->string('ticket_number', 64)->nullable()->unique()->after('ticket_ID');
            });

            // Backfill existing tickets with legacy format to ensure historical tickets remain immutable
            DB::statement("UPDATE tickets SET ticket_number = CONCAT('TKT-', LPAD(ticket_ID, 4, '0')) WHERE ticket_number IS NULL");
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('tickets') && Schema::hasColumn('tickets', 'ticket_number')) {
            Schema::table('tickets', function (Blueprint $table) {
                $table->dropUnique(['ticket_number']);
                $table->dropColumn('ticket_number');
            });
        }
    }
};
