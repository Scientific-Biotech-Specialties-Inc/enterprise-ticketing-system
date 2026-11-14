<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Spec 0043: the one place that maps a problem category to its owning department.
 *
 * Software goes to the IT department and Service goes to the Service department, matched by
 * name (as the create page did before). A configurable mapping is a listed follow up.
 * An unclassified ticket (NULL category) has no department.
 */
class CategoryDepartmentResolver
{
    /** @var array<string, string> lowercase category name => department name */
    private const CATEGORY_TO_DEPARTMENT = [
        'software' => 'IT',
        'service' => 'Service',
    ];

    /**
     * @return array{id:int, name:string, code:?string}|null
     */
    public function resolve(?int $categoryId): ?array
    {
        if (empty($categoryId)) {
            return null;
        }

        $categoryName = DB::table('problem_categories')
            ->where('problem_category_ID', $categoryId)
            ->value('category_name');

        return $this->resolveByCategoryName($categoryName);
    }

    /**
     * @return array{id:int, name:string, code:?string}|null
     */
    public function resolveByCategoryName(?string $categoryName): ?array
    {
        $key = strtolower(trim((string) $categoryName));
        $departmentName = self::CATEGORY_TO_DEPARTMENT[$key] ?? null;
        if ($departmentName === null) {
            return null;
        }

        $row = DB::table('departments')
            ->whereRaw('LOWER(name) = ?', [strtolower($departmentName)])
            ->first();

        if (!$row) {
            return null;
        }

        return [
            'id' => (int) $row->id,
            'name' => (string) $row->name,
            'code' => isset($row->code) && $row->code !== '' ? strtoupper((string) $row->code) : null,
        ];
    }

    /** True when the category is the Software category (no equipment). */
    public function isSoftware(?int $categoryId): bool
    {
        return $this->categoryKey($categoryId) === 'software';
    }

    /** True when the category is the Service category (a registered machine is required). */
    public function isService(?int $categoryId): bool
    {
        return $this->categoryKey($categoryId) === 'service';
    }

    private function categoryKey(?int $categoryId): ?string
    {
        if (empty($categoryId)) {
            return null;
        }
        $name = DB::table('problem_categories')->where('problem_category_ID', $categoryId)->value('category_name');
        return $name === null ? null : strtolower(trim((string) $name));
    }
}
