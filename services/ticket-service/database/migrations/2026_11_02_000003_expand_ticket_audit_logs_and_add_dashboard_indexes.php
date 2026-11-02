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
        // 1. Expand ticket_audit_logs with state capture, role context, and privacy flags
        if (Schema::hasTable('ticket_audit_logs')) {
            Schema::table('ticket_audit_logs', function (Blueprint $table) {
                if (!Schema::hasColumn('ticket_audit_logs', 'event_type')) {
                    $table->string('event_type', 64)->nullable()->after('action_type');
                }
                if (!Schema::hasColumn('ticket_audit_logs', 'actor_role')) {
                    $table->string('actor_role', 64)->nullable()->after('actor_type');
                }
                if (!Schema::hasColumn('ticket_audit_logs', 'before_state')) {
                    $table->json('before_state')->nullable()->after('actor_role');
                }
                if (!Schema::hasColumn('ticket_audit_logs', 'after_state')) {
                    $table->json('after_state')->nullable()->after('before_state');
                }
                if (!Schema::hasColumn('ticket_audit_logs', 'is_system')) {
                    $table->boolean('is_system')->default(false)->after('details');
                }
                if (!Schema::hasColumn('ticket_audit_logs', 'is_internal')) {
                    $table->boolean('is_internal')->default(false)->after('is_system');
                }
            });

            // Add composite indexes to ticket_audit_logs safely
            Schema::table('ticket_audit_logs', function (Blueprint $table) {
                $driver = Schema::getConnection()->getDriverName();
                if ($driver !== 'sqlite') {
                    $existingTalIndexes = collect(Schema::getConnection()->select("SHOW INDEX FROM ticket_audit_logs"))->pluck('Key_name')->unique()->toArray();
                } else {
                    $existingTalIndexes = [];
                }

                if (!in_array('idx_tal_ticket_timeline', $existingTalIndexes, true)) {
                    $table->index(['ticket_ID', 'is_internal', 'created_at'], 'idx_tal_ticket_timeline');
                }
                if (!in_array('idx_tal_ticket_event', $existingTalIndexes, true)) {
                    $table->index(['ticket_ID', 'action_type', 'created_at'], 'idx_tal_ticket_event');
                }
            });
        }

        // 2. Add workload performance composite indexes on tickets table
        if (Schema::hasTable('tickets')) {
            Schema::table('tickets', function (Blueprint $table) {
                $driver = Schema::getConnection()->getDriverName();
                if ($driver !== 'sqlite') {
                    $existingTicketIndexes = collect(Schema::getConnection()->select("SHOW INDEX FROM tickets"))->pluck('Key_name')->unique()->toArray();
                } else {
                    $existingTicketIndexes = [];
                }

                if (!in_array('idx_tickets_assigned_status', $existingTicketIndexes, true)) {
                    $table->index(['assigned_to', 'ticket_status_ID'], 'idx_tickets_assigned_status');
                }
                if (!in_array('idx_tickets_created_by_status', $existingTicketIndexes, true)) {
                    $table->index(['created_by', 'ticket_status_ID'], 'idx_tickets_created_by_status');
                }
                if (Schema::hasColumn('tickets', 'requested_by') && !in_array('idx_tickets_requested_by_status', $existingTicketIndexes, true)) {
                    $table->index(['requested_by', 'ticket_status_ID'], 'idx_tickets_requested_by_status');
                }
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('ticket_audit_logs')) {
            Schema::table('ticket_audit_logs', function (Blueprint $table) {
                $driver = Schema::getConnection()->getDriverName();
                if ($driver !== 'sqlite') {
                    $existingTalIndexes = collect(Schema::getConnection()->select("SHOW INDEX FROM ticket_audit_logs"))->pluck('Key_name')->unique()->toArray();
                    if (in_array('idx_tal_ticket_timeline', $existingTalIndexes, true)) {
                        $table->dropIndex('idx_tal_ticket_timeline');
                    }
                    if (in_array('idx_tal_ticket_event', $existingTalIndexes, true)) {
                        $table->dropIndex('idx_tal_ticket_event');
                    }
                }

                $columnsToDrop = array_filter([
                    'event_type',
                    'actor_role',
                    'before_state',
                    'after_state',
                    'is_system',
                    'is_internal',
                ], fn ($col) => Schema::hasColumn('ticket_audit_logs', $col));

                if (!empty($columnsToDrop)) {
                    $table->dropColumn($columnsToDrop);
                }
            });
        }

        if (Schema::hasTable('tickets')) {
            Schema::table('tickets', function (Blueprint $table) {
                $driver = Schema::getConnection()->getDriverName();
                if ($driver !== 'sqlite') {
                    $existingTicketIndexes = collect(Schema::getConnection()->select("SHOW INDEX FROM tickets"))->pluck('Key_name')->unique()->toArray();
                    if (in_array('idx_tickets_assigned_status', $existingTicketIndexes, true)) {
                        $table->dropIndex('idx_tickets_assigned_status');
                    }
                    if (in_array('idx_tickets_created_by_status', $existingTicketIndexes, true)) {
                        $table->dropIndex('idx_tickets_created_by_status');
                    }
                    if (in_array('idx_tickets_requested_by_status', $existingTicketIndexes, true)) {
                        $table->dropIndex('idx_tickets_requested_by_status');
                    }
                }
            });
        }
    }
};

