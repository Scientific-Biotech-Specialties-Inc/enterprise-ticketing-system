<?php

namespace App\Support;

/**
 * The departments that handle tickets (spec 0031 AC-1, AC-2).
 *
 * Source of truth is config('ticketing.technical_departments'), default Service and IT.
 * Department names are matched case insensitively after trimming, so "it " and "IT" are the same.
 */
class TechnicalDepartments
{
    /**
     * Configured department names, in their display spelling.
     *
     * @return array<int, string>
     */
    public static function list(): array
    {
        $configured = config('ticketing.technical_departments', ['Service', 'IT']);
        if (!is_array($configured)) {
            $configured = explode(',', (string) $configured);
        }

        $list = [];
        foreach ($configured as $dept) {
            $dept = trim((string) $dept);
            if ($dept !== '' && !in_array(self::normalize($dept), array_map([self::class, 'normalize'], $list), true)) {
                $list[] = $dept;
            }
        }

        return $list !== [] ? $list : ['Service', 'IT'];
    }

    /**
     * Lowercased, trimmed names used for comparisons and SQL bindings.
     *
     * @return array<int, string>
     */
    public static function normalizedList(): array
    {
        return array_map([self::class, 'normalize'], self::list());
    }

    public static function contains(?string $department): bool
    {
        if ($department === null || trim($department) === '') {
            return false;
        }

        return in_array(self::normalize($department), self::normalizedList(), true);
    }

    /**
     * The configured display name for a department, or null when it is not a technical department.
     */
    public static function canonical(?string $department): ?string
    {
        if (!self::contains($department)) {
            return null;
        }

        $needle = self::normalize((string) $department);
        foreach (self::list() as $dept) {
            if (self::normalize($dept) === $needle) {
                return $dept;
            }
        }

        return null;
    }

    /**
     * Limit an employees query to technical departments: LOWER(TRIM(alias.department)) IN (...).
     *
     * @param \Illuminate\Database\Query\Builder|\Illuminate\Database\Eloquent\Builder $query
     */
    public static function applyEmployeeFilter($query, string $alias = 'e')
    {
        $values = self::normalizedList();
        $placeholders = implode(', ', array_fill(0, count($values), '?'));
        $column = $alias !== '' ? "{$alias}.department" : 'department';

        return $query->whereRaw("LOWER(TRIM(COALESCE({$column}, ''))) IN ({$placeholders})", $values);
    }

    public static function normalize(string $department): string
    {
        return strtolower(trim($department));
    }
}
