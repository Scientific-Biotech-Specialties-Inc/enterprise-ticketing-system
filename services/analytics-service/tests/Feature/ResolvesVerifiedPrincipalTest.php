<?php

namespace Tests\Feature;

use App\Http\Controllers\Concerns\ResolvesVerifiedPrincipal;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Ticketing\Auth\Dto\AuthenticatedUserDto;
use Tests\TestCase;

/**
 * Spec 0034: the analytics copy of the helper that turns the verified user into an id, type and role,
 * and finds the caller's token to pass on to other services.
 */
class ResolvesVerifiedPrincipalTest extends TestCase
{
    private function subject(): object
    {
        return new class {
            use ResolvesVerifiedPrincipal;

            public function principal(Request $request): ?array
            {
                return $this->verifiedPrincipal($request);
            }

            public function token(Request $request): ?string
            {
                return $this->callerToken($request);
            }
        };
    }

    private function requestFor(?object $user, array $headers = [], array $cookies = []): Request
    {
        $request = Request::create('/x', 'GET', [], $cookies);
        foreach ($headers as $name => $value) {
            $request->headers->set($name, $value);
        }
        $request->setUserResolver(fn () => $user);
        Auth::forgetGuards();

        return $request;
    }

    public function test_staff_and_customer_are_told_apart_by_emp_id(): void
    {
        $staff = $this->subject()->principal($this->requestFor(new AuthenticatedUserDto(['emp_id' => 3, 'role' => 'admin'])));
        $customer = $this->subject()->principal($this->requestFor(new AuthenticatedUserDto(['client_ID' => 9001, 'role' => 'customer'])));

        $this->assertSame(['id' => 3, 'type' => 'staff', 'role' => 'admin'], $staff);
        $this->assertSame('customer', $customer['type']);
        $this->assertSame(9001, $customer['id']);
    }

    public function test_nobody_signed_in_or_no_usable_id_gives_no_principal(): void
    {
        $this->assertNull($this->subject()->principal($this->requestFor(null)));
        $this->assertNull($this->subject()->principal($this->requestFor((object) ['name' => 'Ghost'])));
    }

    public function test_identity_headers_never_change_the_principal(): void
    {
        $principal = $this->subject()->principal($this->requestFor(
            new AuthenticatedUserDto(['client_ID' => 9001]),
            ['X-User-Id' => '1', 'X-User-Role' => 'admin']
        ));

        $this->assertSame('customer', $principal['type']);
        $this->assertSame(9001, $principal['id']);
    }

    public function test_the_callers_bearer_token_is_found(): void
    {
        $token = $this->subject()->token($this->requestFor(null, ['Authorization' => 'Bearer abc.def.ghi']));

        $this->assertSame('abc.def.ghi', $token);
    }

    public function test_the_access_token_cookie_is_used_when_there_is_no_bearer_header(): void
    {
        $token = $this->subject()->token($this->requestFor(null, [], ['access_token' => 'cookie-token']));

        $this->assertSame('cookie-token', $token);
    }

    public function test_no_token_gives_null(): void
    {
        $this->assertNull($this->subject()->token($this->requestFor(null)));
    }
}
