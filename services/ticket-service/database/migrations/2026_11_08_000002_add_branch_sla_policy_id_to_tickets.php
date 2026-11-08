<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0037 (AC-8): a ticket whose SLA came from a branch category policy now records
 * which policy it was. Nullable and additive. nullOnDelete: removing a policy leaves the
 * ticket's due dates intact and simply forgets the link.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('tickets', 'branch_sla_policy_id')) {
            return;
        }

        Schema::table('tickets', function (Blueprint $table) {
            $table->unsignedBigInteger('branch_sla_policy_id')->nullable()->index()->after('branch_priority_override_id');
            $table->foreign('branch_sla_policy_id', 'tickets_branch_sla_policy_fk')
                ->references('id')->on('branch_sla_policies')->nullOnDelete();
        });
    }

    public function down(): void
    {
        if (!Schema::hasColumn('tickets', 'branch_sla_policy_id')) {
            return;
        }

        Schema::table('tickets', function (Blueprint $table) {
            $table->dropForeign('tickets_branch_sla_policy_fk');
            $table->dropColumn('branch_sla_policy_id');
        });
    }
};
