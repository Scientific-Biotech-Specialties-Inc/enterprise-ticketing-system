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
            if (!Schema::hasColumn('tickets', 'sla_risk_notified_at')) {
                $table->dateTime('sla_risk_notified_at')->nullable()->after('sla_status')->index();
            }
            if (!Schema::hasColumn('tickets', 'sla_breach_notified_at')) {
                $table->dateTime('sla_breach_notified_at')->nullable()->after('sla_risk_notified_at')->index();
            }
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
            if (Schema::hasColumn('tickets', 'sla_breach_notified_at')) {
                $table->dropColumn('sla_breach_notified_at');
            }
            if (Schema::hasColumn('tickets', 'sla_risk_notified_at')) {
                $table->dropColumn('sla_risk_notified_at');
            }
        });
    }
};
