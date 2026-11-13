<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * The single employee directory sync from the central auth module into ticket-service `employees` (spec 0031 AC-13).
 *
 * Runs from the scheduler every minute (`employees:sync-directory`). Request paths must not call the auth
 * module synchronously; the only request path callers left (assignable and eligible employee lookups)
 * go through sync() and are throttled by the same 60 s lock.
 */
class EmployeeDirectorySyncService
{
    public const LOCK_KEY = 'employees_synced_lock';

    /** Demo seeder accounts that must not stay active once real synced employees exist. */
    private const SEEDER_EMAILS = [
        'cs@gmail.com',
        'headofcs@gmail.com',
        'employee@gmail.com',
        'tech1@example.com',
        'slosinada@gmail.com',
    ];

    /** Roles requested from the auth module; Admin accounts are not part of this list. */
    private const SYNCED_ROLES = 'Engineer,Manager,Employee,Supervisor';

    /**
     * Sync unless another sync ran in the last 60 s. Pass $force to ignore the lock (the scheduled command does).
     *
     * @return array{status: string, synced: int, deactivated: int}
     */
    public function sync(bool $force = false): array
    {
        if (!$force && Cache::has(self::LOCK_KEY)) {
            return ['status' => 'skipped', 'synced' => 0, 'deactivated' => 0];
        }
        Cache::put(self::LOCK_KEY, true, 60);

        $this->deactivateSeederAccounts();

        if (app()->environment('testing') && !$force) {
            return ['status' => 'skipped', 'synced' => 0, 'deactivated' => 0];
        }

        try {
            $authUrl = rtrim((string) env('AUTH_SERVICE_INTERNAL_URL', 'http://auth-service:8000'), '/');
            $secret = (string) env('CMS_INTERNAL_SECRET', 'cms-internal-secret-key-2026');

            $resp = Http::timeout(5)
                ->withHeaders(['X-Internal-Secret' => $secret])
                ->get("{$authUrl}/api/internal/users-by-roles", ['roles' => self::SYNCED_ROLES]);

            if (!$resp->successful()) {
                Log::warning('EmployeeDirectorySyncService: auth module answered HTTP ' . $resp->status());
                return ['status' => 'failed', 'synced' => 0, 'deactivated' => 0];
            }

            $authUsers = $resp->json('data') ?? [];
            if (empty($authUsers)) {
                return ['status' => 'empty', 'synced' => 0, 'deactivated' => 0];
            }

            $authEmails = [];
            foreach ($authUsers as $u) {
                $email = strtolower(trim((string) ($u['email'] ?? '')));
                if ($email === '') {
                    continue;
                }
                $authEmails[] = $email;
                $this->upsertEmployee($email, $u);
            }

            // Staff who left the auth directory are deactivated. Admin rows are never part of the
            // requested role list, so they are left alone.
            $deactivated = DB::table('employees')
                ->whereNotIn(DB::raw('LOWER(email)'), $authEmails)
                ->whereRaw("LOWER(COALESCE(position_level, '')) <> 'admin'")
                ->whereRaw("LOWER(COALESCE(role, '')) NOT IN ('admin', 'superadmin', 'super admin', 'it admin')")
                ->where('is_active', 1)
                ->update(['is_active' => 0]);

            Cache::forget('department_managers:cache');

            return ['status' => 'ok', 'synced' => count($authEmails), 'deactivated' => $deactivated];
        } catch (\Throwable $e) {
            Log::warning('EmployeeDirectorySyncService: sync failed: ' . $e->getMessage());
            return ['status' => 'failed', 'synced' => 0, 'deactivated' => 0];
        }
    }

    /**
     * Map an auth role and department to ticket-service position_level, role and technical_role.
     *
     * @return array{position_level: string, role: string, technical_role: string}
     */
    public static function mapRole(string $roleName, string $dept): array
    {
        $isManager = stripos($roleName, 'manager') !== false;
        $isAdmin = stripos($roleName, 'admin') !== false;
        $isEngineer = stripos($roleName, 'engineer') !== false || stripos($roleName, 'supervisor') !== false;

        if ($isAdmin) {
            return ['position_level' => 'Admin', 'role' => 'admin', 'technical_role' => $roleName];
        }
        if ($isManager) {
            return [
                'position_level' => 'Manager',
                'role' => strcasecmp($dept, 'Customer Service') === 0 ? 'customer service' : 'service',
                'technical_role' => $dept . ' Manager',
            ];
        }
        if ($isEngineer || strcasecmp($dept, 'Service') === 0) {
            return ['position_level' => 'Engineer', 'role' => 'service', 'technical_role' => 'Engineer'];
        }
        if (strcasecmp($dept, 'Customer Service') === 0) {
            return ['position_level' => 'Employee', 'role' => 'customer service', 'technical_role' => 'Employee'];
        }

        return ['position_level' => 'Employee', 'role' => 'service', 'technical_role' => 'Employee'];
    }

    protected function upsertEmployee(string $email, array $u): void
    {
        $dept = trim((string) ($u['department'] ?? 'Service'));
        $roleName = trim((string) ($u['role'] ?? 'Employee'));
        $mapped = self::mapRole($roleName, $dept);

        [$branchId, $branchName] = $this->resolveBranch($u);

        $firstName = trim((string) ($u['first_name'] ?? ''));
        $lastName = trim((string) ($u['last_name'] ?? ''));

        $existing = DB::table('employees')->whereRaw('LOWER(email) = ?', [$email])->first();

        $payload = [
            'department' => $dept,
            'position_level' => $mapped['position_level'],
            'role' => $mapped['role'],
            'technical_role' => $mapped['technical_role'],
            'branch' => $branchName,
            'branch_id' => $branchId,
            'is_active' => (int) ($u['is_active'] ?? 1),
            'last_synced_at' => now(),
        ];

        if ($existing) {
            $payload['first_name'] = $firstName !== '' ? $firstName : $existing->first_name;
            $payload['last_name'] = $lastName !== '' ? $lastName : $existing->last_name;
            DB::table('employees')->where('emp_id', $existing->emp_id)->update($payload);
            return;
        }

        $newId = (isset($u['id']) && (int) $u['id'] > 0 && !DB::table('employees')->where('emp_id', (int) $u['id'])->exists())
            ? (int) $u['id']
            : ((int) DB::table('employees')->max('emp_id') + 1);

        DB::table('employees')->insert(array_merge($payload, [
            'emp_id' => $newId,
            'email' => $email,
            'phone_number' => $u['phone'] ?? null,
            'password_hash' => '',
            'first_name' => $firstName !== '' ? $firstName : 'Staff',
            'last_name' => $lastName,
            'password_change_at' => now(),
        ]));
    }

    /**
     * Maps the Auth Module branch to the local branch by name (Auth and local ids are numbered
     * independently). Unknown or missing names keep the original default, main branch 1.
     *
     * @return array{0: int, 1: string}
     */
    protected function resolveBranch(array $u): array
    {
        $branchName = trim((string) ($u['branch'] ?? ($u['branch_details']['name'] ?? '')));
        if ($branchName !== '') {
            $local = DB::table('branches')->whereRaw('LOWER(name) = ?', [strtolower($branchName)])->first(['id', 'name']);
            if ($local) {
                return [(int) $local->id, $local->name];
            }
        }

        return [1, 'Main Branch'];
    }

    /**
     * Once real synced employees exist, demo seeder accounts that were never synced are deactivated.
     */
    protected function deactivateSeederAccounts(): void
    {
        try {
            if (DB::table('employees')->whereNotNull('last_synced_at')->exists()) {
                DB::table('employees')
                    ->whereNull('last_synced_at')
                    ->whereIn(DB::raw('LOWER(email)'), self::SEEDER_EMAILS)
                    ->update(['is_active' => false]);
            }
        } catch (\Throwable $e) {
            Log::info('EmployeeDirectorySyncService: seeder deactivation skipped: ' . $e->getMessage());
        }
    }
}
