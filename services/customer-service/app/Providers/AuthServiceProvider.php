<?php

namespace App\Providers;

// use Illuminate\Support\Facades\Gate;
use Illuminate\Foundation\Support\Providers\AuthServiceProvider as ServiceProvider;
use Illuminate\Support\Facades\Auth;
use Illuminate\Auth\EloquentUserProvider;
use App\Auth\PolymorphicUserProvider;
use Laravel\Passport\Passport;

class AuthServiceProvider extends ServiceProvider
{
    /**
     * The model to policy mappings for the application.
     *
     * @var array<class-string, class-string>
     */
    protected $policies = [
        //
    ];

    /**
     * Register any authentication / authorization services.
     */
    public function boot(): void
    {
        Auth::provider('polymorphic', function ($app, array $config) {
            $hasher = $app->make('hash');
            $employeeProvider = new EloquentUserProvider($hasher, $config['employee_model']);
            $clientProvider = new EloquentUserProvider($hasher, $config['client_model']);
            return new PolymorphicUserProvider($employeeProvider, $clientProvider);
        });

        Passport::ignoreRoutes();
        Passport::personalAccessClient((string) env('PASSPORT_PERSONAL_ACCESS_CLIENT_ID', 1));

        // Without an explicit lifetime Passport issues personal access tokens valid for a year.
        // Keep access tokens short lived; the httpOnly refresh cookie (14 days) renews them.
        Passport::personalAccessTokensExpireIn(
            now()->addMinutes((int) env('PASSPORT_ACCESS_TOKEN_TTL_MINUTES', 30))
        );
    }
}
