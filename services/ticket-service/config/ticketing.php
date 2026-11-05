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
];
