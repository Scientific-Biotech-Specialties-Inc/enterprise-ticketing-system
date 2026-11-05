<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (\Illuminate\Support\Facades\DB::getDriverName() !== 'sqlite') {
            Schema::table('ticket_audit_logs', function (Blueprint $table) {
                $table->dropForeign('ticket_audit_logs_ticket_id_foreign');
            });
        }
    }

    public function down(): void
    {
        if (\Illuminate\Support\Facades\DB::getDriverName() !== 'sqlite') {
            Schema::table('ticket_audit_logs', function (Blueprint $table) {
                $table->foreign('ticket_ID')->references('ticket_ID')->on('tickets')->cascadeOnDelete();
            });
        }
    }
};
