<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 1. Delete any orphaned audit logs where ticket_ID no longer exists in tickets table
        if (Schema::hasTable('ticket_audit_logs') && Schema::hasTable('tickets')) {
            DB::statement('
                DELETE FROM ticket_audit_logs
                WHERE ticket_ID IS NOT NULL
                AND ticket_ID NOT IN (SELECT ticket_ID FROM tickets)
            ');

            // Add foreign key with cascade on delete if it does not already exist
            Schema::table('ticket_audit_logs', function (Blueprint $table) {
                if (DB::getDriverName() !== 'sqlite') {
                    $table->foreign('ticket_ID', 'ticket_audit_logs_ticket_id_foreign')
                        ->references('ticket_ID')
                        ->on('tickets')
                        ->cascadeOnDelete();
                }
            });
        }

        // 2. Ensure work_logs table foreign key cascades on ticket deletion
        if (Schema::hasTable('work_logs') && Schema::hasTable('tickets')) {
            // Clean up any orphan work logs
            DB::statement('
                DELETE FROM work_logs
                WHERE ticket_id IS NOT NULL
                AND ticket_id NOT IN (SELECT ticket_ID FROM tickets)
            ');

            Schema::table('work_logs', function (Blueprint $table) {
                if (DB::getDriverName() !== 'sqlite') {
                    try {
                        $table->dropForeign('work_logs_ticket_id_foreign');
                    } catch (\Throwable $e) {
                        // ignore if didn't exist
                    }

                    $table->foreign('ticket_id', 'work_logs_ticket_id_foreign')
                        ->references('ticket_ID')
                        ->on('tickets')
                        ->cascadeOnDelete();
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('ticket_audit_logs')) {
            Schema::table('ticket_audit_logs', function (Blueprint $table) {
                if (DB::getDriverName() !== 'sqlite') {
                    try {
                        $table->dropForeign('ticket_audit_logs_ticket_id_foreign');
                    } catch (\Throwable $e) {}
                }
            });
        }

        if (Schema::hasTable('work_logs')) {
            Schema::table('work_logs', function (Blueprint $table) {
                if (DB::getDriverName() !== 'sqlite') {
                    try {
                        $table->dropForeign('work_logs_ticket_id_foreign');
                    } catch (\Throwable $e) {}

                    $table->foreign('ticket_id', 'work_logs_ticket_id_foreign')
                        ->references('ticket_ID')
                        ->on('tickets')
                        ->nullOnDelete();
                }
            });
        }
    }
};
