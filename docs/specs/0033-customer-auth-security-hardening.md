# 0033. Customer authentication security and token hardening

**Date**: 2026-11-06
**Status**: Accepted
**Mode**: ENHANCEMENT
**Related**: 0021 (security hardening), 0032 (customer, CSR, and employee defect remediation)

## Summary

This decision hardens customer authentication and token protection across the system. We hide internal login security counters from public profile responses, restrict the refresh token cookie path so it does not leak across the domain, and add reuse detection to revoke active sessions if a rotated refresh token is replayed. These adjustments close client side exposure gaps without breaking existing login or ticket workflows.

## Context

During a browser security review of the customer portal, inspection revealed two sensitive exposures. First, the customer model serialized its full credential relationship into public responses, causing internal metrics like failed login count and lockout timestamps to persist in browser local storage. Second, the refresh token cookie was issued with root path, allowing the credential to broadcast on every HTTP call to the domain, including static file transfers and employee portal routes.

While passwords remain properly hashed and protected from network eavesdropping through asymmetric RSA payloads, exposed counters give attackers telemetry during brute force attempts. In addition, if an attacker intercepts a rotated refresh token, the current service rejects the stale token with a 401 response without revoking active sessions. We need a clear defense in depth update that isolates credentials, prevents cross path cookie leakage, and detects token theft through family rotation.

## Requirements

**User stories**:
* As a customer, I want my session tokens and internal security counters protected from browser leakage so that my account cannot be hijacked or analyzed by malicious scripts.
* As a security engineer, I want the customer service to invalidate all active sessions when a rotated refresh token is reused so that token theft is immediately contained.

**Acceptance criteria**:
* **AC-1**: The customer profile response and customer model serialization must never include the credential relation, ensuring failed login count, lockout timestamp, and credential metadata never land in browser local storage or session storage.
* **AC-2**: The refresh token cookie must be scoped exclusively to `/api/ticketing/customer`, preventing transmission to static attachment endpoints, WebSocket proxies, or the staff portal.
* **AC-3**: The refresh token database schema must track revocation status using an `is_revoked` boolean column.
* **AC-4**: When a refresh token exchange occurs, the old token must be marked as revoked while the new token is issued with rotation.
* **AC-5**: If any request submits an already revoked refresh token, the service must detect reuse, purge all active refresh tokens and access tokens for that customer, dispatch a security alert, and reject the request with a 401 response.
* **AC-6**: When a customer logs out, their refresh token record must be deleted and the refresh cookie must be cleared using the restricted path.

## Options considered

### Option 1: Full token hardening with revocation tracking and scoped cookie (Recommended)
Add `credential` to the `$hidden` list on the Client model, restrict the refresh cookie path to `/api/ticketing/customer`, and add an `is_revoked` boolean column to the `refresh_tokens` table for automatic reuse detection.

**Pros**:
* Eliminates internal counter exposure from browser storage immediately with one configuration.
* Scopes the cookie strictly to the customer API namespace.
* Detects token compromise according to modern OAuth security practices and terminates breached sessions.

**Cons**:
* Requires a database migration to add `is_revoked` to `refresh_tokens`.

### Option 2: Frontend filtering and root path cookie
Filter the credential object inside frontend state management before writing to local storage, keeping backend token rotation unchanged.

**Pros**:
* Requires no backend migrations.

**Cons**:
* Fails open if another consumer calls the API directly.
* Leaves cookie path broad across the whole domain.
* Ignores token theft scenarios where stolen tokens are replayed.

## Decision

**Chosen option**: Option 1: Full token hardening with revocation tracking and scoped cookie.

We apply defense in depth by hiding the credential relationship on the backend model, scoping the refresh cookie to the customer API prefix, and revoking all customer sessions upon replaying an invalidated refresh token.

**Implementation skills**: `laravel-microservice` (`.agents/skills/laravel-microservice/`), `security-audit` (`.agents/skills/security-audit/`), `react-frontend` (`.agents/skills/react-frontend/`)

## Rationale

Restricting the cookie path to `/api/ticketing/customer` ensures the browser only sends credentials where they belong. The Nginx reverse proxy routes all customer API calls through this prefix, keeping tickets, static assets, and employee routes free of redundant cookie overhead. Hiding the `credential` relationship at the Eloquent model layer guarantees that neither current nor future endpoints accidentally leak brute force indicators. Tracking token revocation gives the system active intrusion detection, converting passive token rotation into active breach containment.

## Enhancement design

### Data model changes

Table: `refresh_tokens`

| Field | Type | Modifiers | Purpose |
|---|---|---|---|
| id | bigint unsigned | primary key, auto increment | Record identifier |
| client_id | bigint unsigned | nullable, indexed, foreign key | Owning customer |
| employee_id | bigint unsigned | nullable, indexed | Owning employee |
| token_hash | string(64) | indexed | SHA256 digest of refresh token |
| is_revoked | boolean | default false, indexed | Flag indicating token rotation or invalidation |
| expires_at | timestamp | nullable | Token lifespan expiration |
| created_at | timestamp | nullable | Creation date |
| updated_at | timestamp | nullable | Last modified date |

### API and cookie contract

| Endpoint | Method | Cookie handling | Expected response | Security rule |
|---|---|---|---|---|
| `/api/ticketing/customer/login` | POST | Sets `refresh_token` cookie with path `/api/ticketing/customer`, `HttpOnly`, `SameSite=Lax`, `Secure` (in production) | 200 OK with access token and user profile without credential object | Clears failed login counter, creates active refresh token |
| `/api/ticketing/customer/auth/refresh` | POST | Reads `refresh_token` from restricted cookie path, issues new cookie | 200 OK with new access token and user profile | Marks old token `is_revoked=true`, creates new token. If presented token is already revoked, purges all tokens for client and returns 401 |
| `/api/ticketing/customer/logout` | POST | Clears `refresh_token` cookie using path `/api/ticketing/customer` | 200 OK | Purges all refresh tokens and Passport tokens for the user |

## Build plan

### Slice 1: Model hygiene and data isolation (satisfies AC-1)
* Add `credential` to the `$hidden` array on `Client.php` in customer service.
* Verify `/me` and `/login` payloads no longer serialize `credential`, `failed_login_count`, or `locked_until`.
* Verify frontend `AuthContext.jsx` continues to normalize user display fields without breaking profile rendering.

### Slice 2: Cookie scoping and logout synchronization (satisfies AC-2, AC-6)
* Update `AuthController.php` in customer service to set `path = '/api/ticketing/customer'` when issuing the `refresh_token` cookie.
* Update `cookie()->forget('refresh_token', '/api/ticketing/customer')` on logout to mirror the identical path.
* Ensure Axios refresh requests in `refreshSession.js` continue sending credentials to `/api/ticketing/customer/auth/refresh`.

### Slice 3: Refresh token schema migration and reuse detection (satisfies AC-3, AC-4, AC-5)
* Create migration in `customer-service` adding `is_revoked` boolean column (default false) to `refresh_tokens`.
* Update `AuthService::loginCustomer` to initialize `is_revoked = false`.
* Update `AuthController::refresh` to check if `$rt->is_revoked` is true. If true, execute breach response: purge all client refresh tokens, purge all Passport client tokens, dispatch security alert, and return 401.
* If valid, mark current token `$rt->update(['is_revoked' => true])` and create new child token with `is_revoked = false`.

## Critical test scenarios

* **Scenario 1 (Profile Hygiene)**: Authenticate as customer, inspect network response for `/login` and browser `localStorage.getItem('user')`. Confirm no `credential` property exists.
* **Scenario 2 (Cookie Transmission Scope)**: Inspect request headers on `/storage/...` and `/ticketing/...`. Confirm `refresh_token` cookie is absent. Inspect `/api/ticketing/customer/auth/refresh` and confirm cookie is present.
* **Scenario 3 (Normal Refresh)**: Call `/api/ticketing/customer/auth/refresh`. Confirm new token received, cookie replaced, and database contains one revoked token and one active token.
* **Scenario 4 (Reuse Detection and Session Invalidation)**: Replay the revoked refresh token from Scenario 3. Confirm endpoint returns 401, all remaining refresh tokens for that customer in the database are purged, and subsequent requests with previously valid access tokens are rejected.

## Migration plan

**Strategy**: Safe schema expansion with backward compatible defaults.
**Phases**:
1. Run database migration in `customer-service` to add `is_revoked` column with default value `false`.
2. Deploy backend service update with model hidden fields, cookie path restriction, and reuse detection logic.
3. No data backfill needed; existing tokens default to `is_revoked = false` and transition to revoked upon their next rotation.
**Rollback**: Drop `is_revoked` column and revert `AuthController.php` changes.
**Risks**: Users with active sessions during the deployment will have their next refresh cookie scoped to the new path seamlessly without requiring re-login.

## Consequences

* Customer sensitive security telemetry is permanently secluded on the server side.
* Attackers cannot inspect lockout thresholds or login attempt counters in browser storage.
* Stolen refresh tokens cannot be silently rotated without triggering automated account isolation.
* Cookie bandwidth overhead is eliminated from non customer microservice calls.

## Follow up

* Review whether the employee portal and central single sign on module need identical refresh token reuse detection.
* Monitor Redis security alert logs after rollout to verify no false positive reuse triggers occur from rapid concurrent tab openings.
