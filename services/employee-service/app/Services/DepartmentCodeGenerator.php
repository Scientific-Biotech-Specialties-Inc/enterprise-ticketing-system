<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Spec 0043 (AC-9): the one rule for suggesting a department code.
 *
 * - Several words: their initials (`Field Service` gives `FS`).
 * - One word: its first 3 letters (`Biomedical` gives `BIO`).
 * - Only uppercase letters and digits are kept.
 * - A taken code gets a number suffix (`BIO2`, `BIO3`).
 * - A name with no usable letters falls back to `DEPT`.
 */
class DepartmentCodeGenerator
{
    public const PATTERN = '/^[A-Z0-9_-]{2,16}$/';
    public const MAX_LENGTH = 16;

    /**
     * Suggest a free code for a department name.
     *
     * @param  string[]|null  $takenCodes  codes already in use (uppercase); read from departments when null
     */
    public function suggest(string $name, ?int $excludeId = null, ?array $takenCodes = null): string
    {
        $base = $this->baseCode($name);
        $taken = array_flip($takenCodes ?? $this->takenCodes($excludeId));

        if (!isset($taken[$base])) {
            return $base;
        }

        for ($i = 2; $i < 10000; $i++) {
            $suffix = (string) $i;
            $candidate = substr($base, 0, self::MAX_LENGTH - strlen($suffix)) . $suffix;
            if (!isset($taken[$candidate])) {
                return $candidate;
            }
        }

        return substr($base, 0, 8) . strtoupper(bin2hex(random_bytes(4)));
    }

    /** The code before any uniqueness suffix. */
    public function baseCode(string $name): string
    {
        $words = preg_split('/[^A-Za-z0-9]+/', strtoupper(trim($name)), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        if (count($words) > 1) {
            $code = implode('', array_map(fn ($w) => $w[0], $words));
        } elseif (count($words) === 1) {
            $code = substr($words[0], 0, 3);
        } else {
            $code = '';
        }

        $code = substr($code, 0, self::MAX_LENGTH);

        return strlen($code) >= 2 ? $code : 'DEPT';
    }

    /** Uppercase and trim a code a superadmin typed. */
    public function normalize(?string $code): string
    {
        return strtoupper(trim((string) $code));
    }

    public function isValid(string $normalizedCode): bool
    {
        return (bool) preg_match(self::PATTERN, $normalizedCode);
    }

    /**
     * @return string[]
     */
    public function takenCodes(?int $excludeId = null): array
    {
        $query = DB::table('departments')->whereNotNull('code');
        if ($excludeId) {
            $query->where('id', '!=', $excludeId);
        }

        return $query->pluck('code')->map(fn ($c) => strtoupper((string) $c))->all();
    }
}
