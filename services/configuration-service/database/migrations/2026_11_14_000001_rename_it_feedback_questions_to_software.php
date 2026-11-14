<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Spec 0043 (AC-13): feedback question sets follow the live problem category names.
 * The old `IT` set becomes `Software`. Submitted feedback keeps its frozen question snapshot,
 * so only the editable question rows and the per category toggle move.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->rename('IT', 'Software');
    }

    public function down(): void
    {
        $this->rename('Software', 'IT');
    }

    private function rename(string $from, string $to): void
    {
        DB::table('feedback_questions')->where('category', $from)->update(['category' => $to, 'updated_at' => now()]);

        $fromKey = "feedback_category:{$from}";
        $toKey = "feedback_category:{$to}";
        if (DB::getSchemaBuilder()->hasTable('feedback_form_settings')
            && !DB::table('feedback_form_settings')->where('key', $toKey)->exists()) {
            DB::table('feedback_form_settings')->where('key', $fromKey)->update(['key' => $toKey, 'updated_at' => now()]);
        }
    }
};
