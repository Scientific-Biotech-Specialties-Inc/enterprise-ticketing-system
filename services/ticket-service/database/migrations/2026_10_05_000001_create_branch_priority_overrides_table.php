<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
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
            DB::table('branches')->insert([
                ['slug' => 'main', 'name' => 'Main Branch', 'code' => 'MAIN', 'region' => 'NCR', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
                ['slug' => 'luzon', 'name' => 'Luzon Regional Center', 'code' => 'LUZ', 'region' => 'Luzon', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
                ['slug' => 'visayas', 'name' => 'Visayas Medical Hub', 'code' => 'VIS', 'region' => 'Visayas', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
                ['slug' => 'mindanao', 'name' => 'Mindanao Regional Branch', 'code' => 'MIN', 'region' => 'Mindanao', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
            ]);
        }

        if (!Schema::hasTable('branch_priority_overrides')) {
            Schema::create('branch_priority_overrides', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->string('branch_id', 64);
                $table->unsignedBigInteger('base_priority_id');
                $table->string('name', 100);
                $table->string('color', 100)->nullable();
                $table->unsignedInteger('response_time_limit'); // minutes
                $table->unsignedInteger('resolution_time_limit'); // minutes
                $table->unsignedBigInteger('created_by')->nullable();
                $table->unsignedBigInteger('updated_by')->nullable();
                $table->timestamps();

                $table->unique(['branch_id', 'base_priority_id'], 'bpo_branch_priority_unique');
                $table->foreign('branch_id')->references('slug')->on('branches')->cascadeOnDelete();
                $table->foreign('base_priority_id')->references('priority_ID')->on('ticket_priorities')->cascadeOnDelete();
            });
        }

        if (Schema::hasTable('tickets')) {
            Schema::table('tickets', function (Blueprint $table) {
                if (!Schema::hasColumn('tickets', 'branch_id')) {
                    $table->string('branch_id', 64)->nullable()->index();
                }
                if (!Schema::hasColumn('tickets', 'branch_priority_override_id')) {
                    $table->unsignedBigInteger('branch_priority_override_id')->nullable()->index();
                    // RESTRICT: a DB-level guarantee that a referenced override can never be removed.
                    $table->foreign('branch_priority_override_id', 'tickets_branch_priority_override_fk')
                        ->references('id')->on('branch_priority_overrides')->restrictOnDelete();
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('tickets')) {
            Schema::table('tickets', function (Blueprint $table) {
                if (Schema::hasColumn('tickets', 'branch_priority_override_id')) {
                    $table->dropForeign('tickets_branch_priority_override_fk');
                    $table->dropColumn('branch_priority_override_id');
                }
                if (Schema::hasColumn('tickets', 'branch_id')) {
                    $table->dropColumn('branch_id');
                }
            });
        }
        Schema::dropIfExists('branch_priority_overrides');
        Schema::dropIfExists('branches');
    }
};
