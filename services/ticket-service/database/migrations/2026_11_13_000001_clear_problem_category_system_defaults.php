<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ticket categories are no longer protected as core defaults. Any category can be edited or deleted,
 * and the controller instead keeps at least one active category. The column stays so older code keeps working.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('problem_categories') && Schema::hasColumn('problem_categories', 'is_system_default')) {
            DB::table('problem_categories')->update(['is_system_default' => false]);
        }
    }

    public function down(): void
    {
        // The previous flags cannot be restored reliably, so this is left as is.
    }
};
