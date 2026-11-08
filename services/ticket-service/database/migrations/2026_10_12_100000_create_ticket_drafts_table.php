<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('ticket_drafts')) {
            Schema::create('ticket_drafts', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('client_id')->index();
                $table->string('title')->nullable();
                $table->text('description')->nullable();
                $table->unsignedBigInteger('machine_ID')->nullable();
                $table->unsignedBigInteger('problem_category_ID')->nullable();
                $table->unsignedBigInteger('priority_ID')->nullable();
                $table->json('attachments')->nullable();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('ticket_drafts');
    }
};
