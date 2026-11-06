<?php

namespace Tests\Feature;

use App\Http\Controllers\Concerns\ResolvesVerifiedPrincipal;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Ticketing\Auth\Dto\AuthenticatedUserDto;
use Tests\TestCase;

/**
 * Spec 0034: the one place that turns the verified user into an id, a type (customer or staff) and a role.
 */
class ResolvesVerifiedPrincipalTest extends TestCase
{
    private function resolve(?object $user, array $headers = [], array $body = []): ?array
    {
        $request = Request::create('/x', 'POST', $body);
        foreach ($headers as $name => $value) {
            $request->headers->set($name, $value);
        }
        $request->setUserResolver(fn () => $user);
        Auth::forgetGuards();

        $subject = new class {
            use ResolvesVerifiedPrincipal;

            public function run(Request $request): ?array
            {
                return $this->verifiedPrincipal($request);
            }
        };

        return $subject->run($request);
    }

    public function test_a_user_with_an_emp_id_is_staff_with_their_role(): void
    {
        $principal = $this->resolve(new AuthenticatedUserDto(['emp_id' => 77, 'role' => 'cs']));

        $this->assertSame(['id' => 77, 'type' => 'staff', 'role' => 'cs'], $principal);
    }

    public function test_a_user_without_an_emp_id_is_a_customer_identified_by_client_id(): void
    {
        $principal = $this->resolve(new AuthenticatedUserDto(['client_ID' => 9001, 'role' => 'customer']));

        $this->assertSame('customer', $principal['type']);
        $this->assertSame(9001, $principal['id']);
    }

    public function test_a_plain_user_object_with_only_an_id_is_a_customer(): void
    {
        $principal = $this->resolve((object) ['id' => 12]);

        $this->assertSame('customer', $principal['type']);
        $this->assertSame(12, $principal['id']);
        $this->assertSame('customer', $principal['role']);
    }

    public function test_an_emp_id_of_zero_does_not_make_someone_staff(): void
    {
        $principal = $this->resolve((object) ['emp_id' => 0, 'id' => 12]);

        $this->assertSame('customer', $principal['type']);
    }

    public function test_nobody_signed_in_gives_no_principal(): void
    {
        $this->assertNull($this->resolve(null));
    }

    public function test_a_user_with_no_usable_id_gives_no_principal(): void
    {
        $this->assertNull($this->resolve((object) ['name' => 'Ghost']));
    }

    public function test_identity_headers_and_body_ids_never_change_the_principal(): void
    {
        $principal = $this->resolve(
            new AuthenticatedUserDto(['client_ID' => 9001, 'role' => 'customer']),
            ['X-User-Id' => '1', 'X-User-Role' => 'admin', 'X-Client-Id' => '1'],
            ['user_id' => 1, 'client_id' => 1, 'emp_id' => 1, 'user_role' => 'admin']
        );

        $this->assertSame('customer', $principal['type']);
        $this->assertSame(9001, $principal['id']);
        $this->assertSame('customer', $principal['role']);
    }

    public function test_the_shared_user_object_satisfies_the_laravel_11_contract(): void
    {
        $user = new AuthenticatedUserDto(['emp_id' => 5]);

        $this->assertSame('password', $user->getAuthPasswordName());
        $this->assertSame('', $user->getAuthPassword());
        $this->assertSame(5, $user->getAuthIdentifier());
    }
}
