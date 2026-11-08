# 0004. Customer Service SLA Monitoring Queue and Category Specific Feedback Question Configuration

**Date**: 2026-10-22
**Status**: Accepted

## Summary

This design delivers two major operational capabilities. First, it transforms the Customer Service assigned ticket queue into an SLA prioritization workspace. It replaces the redundant customer filter dropdown with a dynamic SLA compliance filter (All, Breached, At Risk, On Track / Compliant, and Paused), integrates live summary counts, enables sorting by SLA due date and compliance status, and links directly to the Super Admin SLA policy configuration. Second, it enriches the category specific feedback subsystem by adding genuine custom option multiple choice (single select), checkbox (multi select), and explicit yes or no question types alongside star ratings and free text, ensuring customer surveys reflect the exact nature of their equipment and service interactions.

## Context

Customer Service representatives must balance dozens of assigned and incoming tickets every day. Without visibility into SLA deadlines directly within their primary working queue (`/ticketing/cs/assigned`), representatives risk missing resolution windows, leading to service breaches. Currently, the assigned queue features a customer filter dropdown that provides limited prioritization value, while SLA due dates and compliance categories are calculated only on individual ticket detail pages or approximated with coarse hour thresholds.

Concurrently, the customer feedback collection workflow in `/feedback/:ticketId` and the Super Admin feedback configuration screen in `/ticketing/superadmin/config/feedback` previously restricted multiple choice questions to a hardcoded binary Yes or No. Administrators had no mechanism to define custom answer options or provide multi select checkboxes. Furthermore, feedback submissions did not systematically preserve the active category question set alongside answers for historical auditability and customer edit sessions.

## Requirements

**User stories**:
- As Customer Service, I want to see the SLA compliance status and due date of tickets I am monitoring, so that I can prioritize urgent work and avoid breaches.
- As Customer Service, I want to filter and sort tickets by SLA status and due date, with aggregate count indicators for breached and at risk items.
- As an Administrator, I want to configure category specific feedback question sets with flexible question types (Star Rating, Yes / No, Multiple Choice with custom options, Checkbox with custom options, and Free Text) and required flags.
- As a Customer providing feedback, I want relevant questions tailored to my ticket category (IT, Service, or Others) with intuitive single select, multi select, and text inputs, with reliable pre filling if I revisit my feedback.

**Acceptance criteria**:
- **AC-1**: The Customer Service assigned tickets view (`/ticketing/cs/assigned`) removes the customer filter dropdown and introduces an SLA compliance filter dropdown offering All, Breached, At Risk, On Track, and Paused options.
- **AC-2**: The backend CS incoming/assigned endpoint computes and returns the accurate SLA status and resolution due date for each ticket, reusing the authoritative calculation rules from `SLAService` and `sla_rules` / `branch_sla_policies`.
- **AC-3**: The endpoint supports filtering by SLA compliance status (`breached`, `at_risk`, `on_track`, `paused`) and sorting by `resolution_due_at` ascending or descending.
- **AC-4**: The endpoint provides a summary count aggregation scoped to the current view showing the exact counts of Breached, At Risk, On Track, and Paused tickets.
- **AC-5**: The queue displays prominent color coded SLA status badges with accessible icon and text labels on each ticket row.
- **AC-6**: When SLA rules or due date data are unavailable for a ticket, a clean fallback indicator is rendered without crashing the table.
- **AC-7**: The Super Admin feedback configuration module in `configuration-service` supports five distinct response types: `Star Rating`, `Yes / No`, `Multiple Choice`, `Checkbox`, and `Free Text`.
- **AC-8**: For `Multiple Choice` and `Checkbox` questions, administrators can define, edit, and reorder custom choices; `Yes / No` is maintained as a dedicated binary type.
- **AC-9**: The dynamic customer feedback form renders single select radio buttons for Multiple Choice, multi select checkboxes for Checkbox, binary buttons for Yes / No, an interactive rating scale for Star Rating, and a text area for Free Text.
- **AC-10**: Feedback submission persists category specific question answers and a snapshot of the questions into `customer_feedback`, returning pre filled answers when the customer revisits the form in edit mode.

## Options considered

### Option 1: Unified Authoritative SLA Evaluation and Polymorphic Question Config (Recommended)

1. **SLA Monitoring**:
   - Centralize SLA classification inside `SLAService` in `ticket-service`. Tickets with status "On Hold" are classified as `Paused`. Tickets where resolution time has surpassed `resolution_due_at` are classified as `Breached`. Tickets whose remaining time until `resolution_due_at` is under 25 percent or under 4 hours are classified as `At Risk`. All other open tickets are `On Track`. Closed/resolved tickets that met the deadline are `Compliant`.
   - Update `TicketDashboardService::getCsIncoming` and `TicketDashboardController::csIncoming` to accept `sla_status`, `sort_by` (`resolution_due_at`, `created_at`), and `sort_dir`, and compute summary counts.
   - Update `CSAssigned.jsx` to display summary count cards, replace the customer dropdown with the SLA status filter, and render clear badges for each status.

2. **Category Specific Feedback Questions**:
   - Update `FeedbackQuestion` in `configuration-service` to accept types: `Star Rating`, `Yes / No`, `Multiple Choice`, `Checkbox`, `Free Text`, and store array options in the `options` JSON column.
   - Update `SuperAdminTicketConfig.jsx` to let administrators add, remove, and edit options when `Multiple Choice` or `Checkbox` is selected.
   - Update `ExternalFeedbackPage.jsx` to render radio inputs for `Multiple Choice`, multi select checkboxes for `Checkbox`, dedicated buttons for `Yes / No`, stars for `Star Rating`, and text areas for `Free Text`.
   - Update `FeedbackController` and `CustomerFeedback` in `analytics-service` to persist `question_answers` and `category_questions_snapshot` as JSON fields.

**Pros**:
- Single source of truth for SLA status prevents discrepancy between the list and ticket detail modal.
- Provides all 5 question types requested by the user, separating binary Yes / No from custom Multiple Choice and Checkbox.
- Completely backward compatible with existing feedback and SLA records.

**Cons**:
- Requires coordinated updates across `ticket-service`, `configuration-service`, `analytics-service`, and frontend components.

### Option 2: Frontend Only Estimation and Static Survey Form

Compute SLA statuses client side using simple creation date math, and restrict feedback forms to basic text and static stars.

**Pros**:
- Few backend edits.

**Cons**:
- Fails the single source of truth requirement; client calculations drift from backend SLA rules.
- Fails the user requirement for custom choice options and checkboxes.

## Decision

**Chosen option**: Option 1: Unified Authoritative SLA Evaluation and Polymorphic Question Config.

### Implementation Specifics

#### 1. Backend: Ticket Service
- Extend `SLAService::evaluateSlaStatusForTicket` and add `computeTicketSlaMetrics($ticket, $slaPolicy = null)` returning `status` (`Breached`, `At Risk`, `On Track`, `Paused`, `Compliant`), `due_at` (`resolution_due_at`), and `time_remaining_minutes`.
- In `TicketDashboardService::getCsIncoming`:
  - Support query filters for `sla_status` (`breached`, `at_risk`, `on_track`, `paused`).
  - Support sorting by `resolution_due_at` and `sla_status`.
  - Include `sla_summary` in the response payload containing count tallies: `{ total, breached, at_risk, on_track, paused }`.
  - Attach `sla_status`, `resolution_due_at`, and `sla_label` to every item in `incoming_tickets`.

#### 2. Backend: Configuration Service
- In `FeedbackQuestionController.php`:
  - Update `response_type` validation to permit: `Star Rating`, `Yes / No`, `Multiple Choice`, `Checkbox`, `Free Text`.
  - Accept and store `options` as an array of strings for `Multiple Choice` and `Checkbox`.
  - Return updated question shapes in `toApiResponse()`.

#### 3. Backend: Analytics Service
- In `services/analytics-service/database/migrations`:
  - Add migration to append `question_answers` (json) and `category_questions_snapshot` (json) to `customer_feedback` table if not already present.
- In `CustomerFeedback` model:
  - Add `question_answers` and `category_questions_snapshot` to `$fillable` and `$casts`.
- In `FeedbackController`:
  - Store and return `question_answers` and `category_questions_snapshot`.

#### 4. Frontend: Customer Service Assigned Queue (`CSAssigned.jsx`)
- Remove the `customerFilter` select element.
- Add `slaFilter` dropdown with options: `All SLA Statuses`, `Breached`, `At Risk`, `On Track`, `Paused`.
- Add an SLA summary metrics bar displaying badges and counts for Breached, At Risk, On Track, and Paused tickets.
- Add an SLA Status column to the tickets table showing an accessible badge with icon and label.
- Add sorting controls for SLA Resolution Due Date.

#### 5. Frontend: Super Admin Feedback Configuration (`SuperAdminTicketConfig.jsx`)
- Expand `TS104_RESPONSE_TYPES` to include `Star Rating`, `Yes / No`, `Multiple Choice`, `Checkbox`, `Free Text`.
- In the question editor modal, show an interactive choices manager when `Multiple Choice` or `Checkbox` is selected, allowing admins to add, remove, and edit options.

#### 6. Frontend: External Feedback Form (`ExternalFeedbackPage.jsx`)
- Support all 5 response types dynamically:
  - `Star Rating`: 1 to 5 star interactive rating.
  - `Yes / No`: distinct Yes and No toggle buttons.
  - `Multiple Choice`: single select custom choices with radio buttons or selection pills.
  - `Checkbox`: multi select custom choices with checkbox toggles.
  - `Free Text`: multiline text area.
- Pre fill category specific question answers if previously submitted.

## Build plan

1. Backend: Implement SLA evaluation enhancements and summary aggregation in `TicketDashboardService.php` and `SLAService.php`.
2. Backend: Expand feedback question response types and options validation in `FeedbackQuestionController.php` and `FeedbackQuestion.php`.
3. Backend: Add migration and model updates in `analytics-service` for `customer_feedback`.
4. Frontend: Update `ticketService.js` and `CSAssigned.jsx` with the SLA status filter, summary counts, and status badges.
5. Frontend: Update `SuperAdminTicketConfig.jsx` with choices builder for `Multiple Choice` and `Checkbox`.
6. Frontend: Update `ExternalFeedbackPage.jsx` to render all 5 question types with answers persistence and pre filling.
7. Verification: Run backend syntax checks and execute frontend Vitest automated tests to ensure all functionality is green.
