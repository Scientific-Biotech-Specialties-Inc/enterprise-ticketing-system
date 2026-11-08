<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0037 (AC-4): record who uploaded each file, so a pending file (not yet bound
 * to a ticket or assignment) can be opened by its uploader and nobody else.
 * Additive and nullable, safe on a running system.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['ticket_attachments', 'proof_of_completion'] as $tableName) {
            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                if (!Schema::hasColumn($tableName, 'uploaded_by_id')) {
                    $table->unsignedBigInteger('uploaded_by_id')->nullable();
                }
                if (!Schema::hasColumn($tableName, 'uploaded_by_type')) {
                    $table->string('uploaded_by_type', 20)->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        foreach (['ticket_attachments', 'proof_of_completion'] as $tableName) {
            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                $drop = array_values(array_filter(
                    ['uploaded_by_id', 'uploaded_by_type'],
                    fn ($col) => Schema::hasColumn($tableName, $col)
                ));
                if ($drop) {
                    $table->dropColumn($drop);
                }
            });
        }
    }
};
