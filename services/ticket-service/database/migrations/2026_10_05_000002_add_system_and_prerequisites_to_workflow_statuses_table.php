<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('workflow_statuses')) {
            Schema::table('workflow_statuses', function (Blueprint $table) {
                if (!Schema::hasColumn('workflow_statuses', 'is_system')) {
                    $table->boolean('is_system')->default(false)->after('order_position');
                }
                if (!Schema::hasColumn('workflow_statuses', 'requires_previous_fulfilled')) {
                    $table->boolean('requires_previous_fulfilled')->default(false)->after('is_system');
                }
                if (!Schema::hasColumn('workflow_statuses', 'prerequisite_status_id')) {
                    $table->unsignedBigInteger('prerequisite_status_id')->nullable()->after('requires_previous_fulfilled');
                    $table->foreign('prerequisite_status_id')->references('id')->on('workflow_statuses')->nullOnDelete();
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('workflow_statuses')) {
            Schema::table('workflow_statuses', function (Blueprint $table) {
                if (Schema::hasColumn('workflow_statuses', 'prerequisite_status_id')) {
                    $table->dropForeign(['prerequisite_status_id']);
                    $table->dropColumn('prerequisite_status_id');
                }
                if (Schema::hasColumn('workflow_statuses', 'requires_previous_fulfilled')) {
                    $table->dropColumn('requires_previous_fulfilled');
                }
                if (Schema::hasColumn('workflow_statuses', 'is_system')) {
                    $table->dropColumn('is_system');
                }
            });
        }
    }
};
