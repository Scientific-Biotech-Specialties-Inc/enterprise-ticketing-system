<?php

namespace Tests\Unit;

use App\Auth\PolymorphicUserProvider;
use App\Models\Client;
use Illuminate\Auth\EloquentUserProvider;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Contracts\Auth\UserProvider;
use Mockery;
use Tests\TestCase;

/**
 * Laravel 11 requires every user provider to implement rehashPasswordIfRequired. Without it this class
 * cannot even be loaded, and every request that touches the auth guard (including the spec 0034
 * config.access middleware) fails with a fatal error.
 */
class PolymorphicUserProviderTest extends TestCase
{
    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    private function makeProvider(&$employee, &$client): PolymorphicUserProvider
    {
        $employee = Mockery::mock(EloquentUserProvider::class);
        $client = Mockery::mock(EloquentUserProvider::class);

        return new PolymorphicUserProvider($employee, $client);
    }

    public function test_it_loads_and_satisfies_the_user_provider_contract(): void
    {
        $provider = $this->makeProvider($employee, $client);

        $this->assertInstanceOf(UserProvider::class, $provider);
        $this->assertTrue(method_exists($provider, 'rehashPasswordIfRequired'));
    }

    public function test_rehash_for_an_employee_goes_to_the_employee_provider_only(): void
    {
        $provider = $this->makeProvider($employee, $client);
        $user = Mockery::mock(Authenticatable::class);

        $employee->shouldReceive('rehashPasswordIfRequired')->once()->with($user, ['password' => 'x'], false);
        $client->shouldNotReceive('rehashPasswordIfRequired');

        $provider->rehashPasswordIfRequired($user, ['password' => 'x']);
        $this->addToAssertionCount(1);
    }

    public function test_rehash_for_a_client_goes_to_the_client_provider_only_and_keeps_the_force_flag(): void
    {
        $provider = $this->makeProvider($employee, $client);
        $user = Mockery::mock(Client::class, Authenticatable::class);

        $client->shouldReceive('rehashPasswordIfRequired')->once()->with($user, ['password' => 'x'], true);
        $employee->shouldNotReceive('rehashPasswordIfRequired');

        $provider->rehashPasswordIfRequired($user, ['password' => 'x'], true);
        $this->addToAssertionCount(1);
    }

    public function test_credentials_are_checked_by_the_provider_that_matches_the_user_type(): void
    {
        $provider = $this->makeProvider($employee, $client);
        $clientUser = Mockery::mock(Client::class, Authenticatable::class);
        $employeeUser = Mockery::mock(Authenticatable::class);

        $client->shouldReceive('validateCredentials')->once()->with($clientUser, ['password' => 'a'])->andReturn(true);
        $employee->shouldReceive('validateCredentials')->once()->with($employeeUser, ['password' => 'b'])->andReturn(false);

        $this->assertTrue($provider->validateCredentials($clientUser, ['password' => 'a']));
        $this->assertFalse($provider->validateCredentials($employeeUser, ['password' => 'b']));
    }
}
