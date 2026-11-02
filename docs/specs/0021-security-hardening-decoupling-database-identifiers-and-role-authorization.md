# 0021. Security Hardening Decoupling Database Identifiers and Role Authorization

Date: 2026-11-01
Status: Accepted

## Summary

This specification establishes security hardening across the client application by eliminating brittle database primary key status checks, removing hardcoded test email credentials from authorization context, and deriving department escalation lists dynamically from active staff directory data.

## Context

A recent security and code audit identified four vulnerabilities and anti patterns across customer service modals, ticket escalation components, and branch context:
First, UI components checked raw database numeric IDs such as status ID five for escalated tickets and status ID four for closed tickets. Relying on database auto increment keys couples frontend behavior to database internal sequencing, breaks across environments if seeders change, and exposes database internals in client logic.
Second, BranchContext evaluated hardcoded email addresses such as superadmin at example dot com and admin at example dot com to grant elevated permissions. Checking identity by static email rather than authenticated token roles creates authorization bypass risks and leaks mock account names into production bundles.
Third, BranchContext and ticket modals exposed unnecessary data fields rather than clean, scoped metadata.
Fourth, EscalateTicketModal hardcoded static department lists instead of discovering active departments dynamically from available organizational data.

## Requirements

User stories:
- As a security auditor, I want role authorization to rely exclusively on verified user role tokens rather than hardcoded email strings so that privilege escalation is prevented.
- As a frontend engineer, I want status checks to evaluate semantic status names rather than database numeric status IDs so that business logic remains decoupled from database schema internals.
- As a branch administrator, I want BranchContext to store only necessary branch metadata without leaking sensitive employee details or hardcoded identities.
- As a support agent, I want the escalation modal to dynamically discover eligible departments and managers from live directory data without hardcoded department assumptions.

Acceptance criteria:
- AC 1: All client side status checks in CSModals, EscalateTicketModal, CustomerTicketDetailModal, InternalTicketMessageThread, EmployeeMachine, EmployeeHistoryDetail, and MessagingPage must evaluate normalized status strings (such as escalated, closed, pending evaluation) rather than hardcoded numeric database status IDs.
- AC 2: BranchContext must determine administrative privileges strictly through normalized role properties (superadmin, admin, systemadministrator, itadmin) and completely remove hardcoded email checks.
- AC 3: BranchContext must store and broadcast only minimal branch identification properties (id, slug, name, code, region) without embedding sensitive user authentication credentials.
- AC 4: EscalateTicketModal must derive available department targets dynamically from the active employee directory and ticket context instead of relying on a hardcoded list of static departments.
- AC 5: Unit test suites must verify role isolation and dynamic department discovery without referencing hardcoded bypass emails.

## Decision

We adopt semantic domain state matching and strict token role evaluation:
1. Status Evaluation: Replace all instances of `Number(ticket_status_ID) === 5` or `status_id === 5` with semantic string matching against `ticket.status` and `ticket.status_name`.
2. Role Authorization: Remove all hardcoded email checks from `BranchContext.jsx`. Permission checks evaluate `authUser.role` only.
3. Minimal Context Exposure: Keep `BranchContext` values limited to branch routing identifiers and display labels.
4. Dynamic Organizational Discovery: Extract department targets from the provided `employees` prop using a unique set of non empty department names, ensuring compatibility with any enterprise organizational hierarchy.

## Build plan

1. Update `CSModals.jsx` to replace raw status ID comparisons with normalized status string checks.
2. Update `EscalateTicketModal.jsx` to eliminate raw status ID checks and derive available departments dynamically from employee directory data.
3. Update `BranchContext.jsx` to eliminate hardcoded email evaluations and rely strictly on role tokens.
4. Update affected sibling components (`CustomerTicketDetailModal.jsx`, `InternalTicketMessageThread.jsx`, `EmployeeTicketUpdate.jsx`, `EmployeeMachine.jsx`, `MessagingPage.jsx`, `EmployeeHistoryDetail.jsx`) to remove numeric status ID couplings.
5. Update `BranchContext.test.jsx` and modal test suites to verify that role authorization functions without hardcoded email bypasses.
6. Verify production build with `npm run build` and run test suite.

## Consequences

Positive:
- Prevents authorization bypass vulnerabilities via mock email spoofing.
- Eliminates brittle coupling between frontend UI components and database auto increment status rows.
- Makes the application resilient to database reseeding, custom statuses, and organizational restructuring.

Negative:
- Any legacy test fixtures that supplied fake emails without proper role attributes must be updated to supply explicit role fields.

## Follow-up

Review backend authorization middleware across microservices to confirm that inter service requests also rely strictly on signed JWT claims rather than header email fallbacks.
