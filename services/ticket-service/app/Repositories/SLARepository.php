<?php

namespace App\Repositories;

use Illuminate\Support\Facades\DB;

class SLARepository implements SLARepositoryInterface
{
    public function all(array $filters = [])
    {
        $query = DB::table('sla_rules as r')
            ->leftJoin('departments as d', 'd.id', '=', 'r.department_id')
            ->leftJoin('problem_categories as pc', 'pc.problem_category_ID', '=', 'r.category_id')
            ->select(
                'r.id',
                'r.department_id',
                'd.name as department_name',
                'r.category_id',
                'pc.category_name',
                'r.priority',
                'r.response_time_limit',
                'r.resolution_time_limit',
                'r.created_at',
                'r.updated_at'
            );

        if (!empty($filters['department_id'])) {
            $query->where('r.department_id', $filters['department_id']);
        }

        if (!empty($filters['priority'])) {
            $query->whereRaw('LOWER(r.priority) = ?', [strtolower($filters['priority'])]);
        }

        return $query->orderBy('d.name')->orderBy('r.priority')->get();
    }

    public function find(int $id)
    {
        return DB::table('sla_rules as r')
            ->leftJoin('departments as d', 'd.id', '=', 'r.department_id')
            ->leftJoin('problem_categories as pc', 'pc.problem_category_ID', '=', 'r.category_id')
            ->select(
                'r.id',
                'r.department_id',
                'd.name as department_name',
                'r.category_id',
                'pc.category_name',
                'r.priority',
                'r.response_time_limit',
                'r.resolution_time_limit',
                'r.created_at',
                'r.updated_at'
            )
            ->where('r.id', $id)
            ->first();
    }

    public function create(array $data)
    {
        $id = DB::table('sla_rules')->insertGetId([
            'department_id' => $data['department_id'],
            'category_id' => $data['category_id'] ?? null,
            'priority' => $data['priority'],
            'response_time_limit' => (int)$data['response_time_limit'],
            'resolution_time_limit' => (int)$data['resolution_time_limit'],
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $this->find($id);
    }

    public function update(int $id, array $data)
    {
        DB::table('sla_rules')
            ->where('id', $id)
            ->update([
                'department_id' => $data['department_id'],
                'category_id' => $data['category_id'] ?? null,
                'priority' => $data['priority'],
                'response_time_limit' => (int)$data['response_time_limit'],
                'resolution_time_limit' => (int)$data['resolution_time_limit'],
                'updated_at' => now(),
            ]);

        return $this->find($id);
    }

    public function delete(int $id)
    {
        return DB::table('sla_rules')->where('id', $id)->delete();
    }

    public function findMatchingRule(int $departmentId, ?int $categoryId, string $priority)
    {
        $priorityLower = strtolower(trim($priority));

        // 1. Exact match with department, category, and priority
        if ($categoryId) {
            $rule = DB::table('sla_rules')
                ->where('department_id', $departmentId)
                ->where('category_id', $categoryId)
                ->whereRaw('LOWER(priority) = ?', [$priorityLower])
                ->orderByDesc('updated_at')
                ->orderByDesc('id')
                ->first();

            if ($rule) {
                return $rule;
            }
        }

        // 2. Match with department and priority where category_id IS NULL
        $rule = DB::table('sla_rules')
            ->where('department_id', $departmentId)
            ->whereNull('category_id')
            ->whereRaw('LOWER(priority) = ?', [$priorityLower])
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->first();

        if ($rule) {
            return $rule;
        }

        // 3. Fallback: match any rule for department and priority
        $rule = DB::table('sla_rules')
            ->where('department_id', $departmentId)
            ->whereRaw('LOWER(priority) = ?', [$priorityLower])
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->first();

        if ($rule) {
            return $rule;
        }

        // 4. Global priority fallback (any department matching priority)
        return DB::table('sla_rules')
            ->whereRaw('LOWER(priority) = ?', [$priorityLower])
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->first();
    }
}
