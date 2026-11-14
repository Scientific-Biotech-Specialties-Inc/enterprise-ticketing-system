<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Spec 0043: a customer ticket the AI could not classify is stored with a NULL category
 * ("Needs Classification") until CS reclassifies it. The foreign key stays (restrict on delete).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE tickets MODIFY problem_category_ID BIGINT UNSIGNED NULL');
    }

    /**
     * Only safe once no NULL rows remain, so NULLs are moved to the Service category first.
     */
    public function down(): void
    {
        $nullCount = DB::table('tickets')->whereNull('problem_category_ID')->count();
        if ($nullCount > 0) {
            $serviceId = DB::table('problem_categories')
                ->whereRaw('LOWER(category_name) = ?', ['service'])
                ->value('problem_category_ID')
                ?? DB::table('problem_categories')->min('problem_category_ID');

            DB::table('tickets')->whereNull('problem_category_ID')->update(['problem_category_ID' => $serviceId]);
            Log::warning("Rollback of spec 0043: moved {$nullCount} unclassified tickets to category {$serviceId}.");
        }

        DB::statement('ALTER TABLE tickets MODIFY problem_category_ID BIGINT UNSIGNED NOT NULL');
    }
};
