<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The seeded problem categories become Software (id 1) and Service (id 2).
 *
 * Older seeds named them "Machine Failure" and "Calibration Required", and 2026_10_05 added demo Luzon
 * categories. Rows that refer to a category by name (feedback questions, branch SLA overrides) are renamed
 * too, so they keep pointing at the right category. Categories an admin created are left alone.
 */
return new class extends Migration
{
    private const OLD_TO_NEW = [
        'Machine Failure' => 'Software',
        'IT' => 'Software',
        'Calibration Required' => 'Service',
    ];

    private const DEMO_CATEGORIES = ['Biomedical Facility Maintenance', 'Radiology Support'];

    public function up(): void
    {
        if (!Schema::hasTable('problem_categories')) {
            return;
        }

        $now = now();
        $categories = [
            1 => ['Software', 'Software, application, login, or system access issues.'],
            2 => ['Service', 'Equipment service, repair, calibration, or maintenance requests.'],
        ];

        foreach ($categories as $id => [$name, $description]) {
            // Free the name first if some other row already uses it, so the rename cannot collide.
            DB::table('problem_categories')
                ->where('category_name', $name)
                ->where('problem_category_ID', '!=', $id)
                ->update(['category_name' => $name . ' (old ' . $now->format('YmdHis') . ')', 'is_active' => false, 'updated_at' => $now]);

            DB::table('problem_categories')->updateOrInsert(
                ['problem_category_ID' => $id],
                ['category_name' => $name, 'description' => $description, 'is_active' => true, 'updated_at' => $now]
                    + (DB::table('problem_categories')->where('problem_category_ID', $id)->exists() ? [] : ['created_at' => $now])
            );
        }

        foreach (self::DEMO_CATEGORIES as $demoName) {
            $ids = DB::table('problem_categories')->where('category_name', $demoName)->pluck('problem_category_ID');
            foreach ($ids as $demoId) {
                $inUse = Schema::hasTable('tickets') && DB::table('tickets')->where('problem_category_ID', $demoId)->exists();
                if ($inUse) {
                    // Existing tickets keep their category, but new tickets can no longer pick it.
                    DB::table('problem_categories')->where('problem_category_ID', $demoId)->update(['is_active' => false, 'updated_at' => $now]);
                } else {
                    DB::table('problem_categories')->where('problem_category_ID', $demoId)->delete();
                }
            }
        }

        if (Schema::hasTable('branch_sla_policies')) {
            DB::table('branch_sla_policies')->whereIn('category_name', self::DEMO_CATEGORIES)->delete();
            foreach ($categories as $id => [$name]) {
                DB::table('branch_sla_policies')->where('category_id', $id)->update(['category_name' => $name, 'updated_at' => $now]);
            }
        }

        if (Schema::hasTable('feedback_questions')) {
            foreach (self::OLD_TO_NEW as $old => $new) {
                DB::table('feedback_questions')->where('category', $old)->update(['category' => $new, 'updated_at' => $now]);
            }
        }
    }

    public function down(): void
    {
        // Renamed and removed demo rows cannot be restored reliably, so this is left as is.
    }
};
