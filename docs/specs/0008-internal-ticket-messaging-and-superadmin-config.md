# 0008. Internal Ticket Messaging and SuperAdmin Configuration

**Date**: 2026-10-23
**Status**: Accepted

## Summary

This specification introduces internal ticket messaging alongside granular SuperAdmin configuration at `/superadmin/config/messaging`. SuperAdmin operators can configure communication channels for external customer tickets and internal employee tickets independently. For internal tickets, operators choose between direct Requestor to Customer Support dialogue and extended Requestor to Assigned Employee collaboration with optional Customer Support oversight. The platform delivers real time threaded messaging, participant attribution with role snapshots at send time, secure file attachments with antivirus scanning, exclusion from AI indexing, automated participant notifications, and responsive cross platform interfaces.

## Context

The enterprise platform supports two distinct incident classes: external customer tickets submitted by hospital clients and internal tickets raised by staff members for facility or technical assistance. While external tickets follow a triage model between customers, customer support representatives, and field technicians, internal tickets often involve colleague to colleague technical collaboration.

Previously, the messaging configuration in the SuperAdmin portal only governed external ticket delegation. Internal tickets lacked direct communication controls between employee requestors and assigned technicians. In many internal scenarios, requiring customer support representatives to manually broker internal conversations creates unnecessary delays.

To resolve this bottleneck, the SuperAdmin messaging configuration must bifurcate policy controls into External Tickets and Internal Tickets. For internal tickets, administrators must be able to select between two distinct routing modes: Requestor to Customer Support only, or Requestor to Customer Support to Delegated Assigned Employee. When direct collaboration is enabled, internal requestors and assigned technicians can exchange messages, diagnostic observations, and verified attachments directly within a single unified thread.

## Requirements

**User stories**:
* As a SuperAdmin operator, I want dedicated configuration cards for external and internal ticket messaging at `/superadmin/config/messaging`, so that I can govern participation policies separately for each ticket type.
* As an Employee acting as a Requestor, I want to message the Assigned Employee directly within my internal ticket, so that we can collaborate efficiently on resolving the issue.
* As an Assigned Employee or Customer Support representative, I want to participate in the internal ticket conversation thread with clear sender identity and role attribution, so that accountability is preserved across reassignments.
* As a System Administrator, I want internal conversation content strictly excluded from AI chatbot and RAG pipelines, so that sensitive internal communications remain private.

**Acceptance criteria**:
* **AC-1**: SuperAdmin messaging configuration at `/superadmin/config/messaging` displays distinct sections or tabs for External Tickets and Internal Tickets.
* **AC-2**: SuperAdmin operators can configure Internal Tickets mode between `Requestor -> CS Only` and `Requestor -> CS -> Employee Delegated` (direct collaboration with assigned staff), persisting configuration to `ticket_configurations`.
* **AC-3**: The messaging data model supports Requestor, Assigned Employee, and Customer Support in a unified chronological thread for internal tickets.
* **AC-4**: An authorized participant can post non empty messages with optional file attachments to the internal ticket thread via `POST /api/tickets/{ticket_id}/messages`.
* **AC-5**: The API endpoint `GET /api/tickets/{ticket_id}/messages` retrieves full thread history with immutable `sender_role` snapshots reflecting sender role at the time of send.
* **AC-6**: Thread continuity is preserved across reassignment, escalation, and delegation events without message loss or timeline fragmentation.
* **AC-7**: File attachments reuse the ClamAV scanning pipeline and gate access until files are certified clean.
* **AC-8**: Ownership and role checks restrict access so an employee requestor can access only their own internal ticket thread unless authorized by CS or administrator privileges.
* **AC-9**: Internal ticket messages are tagged with `is_internal: true` and excluded from AI knowledge indexing and automated training ingestion.
* **AC-10**: New internal thread activity triggers notifications to the Requestor and Assigned Employee through their configured channels.
* **AC-11**: The frontend renders the internal ticket message thread with sender avatars, names, role badges, timestamps, attachment downloads, and responsive mobile styling.
* **AC-12**: The frontend message composer provides inline validation, sending indicators, and text preservation upon send failure.

## Options considered

### Option 1: Segmented SuperAdmin Configuration with Unified MongoDB Thread (Recommended)

Extend the existing SuperAdmin Messaging configuration view to include dedicated External and Internal ticket sections. Store configuration in `ticket_configurations` under key `messaging` with structured sub keys for external and internal policies. In `messaging-service`, reuse the MongoDB `messages` collection with `is_internal: true` flags, role snapshots, and ownership authorization.

**Pros**:
* Reuses existing high performance MongoDB 7 storage, Reverb WebSockets, and Redis cache.
* Clean separation of concerns between external and internal ticket communication policies.
* Seamless continuity across ticket lifecycle and employee reassignment.

**Cons**:
* Requires frontend updates in both SuperAdmin config and ticket detail modal views.

### Option 2: Separate Internal Notes Chat Channel

Treat internal ticket messaging as an extension of the existing MySQL `internal_notes` table rather than the MongoDB messaging pipeline.

**Pros**:
* Keeps internal communications isolated from the customer messaging database.

**Cons**:
* Creates duplicate chat architectures and distinct WebSocket channels.
* Inconsistent user experience between external and internal ticket conversations.
* Lacks rich real time chat capabilities and unified attachment scanning.

## Decision

**Chosen option**: Option 1: Segmented SuperAdmin Configuration with Unified MongoDB Thread.

**Implementation skills**: `react-frontend`, `laravel-microservice`, `docker-runbook`.

## Rationale

Option 1 provides a unified messaging architecture across the platform while enforcing strict policy boundaries. Administrators gain full control over participant permissions for both external client tickets and internal employee requests. Utilizing MongoDB for thread persistence ensures rapid message delivery, chronological integrity, and consistent attachment handling via ClamAV.

## Feature design

**Data model sketch**:

```text
Collection: messages (MongoDB 7)
Fields:
- _id: ObjectId
- ticket_id: int (indexed)
- sender_id: int (emp_id or client_id)
- sender_name: string
- sender_type: string ('employee', 'cs', 'customer', 'system')
- sender_role: string ('Requestor', 'Assigned Technician', 'Customer Support', 'Service Engineer')
- is_internal: boolean (true for internal tickets)
- message: string (max 5000 characters)
- attachments: array of objects [
    {
      id: string,
      name: string,
      file_path: string,
      file_size: int,
      mime_type: string,
      scan_status: string ('clean', 'quarantined', 'pending'),
      url: string
    }
  ]
- created_at: datetime
- updated_at: datetime
```

Configuration schema in MySQL `ticket_configurations` (key: `messaging`):
```json
{
  "allow_delegated_employee": true,
  "allow_full_history": true,
  "notify_on_employee_join": true,
  "internal": {
    "mode": "requestor_cs_delegated",
    "allow_direct_assigned": true,
    "allow_full_history": true,
    "notify_on_activity": true
  }
}
```

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/tickets/{ticket_id}/messages | GET | ticket_id:int | messages:array | Bearer JWT | 401 Unauthorized, 403 Forbidden, 404 Not Found |
| /api/tickets/{ticket_id}/messages | POST | ticket_id:int, message:string, attachments:file[] | message_obj:object | Bearer JWT | 401 Unauthorized, 403 Forbidden, 422 Empty/Too Long |
| /api/ticket-configurations/messaging | GET | none | config:object | Bearer JWT (Admin) | 401 Unauthorized, 403 Forbidden |
| /api/ticket-configurations/messaging | PUT | external:object, internal:object | config:object | Bearer JWT (Admin) | 401 Unauthorized, 403 Forbidden, 422 Invalid |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Load thread | Message list | MongoDB `messages` where `ticket_id = :id` |
| Render sender role | Role badge at send time | Stored snapshot `sender_role` on message |
| Check permission | Can post message | Ticket `requested_by`, `assigned_to`, and SuperAdmin `internal.mode` |
| View attachment | Clean file URL | `attachment-service` signed URL after ClamAV clean scan |
| SuperAdmin config | Internal messaging policy | `ticket_configurations` key `messaging` |

**Key invariants**:
* Non empty requirement: A message must contain non whitespace text or at least one uploaded attachment.
* AI pipeline exclusion: Messages on tickets with `is_internal: true` are filtered out of all vector search and training pipelines.
* Role immutability: The `sender_role` recorded when a message is sent never mutates upon subsequent employee promotions or reassignments.

**Security model**:
* Requestor access: Employee requestors may view and post to internal tickets where `requested_by == current_user.emp_id`.
* Technician access: Assigned employees may view and post when assigned and permitted by policy.
* Administrative oversight: Customer Support and SuperAdmin roles retain read and write access across all internal threads.

**Critical test scenarios**:
* Happy path: Requestor posts message to assigned technician, who replies with an attachment. Verifies **AC-3**, **AC-4**, **AC-5**.
* Policy enforcement: SuperAdmin disables delegated internal messaging, technician post is rejected with 403 Forbidden. Verifies **AC-2**, **AC-8**.
* Attachment security: Uploaded attachment with virus signature is quarantined with URL stripped. Verifies **AC-7**.
* AI isolation: Internal messages are excluded from knowledge base export. Verifies **AC-9**.
* Reassignment continuity: Ticket reassigned to second technician preserves historical messages with original role snapshots. Verifies **AC-6**, **AC-11**.

## Build plan

1. Update `services/messaging-service/app/Http/Controllers/MessageController.php` to handle internal ticket participant checks, `is_internal` attribution, and policy enforcement (satisfies **AC-3**, **AC-4**, **AC-5**, **AC-8**, **AC-9**).
2. Update `services/configuration-service` and `services/ticket-service` configuration controllers to store and broadcast internal messaging settings (satisfies **AC-1**, **AC-2**).
3. Enhance notification dispatching in `services/ticket-service/app/Services/TicketNotificationService.php` for internal thread activity (satisfies **AC-10**).
4. Update `frontend/web/src/pages/SuperAdminTicketConfig.jsx` with segmented External and Internal ticket messaging controls (satisfies **AC-1**, **AC-2**).
5. Build the internal ticket message thread and composer inside `frontend/web/src/components/CustomerTicketDetailModal.jsx` and employee ticket views (satisfies **AC-11**, **AC-12**).
6. Verify end to end functionality with unit and integration tests (satisfies **AC-1** through **AC-12**).

## Consequences

**Positive**:
* Direct technician collaboration for internal tickets speeds up issue resolution.
* Clear administrative segregation between external client policies and internal workflows.
* Strong security posture preserving antivirus scanning and AI data privacy.

**Negative / tradeoffs**:
* Increases configuration complexity in the SuperAdmin portal with additional policy switches.

## Follow-up

- [ ] Monitor adoption metrics of direct internal messaging across departments.
