<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Rejects HTML/script markup in free-text input (stored XSS defence in depth).
 * Plain text such as "a < b" or "Temp < 5" is still allowed.
 */
class NoMarkup implements ValidationRule
{
    public static function contains(?string $value): bool
    {
        return $value !== null && preg_match('/<[\/!?a-z]/i', $value) === 1;
    }

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (is_string($value) && self::contains($value)) {
            $fail("The {$attribute} must not contain HTML or script markup.");
        }
    }
}
