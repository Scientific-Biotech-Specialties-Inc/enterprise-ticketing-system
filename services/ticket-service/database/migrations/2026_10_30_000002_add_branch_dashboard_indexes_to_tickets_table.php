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
            // Composite indexes for branch scoped dashboard and reporting aggregations
            if (Schema::hasColumn('tickets', 'branch_id') && Schema::hasColumn('tickets', 'created_at')) {
                $table->index(['branch_id', 'created_at'], 'idx_tickets_branch_created_at');
            }
            if (Schema::hasColumn('tickets', 'branch_id') && Schema::hasColumn('tickets', 'ticket_status_ID')) {
                $table->index(['branch_id', 'ticket_status_ID'], 'idx_tickets_branch_status');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('tickets', function (Blueprint $table) {
            $table->dropIndex('idx_tickets_branch_created_at');
            $table->dropIndex('idx_tickets_branch_status');
        });
    }
};

