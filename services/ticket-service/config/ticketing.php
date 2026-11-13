<?php

/*
|--------------------------------------------------------------------------
| Ticketing domain settings (spec 0031)
|--------------------------------------------------------------------------
|
| technical_departments: the departments that actually handle tickets.
| Admin metrics that group by person or department (employee performance,
| department performance, SLA by department, workload) only cover these.
| Values are compared case insensitively after trimming.
|
| Override with TICKETING_TECHNICAL_DEPARTMENTS (comma separated), for
| example "Service,IT,Field Support".
|
*/

$technicalDepartments = array_values(array_filter(array_map(
    'trim',
    explode(',', (string) env('TICKETING_TECHNICAL_DEPARTMENTS', 'Service,IT'))
), fn ($d) => $d !== ''));

return [
    'technical_departments' => $technicalDepartments !== [] ? $technicalDepartments : ['Service', 'IT'],

    /*
    | Employee Performance Score (spec 0039, AC-16, AC-17).
    | score_weights: weight of each part; parts with no data are dropped and the
    | remaining weights are scaled to add up to 100.
    | min_judged_periods: fewer judged periods than this in the window means the
    | score is null with score_status "not_enough_data".
    */
    'performance' => [
        'score_weights' => [
            'resolution_sla' => 50,
            'response_sla' => 30,
            'csat' => 20,
        ],
        'min_judged_periods' => 3,
    ],
];
