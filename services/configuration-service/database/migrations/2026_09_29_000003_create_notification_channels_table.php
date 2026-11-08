<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     * Creates the notification_channels table for storing configurable delivery channels per alert event.
     */
    public function up(): void
    {
        Schema::create('notification_channels', function (Blueprint $table) {
            $table->id();

            // The event key (e.g. 'new_ticket', 'status_update', 'reassignment')
            $table->string('alert_key')->unique();

            // Display title and badge
            $table->string('title');
            $table->string('badge')->nullable();
            $table->string('badge_color')->nullable();

            // Channel selection: 'email', 'in_app', or 'both'
            $table->enum('channel', ['email', 'in_app', 'both'])->default('both');

            // Default fallback channel
            $table->enum('default_channel', ['email', 'in_app', 'both'])->default('both');

            // Descriptive text
            $table->text('description')->nullable();

            // Whether this is a system alert (always delivered to superadmin)
            $table->boolean('is_system_alert')->default(false);

            $table->timestamps();
            $table->index('alert_key');
            $table->index('channel');
        });

        // Seed default TS103 alert types and default channels
        $defaults = [
            [
                'alert_key'        => 'new_ticket',
                'title'            => 'New Ticket',
                'badge'            => 'Creation',
                'badge_color'      => 'bg-blue-50 text-blue-700 border-blue-200',
                'channel'          => 'both',
                'default_channel'  => 'both',
                'description'      => 'Triggered immediately when an end-customer or internal employee submits a new ticket.',
                'is_system_alert'  => false,
            ],
            [
                'alert_key'        => 'status_update',
                'title'            => 'Status Update',
                'badge'            => 'Lifecycle',
                'badge_color'      => 'bg-emerald-50 text-emerald-700 border-emerald-200',
                'channel'          => 'both',
                'default_channel'  => 'both',
                'description'      => 'Triggered when a ticket transitions between statuses (e.g. Open, In Progress, Resolved).',
                'is_system_alert'  => false,
            ],
            [
                'alert_key'        => 'escalation_delegation',
                'title'            => 'Escalation & Assignment',
                'badge'            => 'Escalation',
                'badge_color'      => 'bg-purple-50 text-purple-700 border-purple-200',
                'channel'          => 'both',
                'default_channel'  => 'both',
                'description'      => 'Triggered when a ticket SLA approaches breach or an engineer is assigned/delegated.',
                'is_system_alert'  => false,
            ],
            [
                'alert_key'        => 'reassignment',
                'title'            => 'Reassignment',
                'badge'            => 'Staff Transfer',
                'badge_color'      => 'bg-cyan-50 text-cyan-700 border-cyan-200',
                'channel'          => 'email',
                'default_channel'  => 'email',
                'description'      => 'Triggered when ticket ownership is transferred to another technician or department.',
                'is_system_alert'  => false,
            ],
            [
                'alert_key'        => 'new_message',
                'title'            => 'New Message',
                'badge'            => 'Messaging',
                'badge_color'      => 'bg-indigo-50 text-indigo-700 border-indigo-200',
                'channel'          => 'in_app',
                'default_channel'  => 'in_app',
                'description'      => 'Triggered when a customer or staff member posts a message in the ticket thread.',
                'is_system_alert'  => false,
            ],
            [
                'alert_key'        => 'overdue_sla_breach',
                'title'            => 'Overdue & SLA Breach',
                'badge'            => 'SLA Warning',
                'badge_color'      => 'bg-amber-50 text-amber-700 border-amber-200',
                'channel'          => 'both',
                'default_channel'  => 'both',
                'description'      => 'Triggered when a ticket response or resolution SLA has officially breached its deadline.',
                'is_system_alert'  => false,
            ],
            [
                'alert_key'        => 'system_alert',
                'title'            => 'System Alert',
                'badge'            => 'System Critical',
                'badge_color'      => 'bg-rose-50 text-rose-700 border-rose-200',
                'channel'          => 'both',
                'default_channel'  => 'both',
                'description'      => 'Critical infrastructure, security, or service desk failures requiring global administrative attention.',
                'is_system_alert'  => true,
            ],
        ];

        DB::table('notification_channels')->insert(
            array_map(function ($c) {
                return array_merge($c, [
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }, $defaults)
        );
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('notification_channels');
    }
};
