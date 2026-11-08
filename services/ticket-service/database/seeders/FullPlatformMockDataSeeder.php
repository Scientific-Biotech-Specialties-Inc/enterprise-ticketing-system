<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;

class FullPlatformMockDataSeeder extends Seeder
{
    public function run(): void
    {
        $now = Carbon::now();

        // ─────────────────────────────────────────────────────────────────────────────
        // 1. ENSURE CLIENTS EXIST
        // ─────────────────────────────────────────────────────────────────────────────
        $clientOne = DB::table('clients')->where('email', 'customer@gmail.com')->first();
        if (!$clientOne) {
            $clientOneId = DB::table('clients')->insertGetId([
                'client_name' => 'Customer One (St. Jude Medical Center)',
                'address' => 'Quezon City, Metro Manila',
                'contact_number' => '09123456781',
                'email' => 'customer@gmail.com',
                'status' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        } else {
            $clientOneId = $clientOne->id;
            DB::table('clients')->where('id', $clientOneId)->update([
                'client_name' => 'Customer One (St. Jude Medical Center)',
                'status' => true,
            ]);
        }

        $clientDemo = DB::table('clients')->where('email', 'customer@example.com')->first();
        if (!$clientDemo) {
            $clientDemoId = DB::table('clients')->insertGetId([
                'client_name' => 'SBSI Demo Customer (St. Luke\'s Hospital)',
                'address' => 'Bonifacio Global City, Taguig',
                'contact_number' => '09123456780',
                'email' => 'customer@example.com',
                'status' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        } else {
            $clientDemoId = $clientDemo->id;
        }

        $clientIds = array_unique([$clientOneId, $clientDemoId]);

        // ─────────────────────────────────────────────────────────────────────────────
        // 2. ENSURE KEY EMPLOYEES EXIST IN TICKET-SERVICE EMPLOYEES TABLE
        // ─────────────────────────────────────────────────────────────────────────────
        $targetEmployees = [
            [
                'email' => 'employee@gmail.com',
                'first_name' => 'Mark',
                'last_name' => 'Reyes',
                'role' => 'service',
                'department' => 'Service',
                'is_active' => 1,
            ],
            [
                'email' => 'cs@gmail.com',
                'first_name' => 'Ava',
                'last_name' => 'Santos',
                'role' => 'customer service',
                'department' => 'Customer Service',
                'is_active' => 1,
            ],
            [
                'email' => 'headofcs@gmail.com',
                'first_name' => 'Head of',
                'last_name' => 'CS',
                'role' => 'head of cs',
                'department' => 'Customer Service',
                'is_active' => 1,
            ],
            [
                'email' => 'slosinada@gmail.com',
                'first_name' => 'Bernadette',
                'last_name' => 'Gonzaga',
                'role' => 'service engineer',
                'department' => 'Service',
                'is_active' => 1,
            ],
            [
                'email' => 'engineer@example.com',
                'first_name' => 'Support',
                'last_name' => 'Engineer',
                'role' => 'service',
                'department' => 'Service',
                'is_active' => 1,
            ],
            [
                'email' => 'carlos.mendoza@hospital.com',
                'first_name' => 'Carlos',
                'last_name' => 'Mendoza',
                'role' => 'Lead Service Engineer',
                'department' => 'Service',
                'is_active' => 1,
            ],
        ];

        $defaultHash = '$argon2id$v=19$m=65536,t=4,p=1$bFIzU3dLckFiVkJYZ0MuSQ$v4bRIfc+uKchu/f74yjVAy9YL7k8XLVPnNZp+mM/BpY';

        foreach ($targetEmployees as $emp) {
            $existing = DB::table('employees')->where('email', $emp['email'])->first();
            if ($existing) {
                DB::table('employees')->where('emp_id', $existing->emp_id)->update($emp);
            } else {
                DB::table('employees')->insert(array_merge($emp, [
                    'password_hash' => $defaultHash,
                ]));
            }
        }

        $markReyes = DB::table('employees')->where('email', 'employee@gmail.com')->first();
        $markId = $markReyes ? $markReyes->emp_id : 2;

        $avaSantos = DB::table('employees')->where('email', 'cs@gmail.com')->first();
        $avaId = $avaSantos ? $avaSantos->emp_id : 1;

        $bernadette = DB::table('employees')->where('email', 'slosinada@gmail.com')->first();
        $bernadetteId = $bernadette ? $bernadette->emp_id : 4;

        $supportEng = DB::table('employees')->where('email', 'engineer@example.com')->first();
        $supportEngId = $supportEng ? $supportEng->emp_id : 7;

        $carlos = DB::table('employees')->where('email', 'carlos.mendoza@hospital.com')->first();
        $carlosId = $carlos ? $carlos->emp_id : 1028;

        // ─────────────────────────────────────────────────────────────────────────────
        // 3. SEED MACHINES FOR BOTH CLIENTS
        // ─────────────────────────────────────────────────────────────────────────────
        $machineTemplates = [
            ['name' => 'MRI 3T Scanner Magnetom Vida', 'serial' => 'MRI-3T-B02', 'model' => 'Magnetom Vida 3T', 'brand' => 'Siemens', 'cat' => 1],
            ['name' => 'Bedside Patient Monitor VS-900', 'serial' => 'MON-500-A11', 'model' => 'VS-900', 'brand' => 'Philips', 'cat' => 2],
            ['name' => 'Mechanical Ventilator Evita V800', 'serial' => 'VENT-800-C33', 'model' => 'Evita V800', 'brand' => 'Dräger', 'cat' => 2],
            ['name' => 'Infusion Pump Plum 360', 'serial' => 'PUMP-360-D44', 'model' => 'Plum 360', 'brand' => 'ICU Medical', 'cat' => 2],
            ['name' => 'Ultrasound System EPIQ 7', 'serial' => 'US-EPIQ-E55', 'model' => 'EPIQ 7', 'brand' => 'Philips', 'cat' => 1],
            ['name' => 'CT Scanner Somatom Force', 'serial' => 'CT-SOM-F66', 'model' => 'Somatom Force Dual-Source', 'brand' => 'Siemens', 'cat' => 1],
            ['name' => 'Defibrillator Lifepak 20e', 'serial' => 'DEFIB-20E-G77', 'model' => 'Lifepak 20e', 'brand' => 'Physio-Control', 'cat' => 2],
            ['name' => 'Dialysis Machine 5008S CorDiax', 'serial' => 'DIAL-5008-H88', 'model' => '5008S CorDiax', 'brand' => 'Fresenius', 'cat' => 2],
            ['name' => 'Anesthesia Workstation Perseus A500', 'serial' => 'ANES-A500-I99', 'model' => 'Perseus A500', 'brand' => 'Dräger', 'cat' => 2],
            ['name' => 'ECG PageWriter TC70', 'serial' => 'ECG-TC70-J00', 'model' => 'PageWriter TC70', 'brand' => 'Philips', 'cat' => 2],
            ['name' => 'DRX Evolution Plus Digital X-Ray', 'serial' => 'XRAY-DRX-K11', 'model' => 'DRX Evolution Plus', 'brand' => 'Carestream', 'cat' => 1],
            ['name' => 'EVIS EXERA III Video Colonoscope Tower', 'serial' => 'ENDO-EVIS-L22', 'model' => 'CV-190 / CLV-190', 'brand' => 'Olympus', 'cat' => 2],
        ];

        $clientMachineMap = [];
        foreach ($clientIds as $cId) {
            $clientMachineMap[$cId] = [];
            foreach ($machineTemplates as $t) {
                $serial = $t['serial'] . "-C" . $cId;
                $existing = DB::table('machines')
                    ->where('client_ID', $cId)
                    ->where('serial_number', $serial)
                    ->first();

                if ($existing) {
                    $mId = $existing->machine_ID;
                } else {
                    $mId = DB::table('machines')->insertGetId([
                        'category_ID' => $t['cat'],
                        'client_ID' => $cId,
                        'machine_name' => $t['name'],
                        'serial_number' => $serial,
                        'model' => $t['model'],
                        'brand' => $t['brand'],
                        'status' => 'active',
                        'purchase_date' => $now->copy()->subMonths(18),
                        'last_maintenance_date' => $now->copy()->subDays(25),
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                }
                $clientMachineMap[$cId][$t['name']] = $mId;
            }
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // 4. CLEAN OLD TEST SEED TICKETS FOR CLEAN SEEDING
        // ─────────────────────────────────────────────────────────────────────────────
        $oldSeedTitles = [
            'Bedside Monitor SpO2 Sensor Intermittent Error',
            'Mechanical Ventilator Flow Sensor Recalibration Required',
            'Dialysis Machine Temperature Control Warning',
            'MRI 3T Scanner Helium Cooling Pressure Alarm',
            'Ultrasound System EPIQ 7 Transducer Probe 2 Calibration',
            'CT Scanner Somatom Force Gantry Alignment Fault',
            'Anesthesia Workstation O2 Flush Valve Stiffness',
            'Defibrillator Lifepak 20e Internal Battery Replacement',
            'ECG PageWriter TC70 Thermal Printer Roller Cleaning',
            'Bedside Monitor Annual Preventive Maintenance & Inspection',
            'Infusion Pump Software Firmware Update to v4.1',
            'Digital X-Ray High Voltage Generator Error 104',
            'Infusion Pump Plum 360 Door Latch Malfunction',
            'Endoscopy Video Tower Cold Light Source Overheating',
            'Defibrillator Shock Discharge Verification Calibration',
            'Routine PM Service & Safety Inspection for MRI Suite',
            'Cardiology Wing Telemetry Central Gateway Dropouts',
            'Anesthesia Vaporizer Calibration & Pressure Leak Check',
        ];

        $oldTicketIds = DB::table('tickets')
            ->whereIn('title', $oldSeedTitles)
            ->pluck('ticket_ID');

        if ($oldTicketIds->isNotEmpty()) {
            $oldAssignmentIds = DB::table('ticket_assignments')
                ->whereIn('ticket_ID', $oldTicketIds)
                ->pluck('assignment_ID');

            if ($oldAssignmentIds->isNotEmpty()) {
                DB::table('proof_of_completion')->whereIn('assignment_ID', $oldAssignmentIds)->delete();
                DB::table('sla_trackings')->whereIn('assignment_ID', $oldAssignmentIds)->delete();
            }

            DB::table('ticket_attachments')->whereIn('ticket_id', $oldTicketIds)->delete();
            DB::table('ticket_remarks')->whereIn('ticket_id', $oldTicketIds)->delete();
            DB::table('internal_notes')->whereIn('ticket_id', $oldTicketIds)->delete();
            DB::table('reassignment_requests')->whereIn('ticket_id', $oldTicketIds)->delete();
            DB::table('work_logs')->whereIn('ticket_id', $oldTicketIds)->delete();
            DB::table('notifications')->whereIn('ticket_id', $oldTicketIds)->delete();
            DB::table('ticket_assignments')->whereIn('ticket_ID', $oldTicketIds)->delete();
            DB::table('tickets')->whereIn('ticket_ID', $oldTicketIds)->delete();
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // 5. DEFINE SEED TICKETS (Covers Customer, Employee, and CS workflows)
        // ─────────────────────────────────────────────────────────────────────────────
        foreach ($clientIds as $cId) {
            $mMap = $clientMachineMap[$cId];

            $tickets = [
                // ── CS INCOMING / UNASSIGNED QUEUE (Open / Pending Assignment, No Engineer) ──
                [
                    'machine_ID' => $mMap['Bedside Patient Monitor VS-900'] ?? 1,
                    'problem_category_ID' => 1,
                    'created_by' => $cId,
                    'assigned_to' => null,
                    'ticket_type_ID' => 2, // External
                    'is_internal' => 0,
                    'priority_ID' => 3, // High
                    'ticket_status_ID' => 1, // Open (CS Incoming)
                    'sla_ID' => 1,
                    'response_due_at' => $now->copy()->addHours(2),
                    'resolution_due_at' => $now->copy()->addHours(12),
                    'title' => 'Bedside Monitor SpO2 Sensor Intermittent Error',
                    'description' => 'Pulse oximetry sensor on VS-900 frequently disconnects during ICU continuous monitoring. Cable assembly or optical sensor head requires replacement.',
                    'created_at' => $now->copy()->subHours(2),
                    'updated_at' => $now->copy()->subHours(2),
                    'assignment' => null,
                ],
                [
                    'machine_ID' => $mMap['Mechanical Ventilator Evita V800'] ?? 1,
                    'problem_category_ID' => 2,
                    'created_by' => $cId,
                    'assigned_to' => null,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 4, // Critical
                    'ticket_status_ID' => 10, // Pending Assignment
                    'sla_ID' => 2,
                    'response_due_at' => $now->copy()->subHours(1), // Breached response SLA for alert testing
                    'resolution_due_at' => $now->copy()->addHours(4),
                    'title' => 'Mechanical Ventilator Flow Sensor Recalibration Required',
                    'description' => 'Dräger Evita V800 ventilator showing warning code W-104 indicating inspiratory flow sensor baseline drift. Machine locked out from clinical standby.',
                    'created_at' => $now->copy()->subHours(4),
                    'updated_at' => $now->copy()->subHours(4),
                    'assignment' => null,
                ],
                [
                    'machine_ID' => $mMap['Dialysis Machine 5008S CorDiax'] ?? 1,
                    'problem_category_ID' => 1,
                    'created_by' => $cId,
                    'assigned_to' => null,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 3, // High
                    'ticket_status_ID' => 1, // Open
                    'sla_ID' => 1,
                    'response_due_at' => $now->copy()->addHours(3),
                    'resolution_due_at' => $now->copy()->addHours(18),
                    'title' => 'Dialysis Machine Temperature Control Warning',
                    'description' => 'Fresenius 5008S unit reporting dialysate heating chamber temp fluctuation above 37.8C upper threshold during pre-treatment priming.',
                    'created_at' => $now->copy()->subHours(1),
                    'updated_at' => $now->copy()->subHours(1),
                    'assignment' => null,
                ],
                [
                    'machine_ID' => $mMap['EVIS EXERA III Video Colonoscope Tower'] ?? 1,
                    'problem_category_ID' => 1,
                    'created_by' => $cId,
                    'assigned_to' => null,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 2, // Medium
                    'ticket_status_ID' => 10, // Pending Assignment
                    'sla_ID' => 1,
                    'response_due_at' => $now->copy()->addHours(6),
                    'resolution_due_at' => $now->copy()->addHours(24),
                    'title' => 'Endoscopy Video Tower Cold Light Source Overheating',
                    'description' => 'CLV-190 xenon lamp ignition takes 3 attempts and thermal exhaust fan runs continuously at high speed.',
                    'created_at' => $now->copy()->subHours(5),
                    'updated_at' => $now->copy()->subHours(5),
                    'assignment' => null,
                ],

                // ── EMPLOYEE ASSIGNED & INCOMING QUEUE (Pending Acceptance by Mark Reyes) ──
                [
                    'machine_ID' => $mMap['DRX Evolution Plus Digital X-Ray'] ?? 1,
                    'problem_category_ID' => 1,
                    'created_by' => $cId,
                    'assigned_to' => $markId,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 4, // Critical
                    'ticket_status_ID' => 10, // Pending Assignment (awaiting employee acceptance)
                    'sla_ID' => 2,
                    'response_due_at' => $now->copy()->addHours(1),
                    'resolution_due_at' => $now->copy()->addHours(6),
                    'title' => 'Digital X-Ray High Voltage Generator Error 104',
                    'description' => 'Radiology ER X-Ray unit failing exposure initiation with high-voltage arc detection. Requires prompt circuit isolation and tube check.',
                    'created_at' => $now->copy()->subHours(1),
                    'updated_at' => $now->copy()->subHours(1),
                    'assignment' => [
                        'employee_ID' => $markId,
                        'assigned_by' => $avaId,
                        'assignment_status' => 'pending', // Pending acceptance in /employee/assigned
                        'assigned_at' => $now->copy()->subHours(1),
                    ],
                ],
                [
                    'machine_ID' => $mMap['Infusion Pump Plum 360'] ?? 1,
                    'problem_category_ID' => 2,
                    'created_by' => $cId,
                    'assigned_to' => $markId,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 2, // Medium
                    'ticket_status_ID' => 10,
                    'sla_ID' => 1,
                    'response_due_at' => $now->copy()->addHours(8),
                    'resolution_due_at' => $now->copy()->addHours(30),
                    'title' => 'Infusion Pump Plum 360 Door Latch Malfunction',
                    'description' => 'Cassette door latch mechanism on ICU pump loose, resulting in periodic occlusion false alarms.',
                    'created_at' => $now->copy()->subHours(3),
                    'updated_at' => $now->copy()->subHours(3),
                    'assignment' => [
                        'employee_ID' => $markId,
                        'assigned_by' => $avaId,
                        'assignment_status' => 'pending',
                        'assigned_at' => $now->copy()->subHours(3),
                    ],
                ],

                // ── EMPLOYEE ACTIVE WORKLOAD / IN PROGRESS (Mark Reyes) ──
                [
                    'machine_ID' => $mMap['MRI 3T Scanner Magnetom Vida'] ?? 1,
                    'problem_category_ID' => 1,
                    'created_by' => $cId,
                    'assigned_to' => $markId,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 4, // Critical
                    'ticket_status_ID' => 2, // In Progress
                    'sla_ID' => 2,
                    'first_response_at' => $now->copy()->subHours(18),
                    'first_cs_response_at' => $now->copy()->subHours(20),
                    'response_due_at' => $now->copy()->subHours(19),
                    'resolution_due_at' => $now->copy()->addHours(8),
                    'title' => 'MRI 3T Scanner Helium Cooling Pressure Alarm',
                    'description' => 'Cold head compressor circuit warning code H-201 active. Engineer on site verifying water chiller flow rates and helium buffer tank pressure.',
                    'created_at' => $now->copy()->subHours(24),
                    'updated_at' => $now->copy()->subHours(2),
                    'assignment' => [
                        'employee_ID' => $markId,
                        'assigned_by' => $avaId,
                        'assignment_status' => 'accepted',
                        'assigned_at' => $now->copy()->subHours(22),
                        'accepted_at' => $now->copy()->subHours(18),
                    ],
                    'work_logs' => [
                        [
                            'employee_id' => $markId,
                            'task_description' => 'Conducted physical inspection of helium compressor return line and verified chiller return temperature at 14.2C.',
                            'hours_spent' => 2.5,
                            'log_date' => $now->copy()->subHours(12)->toDateString(),
                            'status' => 'In Progress',
                        ],
                        [
                            'employee_id' => $markId,
                            'task_description' => 'Tested cold head displacer drive cycle and confirmed normal acoustic signature. Purging flex line oil trap.',
                            'hours_spent' => 3.0,
                            'log_date' => $now->copy()->subHours(3)->toDateString(),
                            'status' => 'In Progress',
                        ],
                    ],
                ],
                [
                    'machine_ID' => $mMap['Defibrillator Lifepak 20e'] ?? 1,
                    'problem_category_ID' => 1,
                    'created_by' => $cId,
                    'assigned_to' => $markId,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 3, // High
                    'ticket_status_ID' => 2, // In Progress (Breached SLA for alerts)
                    'sla_ID' => 1,
                    'first_response_at' => $now->copy()->subDays(2),
                    'first_cs_response_at' => $now->copy()->subDays(2),
                    'response_due_at' => $now->copy()->subDays(2)->addHours(2),
                    'resolution_due_at' => $now->copy()->subHours(3), // Past SLA due date!
                    'title' => 'Defibrillator Lifepak 20e Internal Battery Replacement',
                    'description' => 'Emergency crash cart defibrillator self-test reported degraded battery pack standby capacity (<75%). Battery replaced, awaiting safety discharge recalibration.',
                    'created_at' => $now->copy()->subDays(2),
                    'updated_at' => $now->copy()->subHours(1),
                    'assignment' => [
                        'employee_ID' => $markId,
                        'assigned_by' => $avaId,
                        'assignment_status' => 'accepted',
                        'assigned_at' => $now->copy()->subDays(2),
                        'accepted_at' => $now->copy()->subDays(2)->addHours(1),
                    ],
                    'work_logs' => [
                        [
                            'employee_id' => $markId,
                            'task_description' => 'Removed depleted OEM nickel-metal hydride battery pack and installed fresh calibrated replacement module.',
                            'hours_spent' => 1.5,
                            'log_date' => $now->copy()->subDays(1)->toDateString(),
                            'status' => 'In Progress',
                        ],
                    ],
                ],

                // ── TICKET WITH PENDING REASSIGNMENT REQUEST (Mark Reyes -> CS Review) ──
                [
                    'machine_ID' => $mMap['CT Scanner Somatom Force'] ?? 1,
                    'problem_category_ID' => 1,
                    'created_by' => $cId,
                    'assigned_to' => $markId,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 3, // High
                    'ticket_status_ID' => 2, // In Progress
                    'sla_ID' => 1,
                    'first_response_at' => $now->copy()->subHours(10),
                    'first_cs_response_at' => $now->copy()->subHours(12),
                    'response_due_at' => $now->copy()->addHours(4),
                    'resolution_due_at' => $now->copy()->addHours(20),
                    'title' => 'CT Scanner Somatom Force Gantry Alignment Fault',
                    'description' => 'Dual source CT gantry rotor vibration during rapid spiral scans. Specialist tool calibration required beyond standard field kit.',
                    'created_at' => $now->copy()->subHours(14),
                    'updated_at' => $now->copy()->subHours(2),
                    'assignment' => [
                        'employee_ID' => $markId,
                        'assigned_by' => $avaId,
                        'assignment_status' => 'reassign_requested',
                        'assigned_at' => $now->copy()->subHours(12),
                        'accepted_at' => $now->copy()->subHours(10),
                    ],
                    'reassignment_request' => [
                        'employee_id' => $markId,
                        'reason' => 'Requires dual-source optical rotor alignment jig available only with Lead Specialist Carlos Mendoza.',
                        'status' => 'pending',
                        'requested_at' => $now->copy()->subHours(2),
                    ],
                ],

                // ── TICKET WITH DENIED REASSIGNMENT REQUEST (Tests Employee Denial Banner & Notification) ──
                [
                    'machine_ID' => $mMap['Anesthesia Workstation Perseus A500'] ?? 1,
                    'problem_category_ID' => 1,
                    'created_by' => $cId,
                    'assigned_to' => $markId,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 3, // High
                    'ticket_status_ID' => 2, // In Progress
                    'sla_ID' => 1,
                    'first_cs_response_at' => $now->copy()->subHours(6),
                    'response_due_at' => $now->copy()->addHours(3),
                    'resolution_due_at' => $now->copy()->addHours(14),
                    'title' => 'Anesthesia Vaporizer Calibration & Pressure Leak Check',
                    'description' => 'Sevoflurane vaporizer concentration output reading 15% above dial setting during pre-op check. Requires manifold seal replacement and gas analyzer verification.',
                    'created_at' => $now->copy()->subHours(7),
                    'updated_at' => $now->copy()->subHours(1),
                    'assignment' => [
                        'employee_ID' => $markId,
                        'assigned_by' => $avaId,
                        'assignment_status' => 'assigned',
                        'assigned_at' => $now->copy()->subHours(6),
                        'accepted_at' => null,
                    ],
                    'reassignment_request' => [
                        'employee_id' => $markId,
                        'reason' => 'Currently handling MRI 3T helium compressor fault at main wing.',
                        'deny_reason' => 'All other anesthesia specialists are currently deployed on emergency regional dispatches. Please prioritize after completing your current MRI check.',
                        'status' => 'denied',
                        'requested_at' => $now->copy()->subHours(4),
                        'reviewed_at' => $now->copy()->subHours(1),
                    ],
                ],

                // ── TICKETS ASSIGNED TO TEAMMATES (Visible in CS Assigned & Department queues) ──
                [
                    'machine_ID' => $mMap['Ultrasound System EPIQ 7'] ?? 1,
                    'problem_category_ID' => 2,
                    'created_by' => $cId,
                    'assigned_to' => $bernadetteId,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 2, // Medium
                    'ticket_status_ID' => 2, // In Progress
                    'sla_ID' => 1,
                    'first_response_at' => $now->copy()->subHours(15),
                    'first_cs_response_at' => $now->copy()->subHours(16),
                    'response_due_at' => $now->copy()->addHours(6),
                    'resolution_due_at' => $now->copy()->addHours(28),
                    'title' => 'Ultrasound System EPIQ 7 Transducer Probe 2 Calibration',
                    'description' => 'Cardiac array probe X5-1 presenting artifact lines on B-mode imaging. Bernadette testing replacement transducer cable assembly.',
                    'created_at' => $now->copy()->subHours(18),
                    'updated_at' => $now->copy()->subHours(3),
                    'assignment' => [
                        'employee_ID' => $bernadetteId,
                        'assigned_by' => $avaId,
                        'assignment_status' => 'accepted',
                        'assigned_at' => $now->copy()->subHours(17),
                        'accepted_at' => $now->copy()->subHours(15),
                    ],
                ],
                [
                    'machine_ID' => $mMap['Anesthesia Workstation Perseus A500'] ?? 1,
                    'problem_category_ID' => 1,
                    'created_by' => $cId,
                    'assigned_to' => $supportEngId,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 3, // High
                    'ticket_status_ID' => 2, // In Progress
                    'sla_ID' => 1,
                    'first_response_at' => $now->copy()->subHours(6),
                    'first_cs_response_at' => $now->copy()->subHours(8),
                    'response_due_at' => $now->copy()->addHours(4),
                    'resolution_due_at' => $now->copy()->addHours(16),
                    'title' => 'Anesthesia Workstation O2 Flush Valve Stiffness',
                    'description' => 'Perseus A500 oxygen flush mechanical valve sticking. Support engineer replacing sealing diaphragms in OR Suite 2.',
                    'created_at' => $now->copy()->subHours(9),
                    'updated_at' => $now->copy()->subHours(1),
                    'assignment' => [
                        'employee_ID' => $supportEngId,
                        'assigned_by' => $avaId,
                        'assignment_status' => 'accepted',
                        'assigned_at' => $now->copy()->subHours(8),
                        'accepted_at' => $now->copy()->subHours(6),
                    ],
                ],

                // ── RESOLVED TICKETS (Eligible for Customer Feedback & CS Verification) ──
                [
                    'machine_ID' => $mMap['Bedside Patient Monitor VS-900'] ?? 1,
                    'problem_category_ID' => 2,
                    'created_by' => $cId,
                    'assigned_to' => $markId,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 2, // Medium
                    'ticket_status_ID' => 3, // Resolved
                    'sla_ID' => 1,
                    'first_response_at' => $now->copy()->subDays(2),
                    'first_cs_response_at' => $now->copy()->subDays(2),
                    'resolved_at' => $now->copy()->subHours(6),
                    'response_due_at' => $now->copy()->subDays(2)->addHours(4),
                    'resolution_due_at' => $now->copy()->subHours(2),
                    'title' => 'Bedside Monitor Annual Preventive Maintenance & Inspection',
                    'description' => 'Scheduled PM check completed. NIBP cuff pressure test passed, ECG lead simulator checked at 60/120 BPM, firmware updated to v3.4.',
                    'created_at' => $now->copy()->subDays(2),
                    'updated_at' => $now->copy()->subHours(6),
                    'assignment' => [
                        'employee_ID' => $markId,
                        'assigned_by' => $avaId,
                        'assignment_status' => 'completed',
                        'assigned_at' => $now->copy()->subDays(2),
                        'accepted_at' => $now->copy()->subDays(2)->addHours(1),
                        'completed_at' => $now->copy()->subHours(6),
                    ],
                ],

                // ── CLOSED / COMPLETED TICKETS (Customer & Employee History Tab) ──
                [
                    'machine_ID' => $mMap['ECG PageWriter TC70'] ?? 1,
                    'problem_category_ID' => 1,
                    'created_by' => $cId,
                    'assigned_to' => $markId,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 1, // Low
                    'ticket_status_ID' => 4, // Closed
                    'sla_ID' => 1,
                    'first_response_at' => $now->copy()->subDays(5),
                    'first_cs_response_at' => $now->copy()->subDays(5),
                    'resolved_at' => $now->copy()->subDays(4),
                    'closed_at' => $now->copy()->subDays(3),
                    'response_due_at' => $now->copy()->subDays(5)->addHours(6),
                    'resolution_due_at' => $now->copy()->subDays(3),
                    'title' => 'ECG PageWriter TC70 Thermal Printer Roller Cleaning',
                    'description' => 'Paper feed jam and faint print lines during 12-lead printouts. Printer thermal head cleaned, roller replaced, and test printout confirmed clear.',
                    'created_at' => $now->copy()->subDays(5),
                    'updated_at' => $now->copy()->subDays(3),
                    'assignment' => [
                        'employee_ID' => $markId,
                        'assigned_by' => $avaId,
                        'assignment_status' => 'completed',
                        'assigned_at' => $now->copy()->subDays(5),
                        'accepted_at' => $now->copy()->subDays(5)->addHours(1),
                        'completed_at' => $now->copy()->subDays(4),
                    ],
                ],
                [
                    'machine_ID' => $mMap['Infusion Pump Plum 360'] ?? 1,
                    'problem_category_ID' => 2,
                    'created_by' => $cId,
                    'assigned_to' => $bernadetteId,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 1, // Low
                    'ticket_status_ID' => 4, // Closed
                    'sla_ID' => 1,
                    'first_response_at' => $now->copy()->subDays(8),
                    'first_cs_response_at' => $now->copy()->subDays(8),
                    'resolved_at' => $now->copy()->subDays(7),
                    'closed_at' => $now->copy()->subDays(6),
                    'response_due_at' => $now->copy()->subDays(8)->addHours(8),
                    'resolution_due_at' => $now->copy()->subDays(5),
                    'title' => 'Infusion Pump Software Firmware Update to v4.1',
                    'description' => 'Security firmware upgrade applied across Plum 360 unit. Wireless network authentication certificate refreshed and test infusion verified.',
                    'created_at' => $now->copy()->subDays(8),
                    'updated_at' => $now->copy()->subDays(6),
                    'assignment' => [
                        'employee_ID' => $bernadetteId,
                        'assigned_by' => $avaId,
                        'assignment_status' => 'completed',
                        'assigned_at' => $now->copy()->subDays(8),
                        'accepted_at' => $now->copy()->subDays(8)->addHours(2),
                        'completed_at' => $now->copy()->subDays(7),
                    ],
                ],

                // ── REOPENED TICKET (Tests Reopen flow and status badge) ──
                [
                    'machine_ID' => $mMap['Defibrillator Lifepak 20e'] ?? 1,
                    'problem_category_ID' => 1,
                    'created_by' => $cId,
                    'assigned_to' => $markId,
                    'ticket_type_ID' => 2,
                    'is_internal' => 0,
                    'priority_ID' => 4, // Critical
                    'ticket_status_ID' => 8, // Reopened
                    'sla_ID' => 2,
                    'first_response_at' => $now->copy()->subDays(3),
                    'first_cs_response_at' => $now->copy()->subDays(3),
                    'response_due_at' => $now->copy()->addHours(2),
                    'resolution_due_at' => $now->copy()->addHours(6),
                    'title' => 'Defibrillator Shock Discharge Verification Calibration',
                    'description' => 'Post-repair 360-Joule discharge test yielded 342 Joules, falling outside 5% clinical accuracy threshold. Reopened for energy delivery recalibration.',
                    'created_at' => $now->copy()->subDays(3),
                    'updated_at' => $now->copy()->subHours(2),
                    'assignment' => [
                        'employee_ID' => $markId,
                        'assigned_by' => $avaId,
                        'assignment_status' => 'accepted',
                        'assigned_at' => $now->copy()->subHours(3),
                        'accepted_at' => $now->copy()->subHours(2),
                    ],
                ],
            ];

            $csUserIds = DB::table('employees')
                ->whereRaw('LOWER(role) IN (?, ?, ?, ?, ?, ?)', ['customer service', 'cs', 'customer support', 'head of cs', 'head of customer service', 'cs_manager'])
                ->orWhereRaw('LOWER(department) IN (?, ?)', ['customer service', 'customer support'])
                ->pluck('emp_id')
                ->unique()
                ->all();

            foreach ($tickets as $tData) {
                $assignmentData = $tData['assignment'] ?? null;
                $workLogsData = $tData['work_logs'] ?? [];
                $reassignData = $tData['reassignment_request'] ?? null;

                unset($tData['assignment'], $tData['work_logs'], $tData['reassignment_request']);

                $ticketId = DB::table('tickets')->insertGetId($tData);
                $ticketNumber = sprintf('TKT-%s-%05d', date('Ymd'), $ticketId);
                $ticketRef = 'TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT);

                // Set unique formatted ticket_number
                DB::table('tickets')->where('ticket_ID', $ticketId)->update([
                    'ticket_number' => $ticketNumber,
                ]);

                // Insert sample attachments for every seeded customer ticket (Defect 7 verification)
                DB::table('ticket_attachments')->insert([
                    [
                        'ticket_id' => $ticketId,
                        'file_name' => 'Equipment_Diagnostic_Report.pdf',
                        'file_path' => 'ticket-attachments/seeded/Equipment_Diagnostic_Report.pdf',
                        'file_type' => 'application/pdf',
                        'uploaded_at' => $tData['created_at'],
                    ],
                    [
                        'ticket_id' => $ticketId,
                        'file_name' => 'Console_Error_Capture.png',
                        'file_path' => 'ticket-attachments/seeded/Console_Error_Capture.png',
                        'file_type' => 'image/png',
                        'uploaded_at' => $tData['created_at'],
                    ],
                ]);

                // Insert Assignment
                if ($assignmentData) {
                    $assignmentData['ticket_ID'] = $ticketId;
                    $assignmentData['created_at'] = $tData['created_at'];
                    $assignmentData['updated_at'] = $tData['updated_at'];
                    DB::table('ticket_assignments')->insert($assignmentData);
                }

                // Insert Work Logs
                foreach ($workLogsData as $wl) {
                    $wl['ticket_id'] = $ticketId;
                    $wl['created_at'] = $now->copy()->subHours(6);
                    $wl['updated_at'] = $now->copy()->subHours(6);
                    DB::table('work_logs')->insert($wl);
                }

                // Insert Reassignment Request & Notifications (Defects 2, 3, 4 verification)
                if ($reassignData) {
                    if (!\Illuminate\Support\Facades\Schema::hasColumn('reassignment_requests', 'deny_reason')) {
                        unset($reassignData['deny_reason']);
                    }
                    $reassignData['ticket_id'] = $ticketId;
                    $reassignData['created_at'] = $reassignData['requested_at'];
                    $reassignData['updated_at'] = $reassignData['reviewed_at'] ?? $reassignData['requested_at'];
                    DB::table('reassignment_requests')->insert($reassignData);

                    if (($reassignData['status'] ?? '') === 'pending') {
                        // Notify all CSRs about the employee reassignment request
                        foreach ($csUserIds as $csEmpId) {
                            DB::table('notifications')->insert([
                                'recipient_id' => $csEmpId,
                                'recipient_type' => 'employee',
                                'title' => 'Reassignment Requested',
                                'message' => "Engineer Mark Reyes has requested reassignment for Ticket {$ticketRef}: \"{$tData['title']}\". Reason: \"{$reassignData['reason']}\".",
                                'data' => json_encode([
                                    'ticket_id' => $ticketId,
                                    'ticket_ref' => $ticketRef,
                                    'title' => $tData['title'],
                                    'requesting_employee' => 'Mark Reyes',
                                    'requested_by' => $markId,
                                    'reason' => $reassignData['reason'],
                                    'type' => 'reassignment_request',
                                ]),
                                'ticket_id' => $ticketId,
                                'is_read' => 0,
                                'created_at' => $reassignData['requested_at'],
                                'updated_at' => $reassignData['requested_at'],
                            ]);
                        }

                        // Notify Customer about the pending reassignment request
                        DB::table('notifications')->insert([
                            'recipient_id' => $cId,
                            'recipient_type' => 'customer',
                            'title' => 'Reassignment Requested',
                            'message' => "Engineer Mark Reyes has requested reassignment for your ticket {$ticketRef}: \"{$tData['title']}\". Reason: \"{$reassignData['reason']}\".",
                            'data' => json_encode([
                                'ticket_id' => $ticketId,
                                'ticket_ref' => $ticketRef,
                                'title' => $tData['title'],
                                'reason' => $reassignData['reason'],
                                'type' => 'reassignment_request',
                            ]),
                            'ticket_id' => $ticketId,
                            'is_read' => 0,
                            'created_at' => $reassignData['requested_at'],
                            'updated_at' => $reassignData['requested_at'],
                        ]);
                    } elseif (($reassignData['status'] ?? '') === 'denied') {
                        $denyReasonText = $reassignData['deny_reason'] ?? 'All other anesthesia specialists are currently deployed on emergency regional dispatches.';
                        // Notify Requesting Employee about Reassignment Rejection
                        DB::table('notifications')->insert([
                            'recipient_id' => $markId,
                            'recipient_type' => 'employee',
                            'title' => 'Reassignment Request Denied',
                            'message' => "Your reassignment request for Ticket {$ticketRef}: \"{$tData['title']}\" was denied by Customer Service. Reason: \"{$denyReasonText}\".",
                            'data' => json_encode([
                                'ticket_id' => $ticketId,
                                'ticket_ref' => $ticketRef,
                                'title' => $tData['title'],
                                'reason' => $denyReasonText,
                                'reassignmentDenyReason' => $denyReasonText,
                                'type' => 'reassignment_denied',
                            ]),
                            'ticket_id' => $ticketId,
                            'is_read' => 0,
                            'created_at' => $reassignData['reviewed_at'] ?? $now->copy()->subHours(1),
                            'updated_at' => $reassignData['reviewed_at'] ?? $now->copy()->subHours(1),
                        ]);

                        // Also add a Reassignment Approved notification sample for Mark Reyes so both states are visible in Bell notifications
                        DB::table('notifications')->insert([
                            'recipient_id' => $markId,
                            'recipient_type' => 'employee',
                            'title' => 'Reassignment Approved',
                            'message' => "Your reassignment request for Ticket {$ticketRef}: \"Ultrasound System EPIQ 7 Transducer Probe 2 Calibration\" has been approved by Customer Service.",
                            'data' => json_encode([
                                'ticket_id' => $ticketId,
                                'ticket_ref' => $ticketRef,
                                'title' => 'Ultrasound System EPIQ 7 Transducer Probe 2 Calibration',
                                'type' => 'reassignment_approved',
                            ]),
                            'ticket_id' => $ticketId,
                            'is_read' => 0,
                            'created_at' => $now->copy()->subHours(3),
                            'updated_at' => $now->copy()->subHours(3),
                        ]);
                    }
                }
            }
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // 6. SYNC ANY MISSING TICKET ASSIGNMENTS FOR PREVIOUS TICKETS
        // ─────────────────────────────────────────────────────────────────────────────
        $unassignedWithAssignedTo = DB::table('tickets as t')
            ->whereNotNull('t.assigned_to')
            ->whereNotExists(function ($q) {
                $q->select(DB::raw(1))
                    ->from('ticket_assignments as ta')
                    ->whereColumn('ta.ticket_ID', 't.ticket_ID');
            })
            ->select('t.ticket_ID', 't.assigned_to', 't.ticket_status_ID', 't.created_at', 't.updated_at')
            ->get();

        foreach ($unassignedWithAssignedTo as $row) {
            $isCompleted = in_array((int) $row->ticket_status_ID, [3, 4]);
            $isAccepted = in_array((int) $row->ticket_status_ID, [2, 3, 4, 8]);
            DB::table('ticket_assignments')->insert([
                'ticket_ID' => $row->ticket_ID,
                'employee_ID' => $row->assigned_to,
                'assigned_by' => $avaId,
                'assignment_status' => $isCompleted ? 'completed' : ($isAccepted ? 'accepted' : 'pending'),
                'assigned_at' => $row->created_at,
                'accepted_at' => $isAccepted ? $row->updated_at : null,
                'completed_at' => $isCompleted ? $row->updated_at : null,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ]);
        }
    }
}
