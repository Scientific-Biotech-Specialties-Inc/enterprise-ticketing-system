<?php

namespace App\Http\Controllers;

use App\Exceptions\BranchPriorityException;
use App\Services\BranchPriorityService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class BranchPriorityController extends Controller
{
    private const COLOR_RULE = 'regex:/^[A-Za-z0-9\s:\/\-\[\]#.%(),]+$/';

    public function __construct(private readonly BranchPriorityService $service)
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
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }
        $role = strtolower(str_replace(' ', '', $user->role ?? ''));
        if (!in_array($role, ['superadmin', 'admin', 'systemadministrator'])) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return $this->publicBranches($request);
    }

    public function publicBranches(Request $request)
    {
        $this->syncBranchesFromAuthService();

        $cols = ['slug as id', 'name', 'code', 'region', 'is_active'];
        if (\Illuminate\Support\Facades\Schema::hasColumn('branches', 'address')) {
            $cols[] = 'address';
        }

        $branches = \Illuminate\Support\Facades\DB::table('branches')
            ->where('is_active', true)
            ->orderBy('id')
            ->get($cols);

        return response()->json([
            'branches' => $branches,
            'count' => count($branches),
        ]);
    }

    private function syncBranchesFromAuthService(): void
    {
        try {
            $authUrl = env('AUTH_SERVICE_URL') ?: env('CUSTOMER_SERVICE_URL') ?: 'http://auth-service:8000';
            $secret = env('INTERNAL_SERVICE_SECRET', env('INTERNAL_TOKEN', ''));

            $client = \Illuminate\Support\Facades\Http::timeout(3);
            if (!empty($secret)) {
                $client = $client->withHeaders(['X-Internal-Secret' => $secret]);
            }
            $res = $client->get("{$authUrl}/api/internal/branches");
            if ($res->successful()) {
                $branches = $res->json('data') ?? $res->json('branches') ?? $res->json();
                if (is_array($branches) && !empty($branches)) {
                    $syncedNames = [];
                    foreach ($branches as $b) {
                        if (empty($b['name'])) continue;
                        $syncedNames[] = $b['name'];
                        $slug = \Illuminate\Support\Str::slug($b['name']);
                        if (empty($slug)) $slug = 'branch-' . ($b['id'] ?? uniqid());

                        $exists = \Illuminate\Support\Facades\DB::table('branches')
                            ->where('name', $b['name'])
                            ->orWhere('slug', $slug)
                            ->first();

                        $data = [
                            'name' => $b['name'],
                            'is_active' => true,
                            'updated_at' => now(),
                        ];
                        if (\Illuminate\Support\Facades\Schema::hasColumn('branches', 'address') && !empty($b['address'])) {
                            $data['address'] = $b['address'];
                        }

                        if ($exists) {
                            \Illuminate\Support\Facades\DB::table('branches')
                                ->where('id', $exists->id)
                                ->update($data);
                        } else {
                            $data['slug'] = $slug;
                            $data['code'] = strtoupper(substr(preg_replace('/[^A-Za-z0-9]/', '', $b['name']), 0, 4)) ?: 'BR';
                            $data['region'] = 'Main';
                            $data['created_at'] = now();
                            \Illuminate\Support\Facades\DB::table('branches')->insert($data);
                        }
                    }

                    if (!empty($syncedNames)) {
                        \Illuminate\Support\Facades\DB::table('branches')
                            ->whereNotIn('name', $syncedNames)
                            ->update(['is_active' => false]);
                    }
                }
            }
        } catch (\Throwable $e) {
            // Gracefully degrade to existing local database branches
            \Illuminate\Support\Facades\Log::info('Branch sync from auth service skipped or failed: ' . $e->getMessage());
        }
    }

    public function index(Request $request, string $branchId)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        return $this->guard(fn () => response()->json($this->service->listForBranch($branchId)));
    }

    public function store(Request $request, string $branchId)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $data = $request->validate($this->rules(true));
        $this->assertSlaOrder($data);

        return $this->guard(function () use ($request, $branchId, $data) {
            $created = $this->service->create($branchId, $data, $request->user());

            return response()->json([
                'message' => 'Branch priority created successfully.',
                'override' => $created,
                'slaChangePolicy' => BranchPriorityService::slaChangePolicy(),
                ...$this->service->listForBranch($branchId),
            ], 201);
        });
    }

    public function update(Request $request, string $branchId, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $data = $request->validate($this->rules(false));
        $this->assertSlaOrder($data);

        return $this->guard(function () use ($request, $branchId, $id, $data) {
            $updated = $this->service->update($branchId, $id, $data, $request->user());

            return response()->json([
                'message' => 'Branch priority updated. The change applies to new tickets only.',
                'override' => $updated,
                ...$this->service->listForBranch($branchId),
            ]);
        });
    }

    public function destroy(Request $request, string $branchId, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        return $this->guard(function () use ($request, $branchId, $id) {
            $this->service->remove($branchId, $id, $request->user());

            return response()->json([
                'message' => 'Branch priority removed. This branch now inherits the system-wide default.',
                ...$this->service->listForBranch($branchId),
            ]);
        });
    }

    private function rules(bool $creating): array
    {
        $rules = [
            'name' => ['required', 'string', 'min:1', 'max:100', 'regex:/^[\pL\pN\s\-_.\/()&]+$/u'],
            'color' => ['nullable', 'string', 'max:100', self::COLOR_RULE],
            'response_time_limit' => ['required', 'integer', 'min:1', 'max:525600'],
            'resolution_time_limit' => ['required', 'integer', 'min:1', 'max:525600'],
        ];
        if ($creating) {
            $rules['base_priority_id'] = ['required', 'integer', Rule::exists('ticket_priorities', 'priority_ID')];
        }

        return $rules;
    }

    private function assertSlaOrder(array $data): void
    {
        if ((int) $data['resolution_time_limit'] < (int) $data['response_time_limit']) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'resolution_time_limit' => 'Resolution time cannot be shorter than response time.',
            ]);
        }
    }

    private function guard(callable $callback)
    {
        try {
            return $callback();
        } catch (BranchPriorityException $e) {
            return response()->json(['message' => $e->getMessage()] + $e->extra, $e->status);
        }
    }
}
