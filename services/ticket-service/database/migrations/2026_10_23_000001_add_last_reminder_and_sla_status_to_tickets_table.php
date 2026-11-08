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
        Schema::table('tickets', function (Blueprint $table) {
            if (!Schema::hasColumn('tickets', 'last_reminder_sent_at')) {
                $table->dateTime('last_reminder_sent_at')->nullable()->after('resolution_due_at')->index();
            }
            if (!Schema::hasColumn('tickets', 'sla_status')) {
                $table->string('sla_status', 32)->nullable()->default('On Track')->after('last_reminder_sent_at')->index();
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('tickets', function (Blueprint $table) {
            if (Schema::hasColumn('tickets', 'sla_status')) {
                $table->dropColumn('sla_status');
            }
            if (Schema::hasColumn('tickets', 'last_reminder_sent_at')) {
                $table->dropColumn('last_reminder_sent_at');
            }
        });
    }
};
