<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tickets', function (Blueprint $table) {
            $table->index(
                ['created_by', 'is_internal', 'ticket_status_ID', 'closed_at', 'resolved_at'],
                'idx_tickets_customer_open_limit'
            );
            $table->index(
                ['requested_by', 'is_internal', 'ticket_status_ID', 'closed_at', 'resolved_at'],
                'idx_tickets_requester_open_limit'
            );
        });
    }

    public function down(): void
    {
        Schema::table('tickets', function (Blueprint $table) {
            $table->dropIndex('idx_tickets_customer_open_limit');
            $table->dropIndex('idx_tickets_requester_open_limit');
        });
    }
};
