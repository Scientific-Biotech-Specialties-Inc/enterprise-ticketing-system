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
        if (!Schema::hasTable('analytics_sla_metrics')) {
            Schema::create('analytics_sla_metrics', function (Blueprint $table) {
                $table->id();
                $table->string('department_name');
                $table->integer('total_tickets')->default(0);
                $table->integer('total_resolved')->default(0);
                $table->integer('sla_met_count')->default(0);
                $table->integer('sla_breached_count')->default(0);
                $table->decimal('compliance_percentage', 5, 2)->default(0.00);
                $table->date('metric_date');
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('analytics_employee_performances')) {
            Schema::create('analytics_employee_performances', function (Blueprint $table) {
                $table->id();
                $table->integer('emp_id');
                $table->string('employee_name');
                $table->string('department');
                $table->string('role');
                $table->integer('active_tickets_count')->default(0);
                $table->integer('resolved_tickets_count')->default(0);
                $table->decimal('avg_response_time_minutes', 8, 2)->default(0.00);
                $table->decimal('avg_resolution_time_minutes', 8, 2)->default(0.00);
                $table->date('snapshot_date');
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('analytics_equipment_reports')) {
            Schema::create('analytics_equipment_reports', function (Blueprint $table) {
                $table->id();
                $table->string('category_name');
                $table->integer('machine_id')->default(1);
                $table->integer('total_machines')->default(0);
                $table->integer('total_tickets_count')->default(0);
                $table->integer('active_tickets_count')->default(0);
                $table->decimal('active_ticket_percentage', 5, 2)->default(0.00);
                $table->date('snapshot_date');
                $table->timestamps();
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('analytics_equipment_reports');
        Schema::dropIfExists('analytics_employee_performances');
        Schema::dropIfExists('analytics_sla_metrics');
    }
};

