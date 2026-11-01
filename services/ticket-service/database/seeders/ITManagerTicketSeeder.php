<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;

class ITManagerTicketSeeder extends Seeder
{
    public function run(): void
    {
        $now = Carbon::now();

        // 1. Get client ID (fallback to first client or 1)
        $client = DB::table('clients')->first();
        $clientId = $client ? $client->id : 1;

        // 2. Get IT Manager and Staff employee IDs
        $itManager = DB::table('employees')->where('email', 'itmanager@example.com')->first();
        $davidMiller = DB::table('employees')->where('email', 'david.miller@example.com')->first();
        $sarahConnor = DB::table('employees')->where('email', 'sarah.connor@example.com')->first();
        $alexChen = DB::table('employees')->where('email', 'alex.chen@example.com')->first();

        $managerId = $itManager ? $itManager->emp_id : null;
        $davidId = $davidMiller ? $davidMiller->emp_id : null;
        $sarahId = $sarahConnor ? $sarahConnor->emp_id : null;
        $alexId = $alexChen ? $alexChen->emp_id : null;

        // Ensure fallback machine
        $machine = DB::table('machines')->first();
        $machineId = $machine ? $machine->machine_ID : 1;

        // Ensure problem category (network / IT)
        $problemCategory = DB::table('problem_categories')->where('category_name', 'like', '%Network%')->first()
            ?? DB::table('problem_categories')->first();
        $catId = $problemCategory ? $problemCategory->problem_category_ID : 1;

        // Sample IT Tickets to Seed
        $tickets = [
            // ── Unassigned Tickets (Pending Assignment) ─────────────────────────
            [
                'machine_ID' => $machineId,
                'problem_category_ID' => $catId,
                'created_by' => $clientId,
                'assigned_to' => null,
                'ticket_type_ID' => 1,
                'is_internal' => 1,
                'priority_ID' => 4, // Critical
                'ticket_status_ID' => 6, // Pending Assignment
                'sla_ID' => 1,
                'title' => 'Main Core Router BGP Peering Failure on Border Gateway',
                'description' => 'Border gateway router has dropped external BGP peer session with primary ISP. External services operating on failover circuit at 50% bandwidth.',
                'created_at' => $now->copy()->subHours(2),
                'updated_at' => $now->copy()->subHours(2),
            ],
            [
                'machine_ID' => $machineId,
                'problem_category_ID' => $catId,
                'created_by' => $clientId,
                'assigned_to' => null,
                'ticket_type_ID' => 1,
                'is_internal' => 1,
                'priority_ID' => 3, // High
                'ticket_status_ID' => 6, // Pending Assignment
                'sla_ID' => 1,
                'title' => 'Active Directory Domain Controller Replication Error',
                'description' => 'DC-02 is reporting Event ID 2042 tombstone lifetime replication failure against PDC-01. User group policies failing to sync in West Wing.',
                'created_at' => $now->copy()->subHours(4),
                'updated_at' => $now->copy()->subHours(4),
            ],

            // ── In Progress & Within SLA ───────────────────────────────────────
            [
                'machine_ID' => $machineId,
                'problem_category_ID' => $catId,
                'created_by' => $clientId,
                'assigned_to' => $davidId,
                'ticket_type_ID' => 1,
                'is_internal' => 1,
                'priority_ID' => 2, // Normal
                'ticket_status_ID' => 2, // In Progress
                'sla_ID' => 1,
                'first_response_at' => $now->copy()->subHours(10),
                'title' => 'Staff VLAN 20 Switch Port Configuration for Radiology Wing',
                'description' => 'Configure dedicated VLAN 20 trunk ports on Cisco 3850 switch stack in IDF-3 for newly deployed PACS workstations.',
                'created_at' => $now->copy()->subDay(),
                'updated_at' => $now->copy()->subHours(10),
            ],
            [
                'machine_ID' => $machineId,
                'problem_category_ID' => $catId,
                'created_by' => $clientId,
                'assigned_to' => $sarahId,
                'ticket_type_ID' => 1,
                'is_internal' => 1,
                'priority_ID' => 3, // High
                'ticket_status_ID' => 2, // In Progress
                'sla_ID' => 1,
                'first_response_at' => $now->copy()->subHours(4),
                'title' => 'Database Replica Lag Alert on PostgreSQL Cluster',
                'description' => 'Streaming replication lag exceeded 15 minutes on reporting node replica-02 due to heavy query contention from BI export.',
                'created_at' => $now->copy()->subHours(5),
                'updated_at' => $now->copy()->subHours(4),
            ],
            [
                'machine_ID' => $machineId,
                'problem_category_ID' => $catId,
                'created_by' => $clientId,
                'assigned_to' => $managerId,
                'ticket_type_ID' => 2,
                'is_internal' => 1,
                'priority_ID' => 2, // Normal
                'ticket_status_ID' => 2, // In Progress
                'sla_ID' => 1,
                'first_response_at' => $now->copy()->subDays(1),
                'title' => 'SSL Wildcard Certificate Expiry & Renewal on Web Portal',
                'description' => 'Annual wildcard certificate *.hospital-portal.internal expires in 14 days. Generate CSR, procure validation cert, and deploy to Nginx load balancers.',
                'created_at' => $now->copy()->subDays(2),
                'updated_at' => $now->copy()->subDays(1),
            ],

            // ── Breached Tickets (Past SLA Due Date) ───────────────────────────
            [
                'machine_ID' => $machineId,
                'problem_category_ID' => $catId,
                'created_by' => $clientId,
                'assigned_to' => $alexId,
                'ticket_type_ID' => 1,
                'is_internal' => 1,
                'priority_ID' => 4, // Critical
                'ticket_status_ID' => 2, // In Progress
                'sla_ID' => 1,
                'created_at' => $now->copy()->subDays(3)->subHours(18),
                'updated_at' => $now->copy()->subHours(2),
                'title' => 'Fiber Backbone Switch Intermittent Packet Loss',
                'description' => 'Core uplink between Building A and Building B exhibits 18% packet loss during peak telemetry hours. Optical transceivers require cleaning and attenuation testing.',
            ],
            [
                'machine_ID' => $machineId,
                'problem_category_ID' => $catId,
                'created_by' => $clientId,
                'assigned_to' => null, // Unassigned AND Breached!
                'ticket_type_ID' => 1,
                'is_internal' => 1,
                'priority_ID' => 3, // High
                'ticket_status_ID' => 6, // Pending Assignment
                'sla_ID' => 1,
                'created_at' => $now->copy()->subDays(2)->subHours(14)->subMinutes(30),
                'updated_at' => $now->copy()->subDays(2),
                'title' => 'VPN Gateway LDAP Authentication Timeout for Remote Doctors',
                'description' => 'FortiGate VPN portal fails to authenticate remote staff via LDAP binding after recent firewall firmware update. Users receiving error 403 credential rejection.',
            ],
            [
                'machine_ID' => $machineId,
                'problem_category_ID' => $catId,
                'created_by' => $clientId,
                'assigned_to' => $davidId,
                'ticket_type_ID' => 1,
                'is_internal' => 1,
                'priority_ID' => 4, // Critical
                'ticket_status_ID' => 2, // In Progress
                'sla_ID' => 1,
                'created_at' => $now->copy()->subDays(4)->subHours(8),
                'updated_at' => $now->copy()->subHours(12),
                'title' => 'Backup SAN Storage LUN Disconnect on Hyper-V Cluster Node 3',
                'description' => 'iSCSI initiator dropped target LUN 04 during automated snapshot consolidation. Cluster shared volume entered paused state, suspending non-critical VM backups.',
            ],
        ];

        foreach ($tickets as $t) {
            $existing = DB::table('tickets')->where('title', $t['title'])->first();
            if (!$existing) {
                $ticketId = DB::table('tickets')->insertGetId($t);

                // Add assignment record if assigned_to is set
                if (!empty($t['assigned_to'])) {
                    DB::table('ticket_assignments')->insert([
                        'ticket_ID' => $ticketId,
                        'employee_ID' => $t['assigned_to'],
                        'assigned_by' => $managerId ?: $t['assigned_to'],
                        'assignment_status' => 'assigned',
                        'assigned_at' => $t['created_at'],
                        'created_at' => $t['created_at'],
                        'updated_at' => $t['updated_at'],
                    ]);
                }
            }
        }
    }
}
