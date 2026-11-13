<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0039: one row per stretch of time one employee held one ticket.
 * Append only history; employee performance metrics are computed from it.
 * ticket_assignments is left untouched.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('ticket_assignment_periods')) {
            return;
        }

        Schema::create('ticket_assignment_periods', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ticket_ID')->constrained('tickets', 'ticket_ID')->cascadeOnDelete();
            // Matches ticket_assignments: removing an employee record removes their history with it.
            $table->foreignId('employee_ID')->constrained('employees', 'emp_id')->cascadeOnDelete();
            $table->foreignId('assigned_by')->nullable()->constrained('employees', 'emp_id')->nullOnDelete();
            $table->timestamp('assigned_at');
            $table->timestamp('ack_due_at')->nullable();
            $table->timestamp('accepted_at')->nullable();
            $table->timestamp('paused_at')->nullable();
            $table->unsignedInteger('paused_seconds')->default(0);
            $table->unsignedInteger('ack_paused_seconds')->default(0);
            $table->timestamp('released_at')->nullable();
            $table->string('release_reason', 20)->nullable();
            $table->timestamps();

            $table->index(['employee_ID', 'assigned_at'], 'tap_employee_assigned_idx');
            $table->index(['ticket_ID', 'released_at'], 'tap_ticket_released_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ticket_assignment_periods');
    }
};
