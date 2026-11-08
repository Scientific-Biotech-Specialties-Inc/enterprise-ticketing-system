<?php

namespace App\Auth;

use Illuminate\Contracts\Auth\UserProvider;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Auth\EloquentUserProvider;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;

class PolymorphicUserProvider implements UserProvider
{
    protected $employeeProvider;
    protected $clientProvider;

    public function __construct(EloquentUserProvider $employeeProvider, EloquentUserProvider $clientProvider)
    {
        $this->employeeProvider = $employeeProvider;
        $this->clientProvider = $clientProvider;
    }

    protected function getTargetProvider()
    {
        $bearerToken = request()->bearerToken();
        if ($bearerToken) {
            $parts = explode('.', $bearerToken);
            if (count($parts) === 3) {
                $payload = json_decode(base64_decode($parts[1]), true);
                $tokenId = $payload['jti'] ?? null;
                if ($tokenId) {
                    $tokenName = Cache::remember("oauth_token_name_{$tokenId}", 300, function () use ($tokenId) {
                        return DB::table('oauth_access_tokens')->where('id', $tokenId)->value('name') ?? 'employee';
                    });
                    if ($tokenName === 'client') {
                        return $this->clientProvider;
                    }
                }
            }
        }
        return $this->employeeProvider;
    }

    public function retrieveById($identifier)
    {
        $bearerToken = request()->bearerToken();
        if ($bearerToken) {
            $parts = explode('.', $bearerToken);
            if (count($parts) === 3) {
                $payload = json_decode(base64_decode($parts[1]), true);
                $tokenId = $payload['jti'] ?? null;
                if ($tokenId) {
                    $tokenName = Cache::remember("oauth_token_name_{$tokenId}", 300, function () use ($tokenId) {
                        return DB::table('oauth_access_tokens')->where('id', $tokenId)->value('name') ?? 'employee';
                    });
                    if ($tokenName === 'client') {
                        return $this->clientProvider->retrieveById($identifier);
                    } else {
                        return $this->employeeProvider->retrieveById($identifier);
                    }
                }
            }
        }

        return $this->employeeProvider->retrieveById($identifier) 
            ?: $this->clientProvider->retrieveById($identifier);
    }

    public function retrieveByToken($identifier, $token)
    {
        return $this->getTargetProvider()->retrieveByToken($identifier, $token);
    }

    public function updateRememberToken(Authenticatable $user, $token)
    {
        $provider = $user instanceof \App\Models\Client ? $this->clientProvider : $this->employeeProvider;
        $provider->updateRememberToken($user, $token);
    }

    public function retrieveByCredentials(array $credentials)
    {
        return $this->employeeProvider->retrieveByCredentials($credentials)
            ?: $this->clientProvider->retrieveByCredentials($credentials);
    }

    public function validateCredentials(Authenticatable $user, array $credentials)
    {
        $provider = $user instanceof \App\Models\Client ? $this->clientProvider : $this->employeeProvider;
        return $provider->validateCredentials($user, $credentials);
    }

    /**
     * Required by Laravel 11.x's UserProvider contract. Without it this class cannot load and any
     * request that touches the auth guard fails with a fatal error.
     */
    public function rehashPasswordIfRequired(Authenticatable $user, array $credentials, bool $force = false)
    {
        $provider = $user instanceof \App\Models\Client ? $this->clientProvider : $this->employeeProvider;
        if (method_exists($provider, 'rehashPasswordIfRequired')) {
            $provider->rehashPasswordIfRequired($user, $credentials, $force);
        }
    }
}
