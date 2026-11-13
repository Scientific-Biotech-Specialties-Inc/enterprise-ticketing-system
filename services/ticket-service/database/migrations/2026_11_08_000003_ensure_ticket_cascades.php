<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ticket_audit_logs is intentionally left without a cascading foreign key.
        // Audit history must survive ticket deletion (see 2026_05_29_000050 and
        // the coding standards), so this migration no longer touches it.

        // Ensure work_logs foreign key cascades on ticket deletion.
        if (DB::getDriverName() !== 'sqlite' && Schema::hasTable('work_logs') && Schema::hasTable('tickets')) {
            // Clean up any orphan work logs
            DB::statement('
                DELETE FROM work_logs
                WHERE ticket_id IS NOT NULL
                AND ticket_id NOT IN (SELECT ticket_ID FROM tickets)
            ');

            // Blueprint commands run after the closure returns, so a try/catch
            // around dropForeign() cannot catch a missing key. Check first instead.
            $hasForeign = $this->foreignKeyExists('work_logs', 'work_logs_ticket_id_foreign');

            Schema::table('work_logs', function (Blueprint $table) use ($hasForeign) {
                if ($hasForeign) {
                    $table->dropForeign('work_logs_ticket_id_foreign');
                }

                $table->foreign('ticket_id', 'work_logs_ticket_id_foreign')
                    ->references('ticket_ID')
                    ->on('tickets')
                    ->cascadeOnDelete();
            });
        }
    }

    private function foreignKeyExists(string $table, string $name): bool
    {
        return DB::table('information_schema.REFERENTIAL_CONSTRAINTS')
            ->where('CONSTRAINT_SCHEMA', DB::getDatabaseName())
            ->where('TABLE_NAME', $table)
            ->where('CONSTRAINT_NAME', $name)
            ->exists();
    }

    public function down(): void
    {
        if (Schema::hasTable('ticket_audit_logs')) {
            Schema::table('ticket_audit_logs', function (Blueprint $table) {
                if (DB::getDriverName() !== 'sqlite') {
                    try {
                        $table->dropForeign('ticket_audit_logs_ticket_id_foreign');
                    } catch (\Throwable $e) {}
                }
            });
        }

        if (Schema::hasTable('work_logs')) {
            Schema::table('work_logs', function (Blueprint $table) {
                if (DB::getDriverName() !== 'sqlite') {
                    try {
                        $table->dropForeign('work_logs_ticket_id_foreign');
                    } catch (\Throwable $e) {}

                    $table->foreign('ticket_id', 'work_logs_ticket_id_foreign')
                        ->references('ticket_ID')
                        ->on('tickets')
                        ->nullOnDelete();
                }
            });
        }
    }
};
