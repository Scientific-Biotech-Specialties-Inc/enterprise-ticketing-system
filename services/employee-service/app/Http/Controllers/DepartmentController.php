<?php

namespace App\Http\Controllers;

use App\Services\DepartmentCodeGenerator;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Spec 0043 (AC-8 to AC-10): superadmin management of departments and their unique codes.
 * employee-service owns the departments table, so these endpoints live here.
 */
class DepartmentController extends Controller
{
    public function __construct(protected DepartmentCodeGenerator $codes) {}

    /**
     * GET /departments/code-suggestion?name=&exclude_id=
     */
    public function suggestCode(Request $request)
    {
        if ($denied = $this->denyUnlessSuperAdmin($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'exclude_id' => ['nullable', 'integer'],
        ]);

        if (trim($validated['name']) === '') {
            return response()->json(['message' => 'A department name is required.'], 422);
        }

        return response()->json([
            'code' => $this->codes->suggest($validated['name'], $validated['exclude_id'] ?? null),
        ]);
    }

    /**
     * POST /departments
     */
    public function store(Request $request)
    {
        if ($denied = $this->denyUnlessSuperAdmin($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'code' => ['nullable', 'string', 'max:16'],
            'description' => ['nullable', 'string', 'max:1000'],
        ]);

        $name = trim($validated['name']);
        if ($error = $this->nameError($name, null)) {
            return $error;
        }

        $code = isset($validated['code']) && trim($validated['code']) !== ''
            ? $this->codes->normalize($validated['code'])
            : $this->codes->suggest($name);

        if ($error = $this->codeError($code, null)) {
            return $error;
        }

        try {
            $id = DB::table('departments')->insertGetId([
                'name' => $name,
                'code' => $code,
                'description' => isset($validated['description']) ? strip_tags($validated['description']) : null,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (QueryException $e) {
            return $this->raceConflict($e, $code);
        }

        return response()->json([
            'message' => 'Department created.',
            'department' => $this->present(DB::table('departments')->where('id', $id)->first()),
        ], 201);
    }

    /**
     * PUT /departments/{id} — a code edit only affects tickets created afterwards.
     */
    public function update(Request $request, int $id)
    {
        if ($denied = $this->denyUnlessSuperAdmin($request)) {
            return $denied;
        }

        $department = DB::table('departments')->where('id', $id)->first();
        if (!$department) {
            return response()->json(['message' => 'Department not found.'], 404);
        }

        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'code' => ['sometimes', 'required', 'string', 'max:16'],
            'description' => ['nullable', 'string', 'max:1000'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $update = ['updated_at' => now()];

        if (array_key_exists('name', $validated)) {
            $name = trim($validated['name']);
            if ($error = $this->nameError($name, $id)) {
                return $error;
            }
            $update['name'] = $name;
        }

        if (array_key_exists('code', $validated)) {
            $code = $this->codes->normalize($validated['code']);
            if ($error = $this->codeError($code, $id)) {
                return $error;
            }
            $update['code'] = $code;
        }

        if (array_key_exists('description', $validated)) {
            $update['description'] = $validated['description'] !== null ? strip_tags($validated['description']) : null;
        }

        if (array_key_exists('is_active', $validated)) {
            $update['is_active'] = (bool) $validated['is_active'];
        }

        try {
            DB::table('departments')->where('id', $id)->update($update);
        } catch (QueryException $e) {
            return $this->raceConflict($e, $update['code'] ?? (string) $department->code);
        }

        return response()->json([
            'message' => 'Department updated.',
            'department' => $this->present(DB::table('departments')->where('id', $id)->first()),
        ]);
    }

    private function codeError(string $code, ?int $excludeId)
    {
        if (!$this->codes->isValid($code)) {
            return response()->json([
                'message' => 'Code must be 2 to 16 characters: letters, digits, hyphens, or underscores.',
                'errors' => ['code' => ['Code must be 2 to 16 characters: letters, digits, hyphens, or underscores.']],
            ], 422);
        }

        $owner = DB::table('departments')
            ->whereRaw('UPPER(code) = ?', [$code])
            ->when($excludeId, fn ($q) => $q->where('id', '!=', $excludeId))
            ->value('name');

        if ($owner !== null) {
            $message = $this->duplicateMessage($code, (string) $owner);
            return response()->json(['message' => $message, 'errors' => ['code' => [$message]]], 422);
        }

        return null;
    }

    private function nameError(string $name, ?int $excludeId)
    {
        if ($name === '') {
            return response()->json(['message' => 'A department name is required.', 'errors' => ['name' => ['A department name is required.']]], 422);
        }

        $exists = DB::table('departments')
            ->whereRaw('LOWER(name) = ?', [strtolower($name)])
            ->when($excludeId, fn ($q) => $q->where('id', '!=', $excludeId))
            ->exists();

        if ($exists) {
            $message = "A department named {$name} already exists.";
            return response()->json(['message' => $message, 'errors' => ['name' => [$message]]], 422);
        }

        return null;
    }

    /**
     * Two saves of the same code at once: the unique index lets one win; the other gets 409.
     */
    private function raceConflict(QueryException $e, string $code)
    {
        $isDuplicate = ($e->errorInfo[1] ?? null) === 1062 || str_contains($e->getMessage(), 'Duplicate entry');
        if (!$isDuplicate) {
            throw $e;
        }

        $owner = DB::table('departments')->whereRaw('UPPER(code) = ?', [$code])->value('name');
        $message = $owner !== null
            ? $this->duplicateMessage($code, (string) $owner)
            : 'That department name or code was just taken. Refresh and try again.';

        return response()->json(['message' => $message], 409);
    }

    private function duplicateMessage(string $code, string $owner): string
    {
        return "Code {$code} is already used by {$owner}.";
    }

    private function present($d): array
    {
        return [
            'id' => (int) $d->id,
            'name' => (string) $d->name,
            'code' => (string) ($d->code ?? ''),
            'description' => $d->description ?? null,
            'is_active' => (bool) $d->is_active,
        ];
    }

    private function denyUnlessSuperAdmin(Request $request)
    {
        $user = $request->user();
        $role = strtolower(str_replace([' ', '_', '-'], '', (string) ($user->role ?? '')));

        if (!$user || $user instanceof \App\Models\Client || $role !== 'superadmin') {
            return response()->json(['message' => 'Only a superadmin can manage departments.'], 403);
        }

        return null;
    }
}
