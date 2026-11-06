<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * Spec 0034: identity comes only from the verified user that AuthenticateSubsystem sets.
 *
 * Never read X-User-*, X-Client-Id headers, or body keys such as user_id / client_id /
 * sender_id to decide who is calling. A principal is staff when the verified user has an
 * emp_id, otherwise a customer.
 */
trait ResolvesVerifiedPrincipal
{
    /**
     * @return array{id:int,type:string,role:string|null}|null  null when nobody is authenticated
     */
    protected function verifiedPrincipal(Request $request): ?array
    {
        $user = $request->user() ?: Auth::user();
        if (!$user) {
            return null;
        }

        $empId = (int) ($user->emp_id ?? 0);
        if ($empId > 0) {
            return ['id' => $empId, 'type' => 'staff', 'role' => $user->role ?? null];
        }

        $customerId = (int) ($user->client_ID ?? $user->client_id ?? $user->id ?? 0);
        if ($customerId <= 0) {
            return null;
        }

        return ['id' => $customerId, 'type' => 'customer', 'role' => $user->role ?? 'customer'];
    }
}
