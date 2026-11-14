<?php

use App\Services\DepartmentCodeGenerator;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0043 (AC-11): each department gets its own unique code, used as the ticket number's
 * department segment. Safe sequence: add nullable, backfill, then NOT NULL plus a unique index.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('departments', 'code')) {
            Schema::table('departments', function (Blueprint $table) {
                $table->string('code', 16)->nullable()->after('name');
            });
        }

        $generator = new DepartmentCodeGenerator();
        $fixed = ['it' => 'IT', 'service' => 'SVC'];

        $departments = DB::table('departments')->orderBy('id')->get(['id', 'name', 'code']);
        $taken = $departments->pluck('code')->filter()->map(fn ($c) => strtoupper((string) $c))->values()->all();

        // Fixed codes first so a generated code never takes IT or SVC.
        foreach ($departments as $dept) {
            $key = strtolower(trim((string) $dept->name));
            if (empty($dept->code) && isset($fixed[$key]) && !in_array($fixed[$key], $taken, true)) {
                DB::table('departments')->where('id', $dept->id)->update(['code' => $fixed[$key]]);
                $taken[] = $fixed[$key];
                $dept->code = $fixed[$key];
            }
        }

        foreach ($departments as $dept) {
            if (empty($dept->code)) {
                $code = $generator->suggest((string) $dept->name, null, $taken);
                DB::table('departments')->where('id', $dept->id)->update(['code' => $code]);
                $taken[] = $code;
            }
        }

        DB::statement('UPDATE departments SET code = UPPER(code)');
        DB::statement('ALTER TABLE departments MODIFY code VARCHAR(16) NOT NULL');

        Schema::table('departments', function (Blueprint $table) {
            $table->unique('code', 'departments_code_unique');
        });
    }

    public function down(): void
    {
        if (Schema::hasColumn('departments', 'code')) {
            Schema::table('departments', function (Blueprint $table) {
                $table->dropUnique('departments_code_unique');
                $table->dropColumn('code');
            });
        }
    }
};
