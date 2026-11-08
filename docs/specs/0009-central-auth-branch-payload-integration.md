# 0009. Central Auth Branch Payload Integration and Nullability Governance

**Date**: 2026-10-25
**Status**: Implemented

## Summary

This specification integrates branch data from the central authentication service into the enterprise ticketing system. It allows administrators and super administrators to have a null branch for system wide scope while requiring assigned branches for new operational staff like service, IT, and customer service. Existing operational users in the database with a null branch remain functional to preserve historical records and backward compatibility. The system fetches live branch options from the authentication service, deactivates obsolete placeholder mock records, and exposes authentic database branches matching the authentication module across the backend and frontend interfaces.

## Context

The enterprise ticketing system functions alongside a centralized authentication module. Previously, the ticketing system relied on hardcoded placeholder branches in the frontend and static database records in the ticket service. The central authentication module now issues user payloads containing branch identifiers, branch names, and facility details.

A clear business rule governs user branch assignments. Global administrators with emails such as admin@example.com and superadmin@example.com oversee the whole hospital group, so their branch assignment may be null. In contrast, operational staff such as service engineers, IT technicians, and customer service representatives belong to specific facilities. While legacy accounts already existing in the database may carry a null branch and must not break, any newly created or provisioned operational account must have a valid branch assignment.

Furthermore, the Super Admin configuration interface at /ticketing/superadmin/config/branch-config must safely render both system wide defaults when no branch is selected and branch specific configurations when a location is chosen. The live branches displayed in the branch configuration selector must originate from the central authentication service database and match the branches visible at /admin/branches (Main Office, North Luzon Hub, Cebu City Office), pruning or deactivating legacy mock branches.

## Requirements

**User stories**:
- As a Super Admin, I want to access the ticketing platform with a null branch so that I can manage system wide configurations across all physical facilities without restriction.
- As a Super Admin configuring branch settings, I want to view and select live branches from the central auth system or view global defaults so that branch policies stay in sync with our corporate locations.
- As a service engineer or IT specialist, I want my ticket permissions and assignments scoped to my assigned branch so that tickets route to the appropriate physical hospital location.
- As the system, I want existing staff with null branches in the database to continue functioning while blocking newly provisioned staff without a branch so that historical data is preserved without compromising future data integrity.

**Acceptance criteria**:
- **AC-1**: When decoding user tokens or verifying sessions, users with role superadmin or admin (including superadmin@example.com and admin@example.com) are permitted to have a null branch or null branch identifier.
- **AC-2**: When auto provisioning or registering new operational employees (roles service, IT, customer service), the payload must provide a valid branch or branch identifier; payloads lacking a branch are rejected with an unprocessable entity error.
- **AC-3**: For existing operational employees already stored in the local database with a null branch, the authentication middleware and directory endpoints permit them to log in and view tickets without throwing errors.
- **AC-4**: The ticket service provides an endpoint (GET /superadmin/branches) that retrieves live branch records (id, name, code, address, active status) originating from the central authentication service, falling back to local database records if the auth service is unavailable.
- **AC-5**: The frontend BranchContext dynamically loads branches from the ticket service API and provides them to BranchSelector and SuperAdminTicketConfig components.
- **AC-6**: The BranchSelector component safely renders when selectedBranch is null, displaying a global system wide scope badge without throwing null reference exceptions.
- **AC-7**: In /ticketing/superadmin/config/branch-config, Super Admin can switch between the global system defaults and any specific branch override matrix.

## Options considered

### Option 1: Hardcode branch assignments and force all users to Main Branch

Assign every incoming user with a null branch to the default Main branch automatically.

**Pros**:
- Simple to implement without changing nullability constraints.

**Cons**:
- Erroneously binds global Super Admins to one facility and prevents multi branch configuration isolation.

### Option 2: Live branch ingestion with differentiated role nullability governance (Chosen)

Accept null branch for Super Admin and Admin, tolerate null branch for grandfathered existing operational records, and enforce branch presence for new operational accounts. Synchronize live branch records from the central auth service to the ticketing backend and frontend.

**Pros**:
- Accurately models real hospital organization hierarchy.
- Protects historical database records while enforcing strict standards on all new accounts.
- Replaces static placeholder mock data with genuine live branch records.

**Cons**:
- Requires validation checks in both token verification middleware and employee directory controllers.

## Decision

**Chosen option**: Option 2: Live branch ingestion with differentiated role nullability governance.

The system will treat branch assignment as optional for administrators and mandatory for new operational employees, while maintaining a safe fallback for legacy records.

## Feature design

**Data model sketch**:
- `branches`: `id` (bigint or int), `slug` (varchar 64, unique), `name` (varchar 255), `code` (varchar 16, nullable), `region` (varchar 100, nullable), `address` (varchar 500, nullable), `is_active` (boolean, default true), `timestamps`.
- `employees`: `emp_id` (bigint), `email` (varchar 255, unique), `first_name` (varchar 100), `last_name` (varchar 100), `role` (varchar 50), `department` (varchar 100), `branch` (varchar 255, nullable), `branch_id` (unsigned bigint, nullable), `last_synced_at` (timestamp, nullable).

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/ticketing/ticket/superadmin/branches | GET | none | branches: array of branch objects | Bearer token (superadmin) | 401, 403 |
| /api/ticketing/ticket/branches | GET | none | branches: array of branch objects | Bearer token | 401 |
| /api/ticketing/employee/profile | GET | none | user profile with branch details | Bearer token | 401, 404 |
| /api/ticketing/ticket/superadmin/branches/{branchId}/categories | GET | branchId: string (slug or id) | categories and SLA policies | Bearer token (superadmin) | 401, 404 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Verify user token | user branch and branch identifier | payload claim branch, branch_id, or branch_details |
| Provision new employee | employee branch column | input token claim; rejected if null for operational role |
| Fetch branch list | branch list in frontend | GET /superadmin/branches via central auth sync or local DB |
| Render branch banner | branch name or global scope label | selectedBranch.name if present, otherwise All Branches Global Scope |

**Key invariants**:
- Users with role superadmin or admin can have branch null.
- New operational employees cannot have branch null.
- Existing operational employees in the local database with branch null must not be rejected during login or directory queries.
- No files within the capstone-auth-module directory may be modified.

**Security model**:
- All branch modification endpoints require superadmin role privileges.
- Inter service communication between the ticketing system and authentication module uses the shared secret header X-Internal-Secret.

**Critical test scenarios**:
- Happy path Super Admin: Super Admin with branch null authenticates successfully and accesses global configurations, verifying **AC-1**.
- Happy path Operational Staff: Service engineer with valid branch authenticates and sees branch scoped tickets, verifying **AC-1**.
- Failure case new operational account: Incoming new service engineer payload with null branch is rejected with validation error, verifying **AC-2**.
- Backward compatibility existing staff: Existing service employee in database with null branch logs in and accesses tickets normally, verifying **AC-3**.
- Branch list synchronization: Endpoint returns live branches from auth module or local cache, verifying **AC-4** and **AC-5**.
- Safe UI rendering: SuperAdminTicketConfig renders without errors when selectedBranch is null, verifying **AC-6** and **AC-7**.

## Build plan

1. Update employee and branch database schemas and model definitions in ticket service to support branch identifiers and addresses, satisfying **AC-1**, **AC-2**, **AC-3**.
2. Update VerifyEmployeeJwt middleware to parse branch claims and enforce the role specific nullability validation rules, satisfying **AC-1**, **AC-2**, **AC-3**.
3. Implement live branch ingestion and caching in ticket service, exposing the branches endpoint, satisfying **AC-4**.
4. Update frontend AuthContext and BranchContext to dynamically store user branch information and retrieve live branch options, satisfying **AC-5**.
5. Update BranchSelector and SuperAdminTicketConfig components to support null branch state cleanly, satisfying **AC-6**, **AC-7**.
6. Add unit and feature tests in ticket service verifying role nullability rules and branch endpoints, satisfying **AC-1**, **AC-2**, **AC-3**, **AC-4**.

## Consequences

**Positive**:
- Consistent branch data flow between the central authentication service and the ticketing system.
- Explicit business logic protecting Super Admin system wide access while holding operational staff to physical branch boundaries.
- Graceful preservation of all existing accounts without requiring manual database migration fixes.

**Negative**:
- Requires ticket service to maintain a resilient HTTP connection and fallback mechanism to the central authentication service.
