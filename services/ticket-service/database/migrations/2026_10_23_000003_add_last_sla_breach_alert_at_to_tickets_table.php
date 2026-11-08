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
            if (!Schema::hasColumn('tickets', 'last_sla_breach_alert_at')) {
                $table->dateTime('last_sla_breach_alert_at')->nullable()->after('sla_breach_notified_at')->index();
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('tickets', function (Blueprint $table) {
            if (Schema::hasColumn('tickets', 'last_sla_breach_alert_at')) {
                $table->dropColumn('last_sla_breach_alert_at');
            }
        });
    }
};
