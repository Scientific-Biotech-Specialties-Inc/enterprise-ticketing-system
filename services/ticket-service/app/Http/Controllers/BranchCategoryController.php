<?php

namespace App\Http\Controllers;

use App\Exceptions\BranchCategoryException;
use App\Services\BranchCategoryService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class BranchCategoryController extends Controller
{
    public function __construct(private readonly BranchCategoryService $service)
    {
    }

    private function checkSuperAdmin(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }
        if (strtolower(str_replace(' ', '', $user->role ?? '')) !== 'superadmin') {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return null;
    }

    public function branches(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $branches = DB::table('branches')
            ->where('is_active', true)
            ->orderBy('id')
            ->get(['slug as id', 'name', 'code', 'region'])
            ->toArray();

        array_unshift($branches, (object) [
            'id' => 'system',
            'name' => 'System-wide (Global)',
            'code' => 'SYS',
            'region' => 'All Regions',
        ]);

        return response()->json(['branches' => $branches]);
    }

    public function index(Request $request, string $branchId)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        return $this->guard(fn () => response()->json($this->service->listForBranch($branchId)));
    }

    public function storeCategory(Request $request, string $branchId)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $data = $request->validate([
            'category_name' => ['required', 'string', 'min:1', 'max:100', 'regex:/^[\pL\pN\s\-_.\/()&]+$/u'],
            'description' => ['nullable', 'string', 'max:255'],
            'is_active' => ['nullable', 'boolean'],
        ]);

        return $this->guard(function () use ($request, $branchId, $data) {
            $created = $this->service->createCategory($branchId, $data, $request->user());

            return response()->json([
                'message' => 'Category created successfully.',
                'category' => $created,
                ...$this->service->listForBranch($branchId),
            ], 201);
        });
    }

    public function updateCategory(Request $request, string $branchId, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $data = $request->validate([
            'category_name' => ['sometimes', 'required', 'string', 'min:1', 'max:100', 'regex:/^[\pL\pN\s\-_.\/()&]+$/u'],
            'description' => ['nullable', 'string', 'max:255'],
            'is_active' => ['nullable', 'boolean'],
        ]);

        return $this->guard(function () use ($request, $branchId, $id, $data) {
            $updated = $this->service->updateCategory($branchId, $id, $data, $request->user());

            return response()->json([
                'message' => 'Category updated successfully.',
                'category' => $updated,
                ...$this->service->listForBranch($branchId),
            ]);
        });
    }

    public function destroyCategory(Request $request, string $branchId, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        return $this->guard(function () use ($request, $branchId, $id) {
            $res = $this->service->deleteCategory($branchId, $id, $request->user());

            return response()->json([
                'message' => $res['message'],
                'result' => $res,
                ...$this->service->listForBranch($branchId),
            ]);
        });
    }

    public function storeSlaPolicy(Request $request, string $branchId)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $data = $request->validate([
            'category_name' => ['required', 'string', 'max:100'],
            'priority' => ['required', 'string', 'in:Critical,High,Medium,Low,critical,high,medium,low'],
            'resolution_time_limit' => ['required', 'integer', 'min:1', 'max:525600'],
            'response_time_limit' => ['nullable', 'integer', 'min:1', 'max:525600'],
        ]);

        if (isset($data['response_time_limit']) && (int) $data['resolution_time_limit'] < (int) $data['response_time_limit']) {
            throw ValidationException::withMessages([
                'resolution_time_limit' => 'Resolution time cannot be shorter than response time.',
            ]);
        }

        return $this->guard(function () use ($request, $branchId, $data) {
            $policy = $this->service->saveSlaPolicy($branchId, $data, $request->user());

            return response()->json([
                'message' => 'Branch SLA policy override saved. Changes apply to new tickets going forward.',
                'policy' => $policy,
                'slaChangePolicy' => BranchCategoryService::slaChangePolicy(),
                ...$this->service->listForBranch($branchId),
            ]);
        });
    }

    public function destroySlaPolicy(Request $request, string $branchId)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $data = $request->validate([
            'category_name' => ['required', 'string', 'max:100'],
            'priority' => ['required', 'string'],
        ]);

        return $this->guard(function () use ($request, $branchId, $data) {
            $res = $this->service->removeSlaPolicy($branchId, $data['category_name'], $data['priority'], $request->user());

            return response()->json([
                'message' => $res['message'],
                ...$this->service->listForBranch($branchId),
            ]);
        });
    }

    public function resetBranch(Request $request, string $branchId)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        return $this->guard(function () use ($request, $branchId) {
            $res = $this->service->resetBranchToDefaults($branchId, $request->user());

            return response()->json([
                'message' => $res['message'],
                ...$this->service->listForBranch($branchId),
            ]);
        });
    }

    private function guard(callable $callback)
    {
        try {
            return $callback();
        } catch (BranchCategoryException $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'code' => 'BRANCH_CATEGORY_ERROR',
                ...$e->context,
            ], $e->statusCode);
        }
    }
}
