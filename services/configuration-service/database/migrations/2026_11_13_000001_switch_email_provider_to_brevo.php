<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0040: email delivery moves from Resend to Brevo.
 *
 * Resend keys do not work on Brevo, so existing Resend rows are deactivated (kept for
 * history and manual rollback). The SuperAdmin saves a Brevo key after deploy.
 */
return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('email_configurations', function (Blueprint $table) {
            $table->string('provider')->default('Brevo')->change();
        });

        DB::table('email_configurations')
            ->where('provider', 'Resend')
            ->update(['is_active' => false, 'updated_at' => now()]);
    }

    /**
     * Reverse the migrations. Rows are not reactivated automatically; see the spec's rollback steps.
     */
    public function down(): void
    {
        Schema::table('email_configurations', function (Blueprint $table) {
            $table->string('provider')->default('Resend')->change();
        });
    }
};
