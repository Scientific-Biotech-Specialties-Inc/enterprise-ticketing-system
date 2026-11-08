<?php

namespace App\Helpers;

class RoleHelper
{
    /**
     * Check if a user has customer service, admin, or superadmin privileges.
     * Normalizes role strings by lowercasing and removing spaces.
     * Matches: 'customer service', 'Customer Service', 'customerservice', 'cs', 'admin', 'superadmin'.
     */
    public static function isCsOrAdmin($user): bool
    {
        if (!$user) {
            return false;
        }

        // Clients never possess staff CS/admin privileges
        if ($user instanceof \App\Models\Client) {
            return false;
        }

        $role = $user->role ?? null;
        if (!$role) {
            return false;
        }

        $normalized = strtolower(str_replace(' ', '', (string) $role));
        return in_array($normalized, ['customerservice', 'cs', 'headofcs', 'headofcustomerservice', 'admin', 'superadmin'], true);
    }

    /**
     * Normalize role string (lowercase with no spaces).
     */
    public static function normalizeRole($user): string
    {
        if (!$user || !isset($user->role)) {
            return '';
        }
        return strtolower(str_replace(' ', '', (string) $user->role));
    }
}
