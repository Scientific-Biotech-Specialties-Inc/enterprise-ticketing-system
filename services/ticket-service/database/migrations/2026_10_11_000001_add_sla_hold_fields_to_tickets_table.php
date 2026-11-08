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
            $table->dateTime('sla_started_at')->nullable()->after('resolution_due_at');
            $table->dateTime('sla_paused_at')->nullable()->after('sla_started_at');
            $table->unsignedInteger('sla_paused_total_seconds')->default(0)->after('sla_paused_at');
            $table->unsignedBigInteger('held_from_status_ID')->nullable()->after('ticket_status_ID');
            $table->text('hold_reason')->nullable()->after('held_from_status_ID');

            $table->index('resolution_due_at', 'idx_tickets_resolution_due_at');
        });

        // Drop action_by_ID foreign key so system events (action_by_ID = 0)
        // and customer actions (client IDs) can be recorded in ticket_audit_logs.
        Schema::table('ticket_audit_logs', function (Blueprint $table) {
            $table->dropForeign('ticket_audit_logs_action_by_id_foreign');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('tickets', function (Blueprint $table) {
            $table->dropIndex('idx_tickets_resolution_due_at');
            $table->dropColumn([
                'sla_started_at',
                'sla_paused_at',
                'sla_paused_total_seconds',
                'held_from_status_ID',
                'hold_reason',
            ]);
        });

        // NOTE: We deliberately do NOT re-add `ticket_audit_logs_action_by_id_foreign`
        // in down() because existing rows created during operation may contain 0 (system actor)
        // or client IDs that do not exist in the employees table. Re-adding the constraint
        // would fail on existing data.
    }
};
