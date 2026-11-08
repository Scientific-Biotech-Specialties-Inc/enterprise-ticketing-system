<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * The ticket state machines used to force a set of transitions through regardless
 * of the superadmin Transition Matrix. The matrix is now authoritative, so those
 * transitions are written into the stored matrix once to keep today's behaviour.
 * Open -> Closed is added so Customer Service can close an incoming ticket without
 * assigning it. Superadmins can uncheck any of these afterwards.
 */
return new class extends Migration
{
    private const ADDED_TRANSITIONS = [
        'Open' => ['Assigned', 'In Progress (CS-owned)', 'In Progress (Employee-owned)', 'Closed', 'Escalated'],
        'In Progress (CS-owned)' => ['Assigned', 'Closed', 'Escalated'],
        'Assigned' => ['On Hold/Pending', 'Escalated'],
        'Reassigned' => ['Assigned', 'Escalated'],
        'In Progress (Employee-owned)' => ['Assigned', 'Closed', 'Escalated'],
        'Escalated' => ['Assigned', 'In Progress (Employee-owned)', 'In Progress (CS-owned)', 'Resolved', 'Closed'],
    ];

    public function up(): void
    {
        $row = DB::table('ticket_configurations')->where('key', 'transitions')->first();
        if (!$row) {
            // Nothing stored yet: the services fall back to their (updated) defaults.
            return;
        }

        $rules = json_decode((string) $row->value, true);
        if (!is_array($rules) || empty($rules)) {
            return;
        }

        foreach (self::ADDED_TRANSITIONS as $from => $targets) {
            if (!isset($rules[$from])) {
                $rules[$from] = [
                    'allowed' => [],
                    'type' => 'editable',
                    'description' => $from === 'Escalated'
                        ? 'Ticket escalated to supervisory or department leadership.'
                        : "Transitions originating from {$from}.",
                ];
            }
            if (($rules[$from]['type'] ?? 'editable') !== 'editable') {
                continue;
            }
            $allowed = (array) ($rules[$from]['allowed'] ?? []);
            foreach ($targets as $target) {
                if (!in_array($target, $allowed, true)) {
                    $allowed[] = $target;
                }
            }
            $rules[$from]['allowed'] = array_values($allowed);
        }

        DB::table('ticket_configurations')->where('key', 'transitions')->update([
            'value' => json_encode($rules),
            'updated_at' => now(),
        ]);

        try {
            Cache::forget('ticket_configuration:transitions');
            Cache::forget('ticket:config:transitions');
        } catch (\Throwable $e) {
            // Cache is best effort; services re-read within 5 minutes.
        }
    }

    public function down(): void
    {
        // Data merge only; previous matrix contents cannot be reconstructed reliably.
    }
};
