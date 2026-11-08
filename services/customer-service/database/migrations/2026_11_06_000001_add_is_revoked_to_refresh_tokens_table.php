<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('refresh_tokens', function (Blueprint $table) {
            $table->boolean('is_revoked')->default(false)->after('token_hash')->index();
        });
    }

    public function down(): void
    {
        Schema::table('refresh_tokens', function (Blueprint $table) {
            $table->dropIndex(['is_revoked']);
            $table->dropColumn('is_revoked');
        });
    }
};

