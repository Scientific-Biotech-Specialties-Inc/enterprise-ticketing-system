<?php

namespace App\Services;

use App\Events\BranchCategoryChanged;
use App\Events\BranchSlaPolicyChanged;
use App\Events\TicketChanged;
use App\Exceptions\BranchCategoryException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Branch-specific category management and SLA policy configuration.
 *
 * Precedence / Fallback:
 *   1. Branch SLA Policy override (branch_sla_policies: branch + category + priority)
 *   2. Branch Priority SLA override (branch_priority_overrides: branch + priority)
 *   3. System-wide category / priority SLA rule (sla_rules)
 *   4. System-wide default SLA policy (SLAService)
 *
 * SLA change policy (DECISION):
 *   Editing or removing an SLA policy affects NEW tickets only.
 *   Resolution and response deadlines stamped at ticket creation are NEVER retroactively
 *   recalculated, preserving SLA compliance reporting integrity and preventing artificial breaches.
 */
class BranchCategoryService
{
    public const SYSTEM_DEFAULT_SLAS = [
        'critical' => ['responseTimeLimit' => 15, 'resolutionTimeLimit' => 240],
        'high' => ['responseTimeLimit' => 30, 'resolutionTimeLimit' => 480],
        'medium' => ['responseTimeLimit' => 120, 'resolutionTimeLimit' => 1440],
        'low' => ['responseTimeLimit' => 240, 'resolutionTimeLimit' => 4320],
    ];

    public const FALLBACK_SLA = ['responseTimeLimit' => 60, 'resolutionTimeLimit' => 1440];

    public const STANDARD_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

    private const CLOSED_STATUSES = ['closed', 'cancelled', 'discarded', 'resolved'];

    public function __construct(private readonly TicketCacheService $cacheService)
    {
    }

    /**
     * Policy metadata exposed to the frontend for tooltips and UX transparency.
     */
    public static function slaChangePolicy(): array
    {
        return [
            'mode' => 'new_tickets_only',
            'recalculatesExistingOpenTickets' => false,
            'tooltip' => 'Changes to branch category SLA policies apply to tickets created after the update. '
                . 'Existing open tickets retain the deadlines calculated at creation.',
        ];
    }

    public function findBranch(string $branchId): ?object
    {
        if ($branchId === 'system' || $branchId === 'all' || $branchId === '0' || empty($branchId)) {
            return (object) [
                'id' => 0,
                'slug' => 'system',
                'name' => 'System-wide (Global)',
                'code' => 'SYS',
                'is_active' => true,
            ];
        }

        return DB::table('branches')->where('slug', $branchId)->where('is_active', true)->first();
    }

    public function requireBranch(string $branchId): object
    {
        $branch = $this->findBranch($branchId);
        if (!$branch) {
            throw new BranchCategoryException("Branch '{$branchId}' not found.", 404);
        }

        return $branch;
    }

    /**
     * List categories and SLA policies for a selected branch or system-wide.
     */
    public function listForBranch(string $branchId): array
    {
        $branch = $this->requireBranch($branchId);
        $isSystem = ($branch->slug === 'system');

        // 1. Fetch categories
        $categoryQuery = DB::table('problem_categories');
        if ($isSystem) {
            $categoryQuery->whereNull('branch_id');
        } else {
            $categoryQuery->where(function ($q) use ($branch) {
                $q->whereNull('branch_id')->orWhere('branch_id', $branch->slug);
            });
        }

        $categories = $categoryQuery->orderByDesc('is_system_default')
            ->orderBy('category_name')
            ->get();

        $categoryIds = $categories->pluck('problem_category_ID')->all();
        $ticketCounts = $this->categoryTicketCounts($categoryIds, $isSystem ? null : $branch->slug);

        $categoryList = $categories->map(function ($cat) use ($branch, $ticketCounts) {
            $counts = $ticketCounts[$cat->problem_category_ID] ?? ['open' => 0, 'total' => 0];
            $isBranchSpecific = !empty($cat->branch_id);

            return [
                'id' => (int) $cat->problem_category_ID,
                'key' => "cat-{$cat->problem_category_ID}",
                'name' => $cat->category_name,
                'description' => $cat->description,
                'branchId' => $cat->branch_id,
                'isSystemDefault' => (bool) $cat->is_system_default,
                'isBranchSpecific' => $isBranchSpecific,
                'isActive' => (bool) $cat->is_active,
                'openTicketCount' => $counts['open'],
                'totalTicketCount' => $counts['total'],
                'inUse' => $counts['open'] > 0,
                'canDelete' => !$cat->is_system_default && $counts['open'] === 0,
                'createdAt' => $cat->created_at,
                'updatedAt' => $cat->updated_at,
            ];
        })->values()->all();

        // 2. Fetch SLA policies & overrides
        $branchSlas = collect();
        if (!$isSystem) {
            $branchSlas = DB::table('branch_sla_policies')
                ->where('branch_id', $branch->slug)
                ->get()
                ->keyBy(function ($row) {
                    return strtolower(trim($row->category_name)) . ':' . strtolower(trim($row->priority));
                });
        }

        $slaPolicies = [];
        foreach ($categoryList as $cat) {
            foreach (self::STANDARD_PRIORITIES as $priority) {
                $prioKey = strtolower($priority);
                $sysDefault = self::SYSTEM_DEFAULT_SLAS[$prioKey] ?? self::FALLBACK_SLA;
                $lookupKey = strtolower(trim($cat['name'])) . ':' . $prioKey;
                $override = $branchSlas->get($lookupKey);

                $slaPolicies[] = [
                    'id' => $override?->id,
                    'key' => "sla-{$cat['id']}-{$prioKey}",
                    'branchId' => $branch->slug,
                    'categoryId' => $cat['id'],
                    'categoryName' => $cat['name'],
                    'priority' => $priority,
                    'isOverride' => $override !== null,
                    'resolutionTimeLimit' => $override ? (int) $override->resolution_time_limit : $sysDefault['resolutionTimeLimit'],
                    'responseTimeLimit' => $override ? (int) ($override->response_time_limit ?? $sysDefault['responseTimeLimit']) : $sysDefault['responseTimeLimit'],
                    'systemDefaultResolution' => $sysDefault['resolutionTimeLimit'],
                    'systemDefaultResponse' => $sysDefault['responseTimeLimit'],
                    'updatedAt' => $override?->updated_at,
                ];
            }
        }

        return [
            'branch' => [
                'id' => $branch->slug,
                'name' => $branch->name,
                'code' => $branch->code ?? strtoupper($branch->slug),
            ],
            'categories' => $categoryList,
            'slaPolicies' => $slaPolicies,
            'priorities' => self::STANDARD_PRIORITIES,
            'slaChangePolicy' => self::slaChangePolicy(),
        ];
    }

    /**
     * Create a category for a specific branch or system-wide.
     */
    public function createCategory(string $branchId, array $data, $user): array
    {
        $branch = $this->requireBranch($branchId);
        $targetBranchId = ($branch->slug === 'system') ? null : $branch->slug;
        $name = trim($data['category_name']);

        if (empty($name)) {
            throw new BranchCategoryException('Category name is required.', 422);
        }

        // Check duplicate name in same scope
        $existsQuery = DB::table('problem_categories')->whereRaw('LOWER(category_name) = ?', [strtolower($name)]);
        if ($targetBranchId === null) {
            $existsQuery->whereNull('branch_id');
        } else {
            $existsQuery->where('branch_id', $targetBranchId);
        }

        if ($existsQuery->exists()) {
            $scopeName = $targetBranchId ? $branch->name : 'system-wide';
            throw new BranchCategoryException("A ticket category named '{$name}' already exists for {$scopeName}.", 409);
        }

        $id = DB::table('problem_categories')->insertGetId([
            'category_name' => $name,
            'description' => $data['description'] ?? null,
            'branch_id' => $targetBranchId,
            'is_active' => $data['is_active'] ?? true,
            'is_system_default' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $created = DB::table('problem_categories')->where('problem_category_ID', $id)->first();
        $snapshot = $this->categorySnapshot($created);

        $this->audit(
            'config_create',
            $user,
            $branch,
            "Category: {$name}",
            null,
            $snapshot,
            "Created category '{$name}' for " . ($targetBranchId ? $branch->name : 'system-wide defaults')
        );

        $this->publishCategory(BranchCategoryChanged::ACTION_CREATED, $targetBranchId, null, $snapshot, $user);

        return $snapshot + ['id' => $id];
    }

    /**
     * Edit a ticket category.
     */
    public function updateCategory(string $branchId, int $id, array $data, $user): array
    {
        $branch = $this->requireBranch($branchId);
        $category = DB::table('problem_categories')->where('problem_category_ID', $id)->first();
        if (!$category) {
            throw new BranchCategoryException('Category not found.', 404);
        }

        // Branch authorization check: non-system users can only edit their branch categories
        if ($branch->slug !== 'system' && !empty($category->branch_id) && $category->branch_id !== $branch->slug) {
            throw new BranchCategoryException("Category does not belong to branch {$branch->name}.", 403);
        }

        $name = trim($data['category_name'] ?? $category->category_name);
        if (empty($name)) {
            throw new BranchCategoryException('Category name cannot be empty.', 422);
        }

        // Check unique name if changed
        if (strtolower($name) !== strtolower($category->category_name)) {
            $existsQuery = DB::table('problem_categories')
                ->where('problem_category_ID', '!=', $id)
                ->whereRaw('LOWER(category_name) = ?', [strtolower($name)]);
            if ($category->branch_id === null) {
                $existsQuery->whereNull('branch_id');
            } else {
                $existsQuery->where('branch_id', $category->branch_id);
            }
            if ($existsQuery->exists()) {
                throw new BranchCategoryException("Another category with name '{$name}' already exists in this scope.", 409);
            }
        }

        $before = $this->categorySnapshot($category);

        $updateData = [
            'category_name' => $name,
            'description' => array_key_exists('description', $data) ? $data['description'] : $category->description,
            'is_active' => array_key_exists('is_active', $data) ? (bool) $data['is_active'] : (bool) $category->is_active,
            'updated_at' => now(),
        ];

        DB::table('problem_categories')->where('problem_category_ID', $id)->update($updateData);

        // If category name changed, update branch_sla_policies referencing it
        if ($name !== $category->category_name) {
            DB::table('branch_sla_policies')
                ->where('category_id', $id)
                ->orWhere('category_name', $category->category_name)
                ->update(['category_name' => $name, 'updated_at' => now()]);
        }

        $updated = DB::table('problem_categories')->where('problem_category_ID', $id)->first();
        $after = $this->categorySnapshot($updated);

        $this->audit(
            'config_update',
            $user,
            $branch,
            "Category: {$name}",
            $before,
            $after,
            "Updated category '{$before['name']}'" . ($before['name'] !== $after['name'] ? " to '{$after['name']}'" : '')
        );

        $this->publishCategory(BranchCategoryChanged::ACTION_UPDATED, $category->branch_id, $before, $after, $user);

        return $after + ['id' => $id];
    }

    /**
     * Remove a ticket category.
     * BLOCKS removal if open tickets currently reference this category.
     */
    public function deleteCategory(string $branchId, int $id, $user): array
    {
        $branch = $this->requireBranch($branchId);
        $category = DB::table('problem_categories')->where('problem_category_ID', $id)->first();
        if (!$category) {
            throw new BranchCategoryException('Category not found.', 404);
        }

        // Invariant: Core system defaults cannot be deleted
        if ($category->is_system_default || in_array($id, [1, 2, 3], true)) {
            throw new BranchCategoryException(
                "Core system default category '{$category->category_name}' cannot be removed.",
                422,
                ['code' => 'SYSTEM_DEFAULT_PROTECTED']
            );
        }

        // Scope check
        if ($branch->slug !== 'system' && !empty($category->branch_id) && $category->branch_id !== $branch->slug) {
            throw new BranchCategoryException("Category does not belong to branch {$branch->name}.", 403);
        }

        // Check: BLOCK removal if open tickets currently reference this category
        $openTicketsCount = DB::table('tickets as t')
            ->leftJoin('ticket_statuses as s', 's.ticket_status_ID', '=', 't.ticket_status_ID')
            ->where('t.problem_category_ID', $id)
            ->where(function ($q) {
                $q->whereNotIn('t.ticket_status_ID', [3, 4, 5, 9])
                    ->whereNotIn(DB::raw('LOWER(s.status_name)'), self::CLOSED_STATUSES);
            })
            ->count();

        if ($openTicketsCount > 0) {
            throw new BranchCategoryException(
                "Cannot remove category '{$category->category_name}': it is referenced by {$openTicketsCount} active open ticket(s). Resolve or reassign active tickets before deleting.",
                409,
                ['code' => 'CATEGORY_IN_USE_OPEN_TICKETS', 'open_ticket_count' => $openTicketsCount]
            );
        }

        $before = $this->categorySnapshot($category);

        // Check if historical/closed tickets exist
        $totalReferencedTickets = DB::table('tickets')->where('problem_category_ID', $id)->count();

        if ($totalReferencedTickets > 0) {
            // Soft-archive/deactivate to preserve historical integrity & RESTRICT foreign keys
            DB::table('problem_categories')->where('problem_category_ID', $id)->update([
                'is_active' => false,
                'updated_at' => now(),
            ]);
            $actionNote = "Category '{$category->category_name}' has been deactivated (archived) because {$totalReferencedTickets} historical ticket(s) reference it.";
        } else {
            // Permanently remove
            DB::table('branch_sla_policies')->where('category_id', $id)->delete();
            DB::table('problem_categories')->where('problem_category_ID', $id)->delete();
            $actionNote = "Removed category '{$category->category_name}' permanently.";
        }

        $this->audit(
            'config_delete',
            $user,
            $branch,
            "Category: {$category->category_name}",
            $before,
            null,
            $actionNote
        );

        $this->publishCategory(BranchCategoryChanged::ACTION_REMOVED, $category->branch_id, $before, null, $user);

        return [
            'id' => $id,
            'name' => $category->category_name,
            'status' => $totalReferencedTickets > 0 ? 'archived' : 'deleted',
            'message' => $actionNote,
        ];
    }

    /**
     * Create or edit branch SLA policy by category and priority.
     */
    public function saveSlaPolicy(string $branchId, array $data, $user): array
    {
        $branch = $this->requireBranch($branchId);
        if ($branch->slug === 'system') {
            throw new BranchCategoryException('SLA overrides cannot be set on the global system branch. Choose a specific operational branch.', 422);
        }

        $categoryName = trim($data['category_name'] ?? '');
        $priority = ucfirst(strtolower(trim($data['priority'] ?? '')));
        $resolutionLimit = (int) ($data['resolution_time_limit'] ?? 0);
        $responseLimit = isset($data['response_time_limit']) ? (int) $data['response_time_limit'] : null;

        if (empty($categoryName)) {
            throw new BranchCategoryException('Category name is required.', 422);
        }
        if (!in_array($priority, self::STANDARD_PRIORITIES, true)) {
            throw new BranchCategoryException("Priority must be one of: " . implode(', ', self::STANDARD_PRIORITIES), 422);
        }
        if ($resolutionLimit < 1) {
            throw new BranchCategoryException('Resolution time limit must be at least 1 minute.', 422);
        }

        $categoryId = DB::table('problem_categories')
            ->where(function ($q) use ($branch) {
                $q->whereNull('branch_id')->orWhere('branch_id', $branch->slug);
            })
            ->whereRaw('LOWER(category_name) = ?', [strtolower($categoryName)])
            ->value('problem_category_ID');

        $existing = DB::table('branch_sla_policies')
            ->where('branch_id', $branch->slug)
            ->where('category_name', $categoryName)
            ->where('priority', $priority)
            ->first();

        $actorId = $this->actorId($user);

        if ($existing) {
            $before = [
                'resolution_time_limit' => (int) $existing->resolution_time_limit,
                'response_time_limit' => (int) $existing->response_time_limit,
            ];
            DB::table('branch_sla_policies')->where('id', $existing->id)->update([
                'category_id' => $categoryId,
                'resolution_time_limit' => $resolutionLimit,
                'response_time_limit' => $responseLimit,
                'updated_by' => $actorId,
                'updated_at' => now(),
            ]);
            $id = $existing->id;
            $action = 'config_update';
            $auditText = "Updated SLA policy for {$branch->name} ({$categoryName} / {$priority}): Resolution {$before['resolution_time_limit']}m → {$resolutionLimit}m. Applies to new tickets only.";
        } else {
            $before = null;
            $id = DB::table('branch_sla_policies')->insertGetId([
                'branch_id' => $branch->slug,
                'category_id' => $categoryId,
                'category_name' => $categoryName,
                'priority' => $priority,
                'resolution_time_limit' => $resolutionLimit,
                'response_time_limit' => $responseLimit,
                'created_by' => $actorId,
                'updated_by' => $actorId,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $action = 'config_create';
            $auditText = "Created SLA policy override for {$branch->name} ({$categoryName} / {$priority}): Resolution {$resolutionLimit}m, Response {$responseLimit}m. Applies to new tickets only.";
        }

        $after = [
            'id' => $id,
            'branch_id' => $branch->slug,
            'category_name' => $categoryName,
            'priority' => $priority,
            'resolution_time_limit' => $resolutionLimit,
            'response_time_limit' => $responseLimit,
        ];

        $this->audit(
            $action,
            $user,
            $branch,
            "SLA: {$categoryName} / {$priority}",
            $before,
            $after,
            $auditText
        );

        $this->publishSla(BranchSlaPolicyChanged::ACTION_SAVED, $branch->slug, $categoryName, $priority, $before, $after, $user);

        return $after;
    }

    /**
     * Remove branch SLA policy override, falling back to system-wide default SLA.
     */
    public function removeSlaPolicy(string $branchId, string $categoryName, string $priority, $user): array
    {
        $branch = $this->requireBranch($branchId);
        $categoryName = trim($categoryName);
        $priority = ucfirst(strtolower(trim($priority)));

        $row = DB::table('branch_sla_policies')
            ->where('branch_id', $branch->slug)
            ->whereRaw('LOWER(category_name) = ?', [strtolower($categoryName)])
            ->whereRaw('LOWER(priority) = ?', [strtolower($priority)])
            ->first();

        if (!$row) {
            throw new BranchCategoryException("No branch SLA policy override found for {$categoryName} ({$priority}).", 404);
        }

        $before = [
            'resolution_time_limit' => (int) $row->resolution_time_limit,
            'response_time_limit' => (int) $row->response_time_limit,
        ];

        DB::table('branch_sla_policies')->where('id', $row->id)->delete();

        $this->audit(
            'config_delete',
            $user,
            $branch,
            "SLA: {$categoryName} / {$priority}",
            $before,
            null,
            "Removed branch SLA policy override for {$branch->name} ({$categoryName} / {$priority}); branch now falls back to the system-wide default."
        );

        $this->publishSla(BranchSlaPolicyChanged::ACTION_REMOVED, $branch->slug, $categoryName, $priority, $before, null, $user);

        return [
            'branch_id' => $branch->slug,
            'category_name' => $categoryName,
            'priority' => $priority,
            'message' => 'Override removed; reverting to system default.',
        ];
    }

    /**
     * Reset branch categories and SLA policies to system defaults.
     */
    public function resetBranchToDefaults(string $branchId, $user): array
    {
        $branch = $this->requireBranch($branchId);
        if ($branch->slug === 'system') {
            throw new BranchCategoryException('Cannot reset global system defaults.', 422);
        }

        // Delete all SLA overrides for this branch
        $deletedSlaCount = DB::table('branch_sla_policies')->where('branch_id', $branch->slug)->delete();

        // Check any branch-specific categories
        $branchCats = DB::table('problem_categories')->where('branch_id', $branch->slug)->get();
        $deactivatedCats = 0;
        $deletedCats = 0;

        foreach ($branchCats as $cat) {
            $openTickets = DB::table('tickets')
                ->where('problem_category_ID', $cat->problem_category_ID)
                ->whereNotIn('ticket_status_ID', [3, 4, 5, 9])
                ->count();

            if ($openTickets > 0) {
                // Keep active if open tickets exist
                continue;
            }

            $totalTickets = DB::table('tickets')->where('problem_category_ID', $cat->problem_category_ID)->count();
            if ($totalTickets > 0) {
                DB::table('problem_categories')->where('problem_category_ID', $cat->problem_category_ID)->update(['is_active' => false]);
                $deactivatedCats++;
            } else {
                DB::table('problem_categories')->where('problem_category_ID', $cat->problem_category_ID)->delete();
                $deletedCats++;
            }
        }

        $auditText = "Reset {$branch->name} to system defaults: removed {$deletedSlaCount} SLA override(s), deleted {$deletedCats} custom category(s), archived {$deactivatedCats} in-use category(s).";

        $this->audit('config_reset', $user, $branch, 'Branch Reset', null, null, $auditText);

        $this->publishCategory(BranchCategoryChanged::ACTION_RESET, $branch->slug, null, null, $user);

        return [
            'branch_id' => $branch->slug,
            'deleted_sla_overrides' => $deletedSlaCount,
            'deleted_categories' => $deletedCats,
            'archived_categories' => $deactivatedCats,
            'message' => $auditText,
        ];
    }

    private function categoryTicketCounts(array $categoryIds, ?string $branchId): array
    {
        if (empty($categoryIds)) {
            return [];
        }

        $query = DB::table('tickets as t')
            ->leftJoin('ticket_statuses as s', 's.ticket_status_ID', '=', 't.ticket_status_ID')
            ->whereIn('t.problem_category_ID', $categoryIds);

        if ($branchId !== null) {
            $query->where(function ($q) use ($branchId) {
                $q->where('t.branch_id', $branchId)->orWhereNull('t.branch_id');
            });
        }

        $rows = $query->select('t.problem_category_ID as cid', 't.ticket_status_ID', 's.status_name')->get();

        $counts = [];
        foreach ($rows as $row) {
            $cid = $row->cid;
            $counts[$cid] ??= ['open' => 0, 'total' => 0];
            $counts[$cid]['total']++;

            $isClosed = in_array((int) $row->ticket_status_ID, [3, 4, 5, 9], true)
                || in_array(strtolower((string) $row->status_name), self::CLOSED_STATUSES, true);

            if (!$isClosed) {
                $counts[$cid]['open']++;
            }
        }

        return $counts;
    }

    private function categorySnapshot(object $row): array
    {
        return [
            'name' => $row->category_name,
            'description' => $row->description,
            'branch_id' => $row->branch_id,
            'is_active' => (bool) $row->is_active,
            'is_system_default' => (bool) $row->is_system_default,
        ];
    }

    private function actorId($user): ?int
    {
        $id = $user->emp_id ?? $user->id ?? null;

        return $id !== null ? (int) $id : null;
    }

    private function audit(string $type, $user, object $branch, string $target, ?array $before, ?array $after, string $text): void
    {
        $actorId = $this->actorId($user);
        $actorName = trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? ''));

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => $type,
            'action_by_ID' => $actorId,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Branch Category & SLA Configuration',
                'target' => "{$branch->name} / {$target}",
                'text' => $text,
                'branch_id' => $branch->slug,
                'branch_name' => $branch->name,
                'acting_admin' => [
                    'id' => $actorId,
                    'name' => $actorName ?: null,
                    'role' => $user->role ?? 'superadmin',
                ],
                'before' => $before,
                'after' => $after,
            ]),
            'created_at' => now(),
        ]);
    }

    private function publishCategory(string $action, ?string $branchId, ?array $before, ?array $after, $user): void
    {
        try {
            $this->cacheService->clearTicketCaches();
        } catch (\Throwable $e) {
            Log::warning('Branch category cache invalidation failed: ' . $e->getMessage());
        }

        try {
            event(new BranchCategoryChanged($action, $branchId, $before, $after, $this->actorId($user), now()->toIso8601String()));
            event(new TicketChanged(['type' => 'config', 'section' => 'branch-category', 'branch_id' => $branchId]));
        } catch (\Throwable $e) {
            Log::warning('Broadcasting BranchCategoryChanged failed: ' . $e->getMessage());
        }
    }

    private function publishSla(string $action, string $branchId, string $categoryName, string $priority, ?array $before, ?array $after, $user): void
    {
        try {
            $this->cacheService->clearTicketCaches();
        } catch (\Throwable $e) {
            Log::warning('Branch SLA cache invalidation failed: ' . $e->getMessage());
        }

        try {
            event(new BranchSlaPolicyChanged($action, $branchId, $categoryName, $priority, $before, $after, $this->actorId($user), now()->toIso8601String()));
            event(new TicketChanged(['type' => 'config', 'section' => 'branch-sla-policy', 'branch_id' => $branchId]));
        } catch (\Throwable $e) {
            Log::warning('Broadcasting BranchSlaPolicyChanged failed: ' . $e->getMessage());
        }
    }
}
