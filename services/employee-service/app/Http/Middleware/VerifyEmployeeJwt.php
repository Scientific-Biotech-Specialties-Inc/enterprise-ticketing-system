<?php

namespace App\Http\Middleware;

if (!class_exists(\Ticketing\Auth\Middleware\VerifyEmployeeJwt::class)) {
    $canonicalPath = base_path('packages/ticketing-auth/src/Middleware/VerifyEmployeeJwt.php');
    if (!file_exists($canonicalPath)) {
        $canonicalPath = base_path('../../packages/ticketing-auth/src/Middleware/VerifyEmployeeJwt.php');
    }
    if (file_exists($canonicalPath)) {
        require_once dirname($canonicalPath) . '/../Dto/AuthenticatedUserDto.php';
        require_once dirname($canonicalPath) . '/../Security/TokenRevocationChecker.php';
        require_once $canonicalPath;
    }
}

use Ticketing\Auth\Middleware\VerifyEmployeeJwt as CanonicalVerifyEmployeeJwt;

class VerifyEmployeeJwt extends CanonicalVerifyEmployeeJwt
{
    // Inherits canonical RS256 verification, safe token caching, and revocation checks
}
