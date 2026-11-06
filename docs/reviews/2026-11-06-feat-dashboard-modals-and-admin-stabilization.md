# Review, feat/dashboard-modals-and-admin-stabilization, 2026-11-06

**Reviewed by**: Anthropic Claude 3.5 Sonnet (author on Gemini 2.0 Flash)
**Scope**: 174 files, branch vs base dev (merge base 1a0314e) plus uncommitted working tree changes
**Verdict**: Changes requested

## Summary
This branch delivers extensive operational enhancements across the platform, including customer authentication security hardening (spec 0033), defect remediation across CSR, customer, and employee flows (spec 0032), admin metrics accuracy, live manager queues, and dashboard modal stabilization (spec 0031). The core security hardening in customer service is robust and well tested, effectively hiding internal brute force telemetry from client responses and establishing active refresh token reuse detection. However, changes are requested to address two major functional issues: route level middleware blocking logout when thirty minute access tokens expire, and overly restrictive query filtering in employee reassignment that hides pending requests from branch customer service representatives.

## Major
### 🟠 Route middleware blocks logout and cookie invalidation upon token expiry, `services/customer-service/routes/api.php:30`
**Problem**: The `/logout` route is declared inside the `auth.subsystem` middleware group. Following spec 0032 defect 1a, personal access tokens now expire after thirty minutes. When a user whose access token has expired clicks logout, `AuthenticateSubsystem` rejects the request with a 401 unauthenticated response before `AuthController::logout()` can run.
**Why it matters**: Because the controller method is aborted before execution, the backend never purges the refresh token record from the database and never sets the Set Cookie expiration header for `refresh_token`. While the React frontend clears its local memory state, the active refresh token remains valid in the database and the restricted cookie remains in the browser. Any subsequent page refresh or script can silently exchange that cookie via `/auth/refresh` to restore the authenticated session, violating logout security expectations.
**Suggested fix**: Move `/logout` outside the mandatory `auth.subsystem` middleware group or permit unauthenticated requests to reach `AuthController::logout()`, allowing the method to read the `refresh_token` cookie, delete the matching database record, and consistently dispatch the expired cookie headers.

### 🟠 Pending reassignment query filters out requests when original delegator is absent or non customer service, `services/employee-service/app/Services/EmployeeReassignmentService.php:537`
**Problem**: When an engineer submits a reassignment request, notification routing properly falls back to alerting customer service representatives in the engineer branch if the original delegator (`assigned_by`) is unknown or no longer holds a customer service position. In contrast, `listRequests()` filters pending items strictly using `ta.assigned_by = $csId`. If a ticket was assigned by an administrator, assigned through automation, or delegated by a representative who is no longer active, the branch representative who receives the notification cannot see the item in their pending queue.
**Why it matters**: Customer service representatives receive notification alerts instructing them to action a reassignment request, but navigating to their reassignment queue reveals zero pending tickets. The reassignment request becomes permanently stalled in pending status with no representative able to approve or reject it.
**Suggested fix**: Update the pending query condition in `listRequests()` so that pending requests also match tickets belonging to the representative branch whenever the original delegator is null or not an active customer service staff member, aligning queue visibility directly with notification fallback routing.

## Minor
### 🟡 Refresh token rotation updates lack database transaction encapsulation, `services/customer-service/app/Http/Controllers/AuthController.php:419`
**Problem**: In `AuthController::refresh()`, marking the existing refresh token revoked (`$rt->update(['is_revoked' => true])`), generating the Passport access token, and creating the child refresh token record (`RefreshToken::create(...)`) execute sequentially without a wrapping database transaction.
**Why it matters**: If a database connection error occurs after revoking the existing record but before creating the replacement token, the old token remains revoked while no replacement exists. On the user next refresh attempt, the client presents the revoked token, which triggers a false positive token reuse breach and purges all active sessions for the customer.
**Suggested fix**: Enclose the revocation update and replacement token creation within a `DB::transaction()` block to guarantee atomic token rotation.

### 🟡 Refresh token cookie path is unconditionally hard coded to customer API prefix, `services/customer-service/app/Http/Controllers/AuthController.php:150`
**Problem**: `AuthController::login()` contains logic supporting employee credentials, but line 150 unconditionally sets `$cookiePath = '/api/ticketing/customer'`.
**Why it matters**: Although the web frontend directs employees to the central single sign on gateway, any employee authenticating directly through this controller will receive a cookie scoped strictly to `/api/ticketing/customer`, preventing transmission to staff API endpoints.
**Suggested fix**: Dynamically set `$cookiePath` based on whether the authenticated model is an Employee or Client, or guard the controller endpoint to reject non client credentials.

### 🟡 Missing scheduled maintenance task to prune expired refresh tokens, `services/customer-service/app/Console/Kernel.php:13`
**Problem**: Family token rotation retains revoked and expired rows in `refresh_tokens` for reuse detection, but customer service currently has no scheduled console task to clean up expired entries.
**Why it matters**: In high traffic environments, expired token records will accumulate indefinitely, leading to unnecessary storage growth and index degradation on the `token_hash` column.
**Suggested fix**: Create an Artisan command that deletes records where `expires_at < now()`, scheduled to run daily in `Kernel.php`.

## Nits
- ⚪ `services/customer-service/app/Models/ClientCredential.php:27`, internal lockout counters `failed_login_count` and `locked_until` are not listed in `$hidden` on the credential model itself, relying solely on `Client.php` relation hiding.
- ⚪ `frontend/web/src/components/CSModals.jsx:2067`, ticket resolution error handling uses synchronous browser `window.alert()` instead of an inline alert banner or toast notification consistent with the ONE UI design system.

## Strengths
- Rigorous security hardening implementation for AC-1 through AC-6 in customer service, successfully hiding internal brute force telemetry from client responses, scoping refresh cookies to the customer namespace, and implementing active token family reuse detection.
- Excellent, comprehensive test suite in `CustomerAuthSecurityHardeningTest.php` with 10 feature tests and 43 assertions verifying model serialization hiding, cookie path boundaries, schema tracking, token rotation, reuse detection breach containment, and logout cookie expiration.
- Clean and safe email deferral in `EmployeeAssignmentService::sendCustomerEmailAfterResponse()` using `app()->terminating()`, preventing slow third party mail handlers from delaying database transactions or triggering HTTP 504 gateway timeouts.
- Direct remediation of the AI service fatal error by removing the syntax defect in `RagService.php`, and clean state machine bridge logic in `CSModals.jsx` that smoothly resumes on hold tickets before resolution.

## Test coverage
- Automated test coverage in `services/customer-service` is excellent: all 21 tests pass with 108 assertions, including full coverage of the new security hardening logic in `CustomerAuthSecurityHardeningTest.php`.
- Frontend test suite in `frontend/web` remains fully green across 38 test files and 243 assertions.
- Ticket action unit tests in `ticket-service` pass cleanly (13 tests, 65 assertions).
- Notable test gaps: No automated feature tests currently exist in `employee-service` verifying the delegator and branch fallback reassignment routing, and `ticket-service` lacks a dedicated unit assertion confirming HTML tag stripping on ticket update descriptions.
