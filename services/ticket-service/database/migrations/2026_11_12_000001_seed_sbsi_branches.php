<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Seeds the official SBSI branch list into ticket-service's own branches table, mirroring
 * Auth Module migration 2026_11_12_000001_seed_sbsi_branches (no cross-database access).
 *
 * The three legacy branches are renamed in place (same ids, so tickets, employees, forecasts and
 * SLA rows keep their references); every other SBSI branch, and any legacy one this database never
 * had, is inserted. Slugs follow Str::slug(name), the same rule
 * BranchPriorityController::syncBranchesFromAuthService() uses, so the name-based sync matches these
 * rows instead of inserting duplicates and deactivating the originals. Nothing is deleted.
 */
return new class extends Migration
{
    /** Legacy name => new attributes, plus the legacy attributes restored on rollback. */
    private const RENAMES = [
        'Main Office' => [
            'new' => ['name' => 'SBSI Makati Branch', 'code' => 'MKT', 'region' => 'NCR',
                'address' => '6023 Sacred Heart cor. Kamagong Sts., San Antonio, 1203 Makati City, Metro Manila'],
            'old' => ['slug' => 'main-office', 'code' => 'MAIN', 'region' => 'Main',
                'address' => 'Makati City, Metro Manila'],
        ],
        'North Luzon Hub' => [
            'new' => ['name' => 'SBSI Isabela Branch', 'code' => 'ISA', 'region' => 'Luzon',
                'address' => 'Blk 8 Lot 2 Molave Subdivision, Brgy. Patul, Santiago City'],
            'old' => ['slug' => 'north-luzon-hub', 'code' => 'NORT', 'region' => 'Main',
                'address' => 'Blk 8 Lot 2 Molave Subdivision, Brgy. Patul, Santiago City, Isabela'],
        ],
        'Cebu City Office' => [
            'new' => ['name' => 'SBSI Cebu Branch', 'code' => 'CEB', 'region' => 'Visayas',
                'address' => '3264A Maria Theresa Village 2, Guadalupe, Cebu City'],
            'old' => ['slug' => 'cebu-city-office', 'code' => 'CEBU', 'region' => 'Main',
                'address' => '3264A Maria Theresa Village 2, Guadalupe, Cebu City, Cebu'],
        ],
    ];

    private const NEW_BRANCHES = [
        ['name' => 'SBSI Iloilo Branch', 'code' => 'ILO', 'region' => 'Visayas',
            'address' => 'Phil-Am Compound, Commission Civil St., Brgy. Our Lady of Fatima, Jaro, Iloilo City'],
        ['name' => 'SBSI Cagayan de Oro Branch', 'code' => 'CDO', 'region' => 'Mindanao',
            'address' => 'Casa Crisostomo Bldg., Manuel Vega St., Brgy. Consolacion, Cagayan de Oro City'],
        ['name' => 'SBSI Davao Branch', 'code' => 'DVO', 'region' => 'Mindanao',
            'address' => '165-Major Building, B-Bonifacio St., Brgy. 3-A Poblacion, Davao City'],
        ['name' => 'SBSI Zamboanga Branch', 'code' => 'ZAM', 'region' => 'Mindanao',
            'address' => 'A&W Subdivision, Guiwan Highway, Zamboanga City'],
    ];

    public function up(): void
    {
        if (!Schema::hasTable('branches')) {
            return;
        }

        $now = now();

        foreach (self::RENAMES as $legacyName => $spec) {
            $attrs = $spec['new'] + ['slug' => Str::slug($spec['new']['name']), 'is_active' => true, 'updated_at' => $now];

            $target = DB::table('branches')->where('name', $attrs['name'])->first();
            if ($target) {
                DB::table('branches')->where('id', $target->id)->update($attrs);
                continue;
            }

            $legacy = DB::table('branches')->where('name', $legacyName)->first();
            if ($legacy) {
                DB::table('branches')->where('id', $legacy->id)->update($attrs);
                if (Schema::hasTable('employees') && Schema::hasColumn('employees', 'branch')) {
                    DB::table('employees')->where('branch_id', $legacy->id)->update(['branch' => $attrs['name']]);
                }
                continue;
            }

            DB::table('branches')->insert($attrs + ['created_at' => $now]);
        }

        foreach (self::NEW_BRANCHES as $branch) {
            $attrs = $branch + ['slug' => Str::slug($branch['name']), 'is_active' => true, 'updated_at' => $now];
            $existing = DB::table('branches')->where('name', $attrs['name'])->first();
            if ($existing) {
                DB::table('branches')->where('id', $existing->id)->update($attrs);
            } else {
                DB::table('branches')->insert($attrs + ['created_at' => $now]);
            }
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('branches')) {
            return;
        }

        $now = now();

        foreach (self::RENAMES as $legacyName => $spec) {
            $renamed = DB::table('branches')->where('name', $spec['new']['name'])->first();
            $legacyTaken = DB::table('branches')->where('name', $legacyName)->exists();
            if ($renamed && !$legacyTaken) {
                DB::table('branches')->where('id', $renamed->id)->update($spec['old'] + [
                    'name' => $legacyName,
                    'updated_at' => $now,
                ]);
                if (Schema::hasTable('employees') && Schema::hasColumn('employees', 'branch')) {
                    DB::table('employees')->where('branch_id', $renamed->id)->update(['branch' => $legacyName]);
                }
            }
        }

        // Remove inserted branches only when nothing references them by id or slug.
        foreach (self::NEW_BRANCHES as $branch) {
            $row = DB::table('branches')->where('name', $branch['name'])->first();
            if ($row && !$this->isReferenced($row)) {
                DB::table('branches')->where('id', $row->id)->delete();
            }
        }
    }

    private function isReferenced(object $branch): bool
    {
        if (DB::getDriverName() !== 'mysql') {
            return true; // cannot inspect references safely: keep the branch
        }

        $tables = DB::table('information_schema.COLUMNS')
            ->where('TABLE_SCHEMA', DB::getDatabaseName())
            ->where('COLUMN_NAME', 'branch_id')
            ->pluck('TABLE_NAME');

        foreach ($tables as $table) {
            if (DB::table($table)->whereIn('branch_id', [(string) $branch->id, $branch->slug])->exists()) {
                return true;
            }
        }

        return false;
    }
};
