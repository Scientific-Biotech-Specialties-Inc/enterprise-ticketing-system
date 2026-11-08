<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Carbon;

class TicketReferenceSeeder extends Seeder
{
    public function run(): void
    {
        $now = Carbon::now();
        
        $employeeRecords = [
            [
                'first_name' => 'Ava',
                'last_name' => 'Santos',
                'email' => 'cs@gmail.com',
                'role' => 'customer service',
                'department' => 'Customer Service',
                'is_active' => true,
                'password_hash' => Hash::make('12345678'),
            ],
            [
                'first_name' => 'Head of',
                'last_name' => 'CS',
                'email' => 'headofcs@gmail.com',
                'role' => 'head of cs',
                'department' => 'Customer Service',
                'is_active' => true,
                'password_hash' => Hash::make('12345678'),
            ],
            [
                'first_name' => 'Mark',
                'last_name' => 'Reyes',
                'email' => 'employee@gmail.com',
                'role' => 'service',
                'department' => 'Service',
                'is_active' => true,
                'password_hash' => Hash::make('12345678'),
            ],
            [
                'first_name' => 'John',
                'last_name' => 'Dela Cruz',
                'email' => 'tech1@example.com',
                'role' => 'service engineer',
                'department' => 'IT',
                'is_active' => true,
                'password_hash' => Hash::make('12345678'),
            ],
            [
                'first_name' => 'Bernadette',
                'last_name' => 'Gonzaga',
                'email' => 'slosinada@gmail.com',
                'role' => 'service engineer',
                'department' => 'Service',
                'is_active' => true,
                'password_hash' => Hash::make('12345678'),
            ],
        ];

        foreach ($employeeRecords as $record) {
            DB::table('employees')->updateOrInsert(
                ['email' => $record['email']],
                $record
            );
        }

        DB::table('clients')->upsert([
            [
                'id' => 1,
                'client_name' => 'SBSI Demo Customer',
                'address' => 'Quezon City',
                'contact_number' => '09123456789',
                'email' => 'customer@example.com',
                'status' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'id' => 2,
                'client_name' => 'Bernadette',
                'address' => 'Manila',
                'contact_number' => '09999999999',
                'email' => 'slosinada@gmail.com',
                'status' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ], ['id'], ['client_name', 'address', 'contact_number', 'email', 'status', 'updated_at']);

        DB::table('machine_categories')->upsert([
            [
                'category_ID' => 1,
                'category_name' => 'Imaging Equipment',
                'description' => 'MRI, CT, and X-ray equipment used in clinical diagnostics.',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'category_ID' => 2,
                'category_name' => 'Patient Monitoring',
                'description' => 'Vital sign and bedside monitoring devices.',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ], ['category_ID'], ['category_name', 'description', 'updated_at']);

        DB::table('problem_categories')->upsert([
            [
                'problem_category_ID' => 1,
                'category_name' => 'Machine Failure',
                'description' => 'The equipment will not power on or is not operating as expected.',
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'problem_category_ID' => 2,
                'category_name' => 'Calibration Required',
                'description' => 'The device needs calibration or accuracy verification.',
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ], ['problem_category_ID'], ['category_name', 'description', 'is_active', 'updated_at']);

        DB::table('ticket_types')->upsert([
            [
                'ticket_type_ID' => 1,
                'type_name' => 'Internal',
                'description' => 'Internal service ticket for staff-facing requests.',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'ticket_type_ID' => 2,
                'type_name' => 'External',
                'description' => 'Customer-submitted support ticket.',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ], ['ticket_type_ID'], ['type_name', 'description', 'updated_at']);

        DB::table('ticket_priorities')->upsert([
            [
                'priority_ID' => 1,
                'priority_name' => 'Low',
                'color_code' => '#22c55e',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'priority_ID' => 2,
                'priority_name' => 'Medium',
                'color_code' => '#f59e0b',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'priority_ID' => 3,
                'priority_name' => 'High',
                'color_code' => '#ef4444',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'priority_ID' => 4,
                'priority_name' => 'Critical',
                'color_code' => '#7c2d12',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ], ['priority_ID'], ['priority_name', 'color_code', 'updated_at']);

        DB::table('ticket_statuses')->upsert([
            [
                'ticket_status_ID' => 1,
                'status_name' => 'Open',
                'color_code' => '#f59e0b',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'ticket_status_ID' => 2,
                'status_name' => 'In Progress',
                'color_code' => '#2563eb',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'ticket_status_ID' => 3,
                'status_name' => 'Resolved',
                'color_code' => '#16a34a',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'ticket_status_ID' => 4,
                'status_name' => 'Closed',
                'color_code' => '#4b5563',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'ticket_status_ID' => 5,
                'status_name' => 'Escalated',
                'color_code' => '#dc2626',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'ticket_status_ID' => 6,
                'status_name' => 'Pending Evaluation',
                'color_code' => '#d97706',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'ticket_status_ID' => 7,
                'status_name' => 'Pending',
                'color_code' => '#d97706',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'ticket_status_ID' => 8,
                'status_name' => 'Reopened',
                'color_code' => '#ef4444',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'ticket_status_ID' => 9,
                'status_name' => 'Discarded',
                'color_code' => '#ef4444',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ], ['ticket_status_ID'], ['status_name', 'color_code', 'updated_at']);


        // Departments used by employees and CS assign modal
        DB::table('departments')->upsert([
            [
                'id' => 1,
                'name' => 'Service',
                'description' => 'Service and support team',
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'id' => 2,
                'name' => 'IT',
                'description' => 'IT and technical support',
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ], ['id'], ['name', 'description', 'is_active', 'updated_at']);

        DB::table('machines')->upsert([
            [
                'machine_ID' => 1,
                'category_ID' => 1,
                'client_ID' => 1,
                'machine_name' => 'MRI 3T Scanner',
                'serial_number' => 'MRI-3T-B02',
                'model' => 'Magnetom Vida',
                'brand' => 'Siemens',
                'status' => 'active',
                'purchase_date' => $now->copy()->subYears(2),
                'last_maintenance_date' => $now->copy()->subDays(30),
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'machine_ID' => 2,
                'category_ID' => 2,
                'client_ID' => 1,
                'machine_name' => 'Bedside Monitor',
                'serial_number' => 'MON-500-A11',
                'model' => 'VS-900',
                'brand' => 'Philips',
                'status' => 'active',
                'purchase_date' => $now->copy()->subYear(),
                'last_maintenance_date' => $now->copy()->subDays(14),
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ], ['machine_ID'], ['category_ID', 'client_ID', 'machine_name', 'serial_number', 'model', 'brand', 'status', 'purchase_date', 'last_maintenance_date', 'updated_at']);

        DB::table('slas')->upsert([
            [
                'sla_ID' => 1,
                'sla_name' => 'Standard SLA',
                'description' => 'Standard response and resolution window.',
                'response_time_minutes' => 240,
                'resolution_time_minutes' => 1440,
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'sla_ID' => 2,
                'sla_name' => 'Critical SLA',
                'description' => 'Fastest response for critical equipment failures.',
                'response_time_minutes' => 30,
                'resolution_time_minutes' => 240,
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ], ['sla_ID'], ['sla_name', 'description', 'response_time_minutes', 'resolution_time_minutes', 'is_active', 'updated_at']);

        // SLA Rules by Department & Priority
        DB::table('sla_rules')->upsert([
            // IT Support (Department ID 2)
            [
                'id' => 1,
                'department_id' => 2,
                'category_id' => null,
                'priority' => 'Critical',
                'response_time_limit' => 15,
                'resolution_time_limit' => 240,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'id' => 2,
                'department_id' => 2,
                'category_id' => null,
                'priority' => 'High',
                'response_time_limit' => 30,
                'resolution_time_limit' => 480,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'id' => 3,
                'department_id' => 2,
                'category_id' => null,
                'priority' => 'Medium',
                'response_time_limit' => 120,
                'resolution_time_limit' => 1440,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'id' => 4,
                'department_id' => 2,
                'category_id' => null,
                'priority' => 'Low',
                'response_time_limit' => 240,
                'resolution_time_limit' => 4320,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            // Service / Facilities (Department ID 1)
            [
                'id' => 5,
                'department_id' => 1,
                'category_id' => null,
                'priority' => 'Critical',
                'response_time_limit' => 30,
                'resolution_time_limit' => 480,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'id' => 6,
                'department_id' => 1,
                'category_id' => null,
                'priority' => 'High',
                'response_time_limit' => 60,
                'resolution_time_limit' => 1440,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ], ['id'], ['department_id', 'category_id', 'priority', 'response_time_limit', 'resolution_time_limit', 'updated_at']);
    }
}