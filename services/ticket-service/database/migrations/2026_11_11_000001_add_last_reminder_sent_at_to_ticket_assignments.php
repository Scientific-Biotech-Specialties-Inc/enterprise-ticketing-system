<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0038 AC-8: per assignee reminder cooldown.
 *
 * Each active assignment row tracks its own last reminder time, so reminding one
 * assignee never blocks reminding another. tickets.last_reminder_sent_at keeps being
 * written with the latest reminder as a summary for existing readers.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('ticket_assignments', 'last_reminder_sent_at')) {
            Schema::table('ticket_assignments', function (Blueprint $table) {
                $table->dateTime('last_reminder_sent_at')->nullable()->after('completed_at');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('ticket_assignments', 'last_reminder_sent_at')) {
            Schema::table('ticket_assignments', function (Blueprint $table) {
                $table->dropColumn('last_reminder_sent_at');
            });
        }
    }
};
