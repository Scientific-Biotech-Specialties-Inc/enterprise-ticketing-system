<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tickets', function (Blueprint $table) {
            if (!Schema::hasColumn('tickets', 'in_progress_owner')) {
                $table->string('in_progress_owner', 32)->nullable()->default(null)->after('ticket_status_ID');
                $table->index('in_progress_owner');
            }
            if (!Schema::hasColumn('tickets', 'previous_in_progress_owner')) {
                $table->string('previous_in_progress_owner', 32)->nullable()->default(null)->after('in_progress_owner');
            }
        });
    }

    public function down(): void
    {
        Schema::table('tickets', function (Blueprint $table) {
            if (Schema::hasColumn('tickets', 'in_progress_owner')) {
                $table->dropIndex(['in_progress_owner']);
                $table->dropColumn('in_progress_owner');
            }
            if (Schema::hasColumn('tickets', 'previous_in_progress_owner')) {
                $table->dropColumn('previous_in_progress_owner');
            }
        });
    }
};
