<?php

namespace Ticketing\Auth\Dto;

use Illuminate\Contracts\Auth\Authenticatable;

class AuthenticatedUserDto implements Authenticatable, \ArrayAccess, \JsonSerializable
{
    public ?int $emp_id = null;
    public ?int $id = null;
    public ?int $client_ID = null;
    public ?int $client_id = null;
    public ?string $email = null;
    public ?string $first_name = null;
    public ?string $last_name = null;
    public ?string $name = null;
    public ?string $role = null;
    public ?string $department = null;
    public ?string $branch = null;
    public ?int $branch_id = null;
    public ?string $phone_number = null;
    public bool $is_active = true;
    public ?string $jti = null;
    public ?int $exp = null;
    public array $attributes = [];

    public function __construct(array $attributes = [])
    {
        $this->attributes = $attributes;
        $this->emp_id = isset($attributes['emp_id']) ? (int) $attributes['emp_id'] : null;
        $this->id = isset($attributes['id']) ? (int) $attributes['id'] : $this->emp_id;
        $this->client_ID = isset($attributes['client_ID']) ? (int) $attributes['client_ID'] : null;
        $this->client_id = isset($attributes['client_id']) ? (int) $attributes['client_id'] : $this->client_ID;
        $this->email = $attributes['email'] ?? null;
        $this->first_name = $attributes['first_name'] ?? null;
        $this->last_name = $attributes['last_name'] ?? null;
        $this->name = $attributes['name'] ?? trim(($this->first_name ?? '') . ' ' . ($this->last_name ?? ''));
        $this->role = $attributes['role'] ?? 'service';
        $this->department = $attributes['department'] ?? null;
        $this->branch = $attributes['branch'] ?? null;
        $this->branch_id = isset($attributes['branch_id']) && is_numeric($attributes['branch_id']) ? (int) $attributes['branch_id'] : null;
        $this->phone_number = $attributes['phone_number'] ?? null;
        $this->is_active = isset($attributes['is_active']) ? (bool) $attributes['is_active'] : true;
        $this->jti = $attributes['jti'] ?? null;
        $this->exp = isset($attributes['exp']) ? (int) $attributes['exp'] : null;

        if (!$this->id && $this->client_id) {
            $this->id = $this->client_id;
        }
    }

    public function __get($key)
    {
        return $this->$key ?? $this->attributes[$key] ?? null;
    }

    public function __set($key, $value)
    {
        $this->$key = $value;
        $this->attributes[$key] = $value;
    }

    public function __isset($key)
    {
        return isset($this->$key) || isset($this->attributes[$key]);
    }

    public function toArray(): array
    {
        return array_merge($this->attributes, [
            'emp_id' => $this->emp_id,
            'id' => $this->id,
            'client_ID' => $this->client_ID,
            'client_id' => $this->client_id,
            'email' => $this->email,
            'first_name' => $this->first_name,
            'last_name' => $this->last_name,
            'name' => $this->name,
            'role' => $this->role,
            'department' => $this->department,
            'branch' => $this->branch,
            'branch_id' => $this->branch_id,
            'phone_number' => $this->phone_number,
            'is_active' => $this->is_active,
            'jti' => $this->jti,
            'exp' => $this->exp,
        ]);
    }

    public function jsonSerialize(): array
    {
        return $this->toArray();
    }

    public function getAuthIdentifierName(): string
    {
        return 'emp_id';
    }

    public function getAuthIdentifier()
    {
        return $this->emp_id ?? $this->id;
    }

    public function getAuthPassword(): string
    {
        return '';
    }

    /** Required by Laravel 11's Authenticatable contract. Harmless on Laravel 10. */
    public function getAuthPasswordName(): string
    {
        return 'password';
    }

    public function getRememberToken(): ?string
    {
        return null;
    }

    public function setRememberToken($value): void {}

    public function getRememberTokenName(): ?string
    {
        return null;
    }

    public function offsetExists($offset): bool
    {
        return isset($this->$offset) || isset($this->attributes[$offset]);
    }

    public function offsetGet($offset)
    {
        return $this->__get($offset);
    }

    public function offsetSet($offset, $value): void
    {
        $this->__set($offset, $value);
    }

    public function offsetUnset($offset): void
    {
        unset($this->attributes[$offset]);
    }
}

