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
        // 1. Branch Ticket Volume Forecasts Table
        if (!Schema::hasTable('branch_ticket_forecasts')) {
            Schema::create('branch_ticket_forecasts', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->foreignId('branch_id')->constrained('branches', 'id')->cascadeOnDelete();
                $table->date('forecast_date');
                $table->unsignedInteger('predicted_volume');
                $table->unsignedInteger('lower_bound');
                $table->unsignedInteger('upper_bound');
                $table->unsignedInteger('historical_days_used')->default(0);
                $table->string('calculation_status')->default('success'); // success, insufficient_data
                $table->timestamp('calculated_at')->useCurrent();
                $table->timestamps();

                $table->unique(['branch_id', 'forecast_date'], 'unique_branch_forecast_date');
                $table->index(['branch_id', 'forecast_date']);
            });
        }

        // 2. Branch Recurring Issue Trends Table
        if (!Schema::hasTable('branch_recurring_issue_trends')) {
            Schema::create('branch_recurring_issue_trends', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->foreignId('branch_id')->constrained('branches', 'id')->cascadeOnDelete();
                $table->string('issue_type'); // 'category', 'machine'
                $table->unsignedBigInteger('item_id');
                $table->string('item_name');
                $table->unsignedInteger('recent_frequency')->default(0);
                $table->decimal('baseline_frequency', 8, 2)->default(0.00);
                $table->decimal('change_percentage', 8, 2)->default(0.00);
                $table->string('trend_signal')->default('stable'); // increasing, stable, decreasing
                $table->timestamp('calculated_at')->useCurrent();
                $table->timestamps();

                $table->index(['branch_id', 'issue_type'], 'idx_branch_issue_trends');
            });
        }

        // 3. Forecast Job Runs (Execution health and failure logging)
        if (!Schema::hasTable('forecast_job_runs')) {
            Schema::create('forecast_job_runs', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->string('job_name');
                $table->unsignedBigInteger('branch_id')->nullable();
                $table->string('status'); // success, failed, insufficient_data
                $table->unsignedInteger('records_processed')->default(0);
                $table->unsignedInteger('duration_ms')->default(0);
                $table->text('error_message')->nullable();
                $table->timestamp('completed_at')->useCurrent();
                $table->timestamps();

                $table->index(['job_name', 'status', 'created_at'], 'idx_job_health_status');
            });
        }

        // 4. Daily Employee Performance Rollups
        if (!Schema::hasTable('daily_employee_performance')) {
            Schema::create('daily_employee_performance', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->foreignId('branch_id')->constrained('branches', 'id')->cascadeOnDelete();
                $table->foreignId('employee_id')->constrained('employees', 'emp_id')->cascadeOnDelete();
                $table->date('date');
                $table->unsignedInteger('tickets_assigned')->default(0);
                $table->unsignedInteger('tickets_resolved')->default(0);
                $table->unsignedBigInteger('total_resolution_seconds')->default(0);
                $table->unsignedInteger('sla_met_count')->default(0);
                $table->unsignedInteger('sla_breached_count')->default(0);
                $table->unsignedInteger('reassignments_approved')->default(0);
                $table->decimal('csat_sum', 8, 2)->default(0.00);
                $table->unsignedInteger('csat_count')->default(0);
                $table->timestamps();

                $table->unique(['employee_id', 'date'], 'unique_emp_daily_date');
                $table->index(['branch_id', 'date']);
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('daily_employee_performance');
        Schema::dropIfExists('forecast_job_runs');
        Schema::dropIfExists('branch_recurring_issue_trends');
        Schema::dropIfExists('branch_ticket_forecasts');
    }
};

