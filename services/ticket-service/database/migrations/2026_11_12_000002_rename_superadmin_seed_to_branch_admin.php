<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Mirrors Auth Module migration 2026_11_12_000002_add_branch_admin_role in ticketing's local
 * employees table: the seeded superadmin@example.com record becomes branchadmin@example.com
 * (admin, SBSI Makati Branch). Same emp_id, so its tickets, assignments and audit history stay
 * attached to the same person.
 *
 * Backend only: the email lives in this migration, never in the frontend.
 * If branchadmin@example.com already has a record (the account logged in first), the old record
 * is only deactivated, never merged over an existing one.
 */
return new class extends Migration
{
    private const OLD_EMAIL = 'superadmin@example.com';
    private const NEW_EMAIL = 'branchadmin@example.com';
    private const BRANCH_NAME = 'SBSI Makati Branch';

    /** Values restored on rollback (the record as it was before this migration). */
    private const OLD_VALUES = [
        'first_name' => 'Super',
        'last_name' => 'Admin',
        'role' => 'superadmin',
        'technical_role' => 'Super Admin',
        'branch' => 'Main Branch',
        'branch_id' => 1,
        'is_active' => false,
    ];

    public function up(): void
    {
        if (!Schema::hasTable('employees')) {
            return;
        }

        $old = DB::table('employees')->where('email', self::OLD_EMAIL)->first();
        if (!$old) {
            return;
        }

        if (DB::table('employees')->where('email', self::NEW_EMAIL)->exists()) {
            DB::table('employees')->where('emp_id', $old->emp_id)->update(['is_active' => false]);
            return;
        }

        $branch = Schema::hasTable('branches')
            ? DB::table('branches')->where('name', self::BRANCH_NAME)->first(['id', 'name'])
            : null;

        $update = $this->onlyExistingColumns([
            'email' => self::NEW_EMAIL,
            'first_name' => 'Branch',
            'last_name' => 'Admin',
            'role' => 'admin',
            'technical_role' => 'Branch Admin',
            'is_active' => true,
        ]);
        if ($branch) {
            $update += $this->onlyExistingColumns(['branch' => $branch->name, 'branch_id' => (int) $branch->id]);
        }

        DB::table('employees')->where('emp_id', $old->emp_id)->update($update);
    }

    public function down(): void
    {
        if (!Schema::hasTable('employees')) {
            return;
        }

        $merged = DB::table('employees')->where('email', self::NEW_EMAIL)->first();
        if (!$merged || DB::table('employees')->where('email', self::OLD_EMAIL)->exists()) {
            return;
        }

        DB::table('employees')->where('emp_id', $merged->emp_id)->update(
            $this->onlyExistingColumns(['email' => self::OLD_EMAIL] + self::OLD_VALUES)
        );
    }

    private function onlyExistingColumns(array $values): array
    {
        return array_filter(
            $values,
            fn ($column) => Schema::hasColumn('employees', $column),
            ARRAY_FILTER_USE_KEY
        );
    }
};
