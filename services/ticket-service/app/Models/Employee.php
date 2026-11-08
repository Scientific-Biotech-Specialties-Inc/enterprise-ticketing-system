<?php

namespace App\Models;

class Employee extends User
{
    public $timestamps = false;

    protected $table = 'employees';
    protected $primaryKey = 'emp_id';
}