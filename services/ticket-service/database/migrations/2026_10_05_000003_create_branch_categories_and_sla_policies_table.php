<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 1. Ensure problem_categories has branch_id and is_system_default
        if (Schema::hasTable('problem_categories')) {
            Schema::table('problem_categories', function (Blueprint $table) {
                if (!Schema::hasColumn('problem_categories', 'branch_id')) {
                    $table->string('branch_id', 64)->nullable()->index()->after('category_name');
                }
                if (!Schema::hasColumn('problem_categories', 'is_system_default')) {
                    $table->boolean('is_system_default')->default(false)->after('is_active');
                }
            });

            // Mark canonical categories as system defaults
            DB::table('problem_categories')
                ->whereIn('problem_category_ID', [1, 2, 3])
                ->orWhereIn('category_name', ['IT', 'Service', 'Others'])
                ->update(['is_system_default' => true, 'branch_id' => null]);
        }

        // 2. Ensure branches table exists and has baseline records
        if (!Schema::hasTable('branches')) {
            Schema::create('branches', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->string('slug', 64)->unique();
                $table->string('name');
                $table->string('code', 16)->nullable();
                $table->string('region')->nullable();
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });

            $now = now();
            DB::table('branches')->insertOrIgnore([
                ['slug' => 'main', 'name' => 'Main Branch', 'code' => 'MAIN', 'region' => 'NCR', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
                ['slug' => 'luzon', 'name' => 'Luzon Regional Center', 'code' => 'LUZ', 'region' => 'Luzon', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
                ['slug' => 'visayas', 'name' => 'Visayas Medical Hub', 'code' => 'VIS', 'region' => 'Visayas', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
                ['slug' => 'mindanao', 'name' => 'Mindanao Regional Branch', 'code' => 'MIN', 'region' => 'Mindanao', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
            ]);
        }

        // 3. Create branch_sla_policies table
        if (!Schema::hasTable('branch_sla_policies')) {
            Schema::create('branch_sla_policies', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->string('branch_id', 64);
                $table->unsignedBigInteger('category_id')->nullable();
                $table->string('category_name', 100);
                $table->string('priority', 50);
                $table->unsignedInteger('resolution_time_limit'); // minutes
                $table->unsignedInteger('response_time_limit')->nullable(); // minutes
                $table->unsignedBigInteger('created_by')->nullable();
                $table->unsignedBigInteger('updated_by')->nullable();
                $table->timestamps();

                $table->unique(['branch_id', 'category_name', 'priority'], 'bsp_branch_cat_prio_unique');
                $table->foreign('branch_id')->references('slug')->on('branches')->cascadeOnDelete();
                $table->foreign('category_id')->references('problem_category_ID')->on('problem_categories')->nullOnDelete();
            });
        }

        // 4. Seed initial branch categories for luzon if not exists
        $bioId = DB::table('problem_categories')
            ->where('branch_id', 'luzon')
            ->where('category_name', 'Biomedical Facility Maintenance')
            ->value('problem_category_ID');

        if (!$bioId) {
            $bioId = DB::table('problem_categories')->insertGetId([
                'category_name' => 'Biomedical Facility Maintenance',
                'branch_id' => 'luzon',
                'description' => 'Specialized biomedical hardware and clinical facility maintenance',
                'is_active' => true,
                'is_system_default' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $radId = DB::table('problem_categories')
            ->where('branch_id', 'luzon')
            ->where('category_name', 'Radiology Support')
            ->value('problem_category_ID');

        if (!$radId) {
            $radId = DB::table('problem_categories')->insertGetId([
                'category_name' => 'Radiology Support',
                'branch_id' => 'luzon',
                'description' => 'Imaging equipment calibration and radiology software support',
                'is_active' => true,
                'is_system_default' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        // 5. Seed initial SLA policy overrides for luzon
        DB::table('branch_sla_policies')->updateOrInsert(
            ['branch_id' => 'luzon', 'category_name' => 'IT', 'priority' => 'High'],
            [
                'category_id' => 1,
                'resolution_time_limit' => 360, // 6 hours
                'response_time_limit' => 30,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        DB::table('branch_sla_policies')->updateOrInsert(
            ['branch_id' => 'luzon', 'category_name' => 'Biomedical Facility Maintenance', 'priority' => 'Critical'],
            [
                'category_id' => $bioId,
                'resolution_time_limit' => 120, // 2 hours
                'response_time_limit' => 15,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        // 6. Ensure at least one open ticket references the Biomedical category in Luzon to demonstrate blocked deletion
        $hasOpenBioTicket = DB::table('tickets')
            ->where('problem_category_ID', $bioId)
            ->where('branch_id', 'luzon')
            ->whereNotIn('ticket_status_ID', [3, 4, 5, 9])
            ->exists();

        if (!$hasOpenBioTicket) {
            $clientId = DB::table('clients')->value('id') ?? 1;
            $machineId = DB::table('machines')->value('machine_ID') ?? 1;
            DB::table('tickets')->insert([
                'ticket_number' => 'LUZ-DEMO-0001',
                'title' => 'Biomedical Facility Air Filtration Unit Offline',
                'description' => 'Clinical laboratory filtration system requires urgent sensor replacement.',
                'problem_category_ID' => $bioId,
                'branch_id' => 'luzon',
                'machine_ID' => $machineId,
                'created_by' => $clientId,
                'ticket_type_ID' => 2,
                'ticket_status_ID' => 1, // Open
                'priority_ID' => 3, // High
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('branch_sla_policies');

        if (Schema::hasTable('problem_categories')) {
            Schema::table('problem_categories', function (Blueprint $table) {
                if (Schema::hasColumn('problem_categories', 'branch_id')) {
                    $table->dropColumn('branch_id');
                }
                if (Schema::hasColumn('problem_categories', 'is_system_default')) {
                    $table->dropColumn('is_system_default');
                }
            });
        }
    }
};
