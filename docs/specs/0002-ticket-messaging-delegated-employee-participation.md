# 0002. Ticket Messaging Delegated Employee Participation

**Date**: 2026-10-22  
**Status**: Accepted  

## Summary

This decision adds a dedicated Messaging configuration tab under Lifecycle and Workflow in the SuperAdmin portal. SuperAdmin operators can configure who participates in ticket messaging, keeping the default customer and customer support exchange while allowing delegated employees to join the conversation thread when tickets are assigned to them. When this setting is active, service engineers and technicians see their delegated tickets inside the employee messages page and can send and receive real time messages in a unified three party thread.

## Context

The enterprise ticketing system currently routes chat conversations primarily between the ticket requester (customer or internal user) and customer service agents. When customer service delegates a ticket to an external or field employee (such as a service technician or equipment engineer), that employee often needs direct communication context.

Without a central workflow policy, employees assigned to delegated tickets cannot view or join customer conversations from their employee portal. Customer support agents must manually relay questions, status checks, and diagnostic updates back and forth between customers and technicians. This causes delays, miscommunication, and duplicate effort.

The platform requires a centralized, database backed configuration in the SuperAdmin portal under Lifecycle and Workflow. This configuration must dictate whether delegated employees are authorized to participate in ticket messaging, allowing seamless collaboration across customer service, customers, and assigned technicians.

## Requirements

**User stories**:
- As a SuperAdmin, I want a Messaging tab under Lifecycle and Workflow settings so that I can configure whether delegated employees can participate in ticket messaging.
- As an assigned Employee, I want delegated tickets to appear in my messages view so that I can view ticket message history and communicate directly with customer support and the customer.
- As a Customer Support representative, I want assigned technicians to participate in the ticket conversation so that technical questions are resolved quickly without manual copy and paste.

**Acceptance criteria**:
- **AC-1**: SuperAdmin configuration portal displays a new Messaging tab within the Lifecycle and Workflow group at `/ticketing/superadmin/config/messaging`.
- **AC-2**: SuperAdmin operators can toggle delegated employee participation, with settings saved to the backend configuration service.
- **AC-3**: Configuration changes are stored in the MySQL `ticket_configurations` table under key `messaging` and broadcast in real time across services.
- **AC-4**: When delegated employee messaging is enabled, the employee messages view (`/employee/messages`) displays both internally created tickets and tickets delegated to the logged in employee.
- **AC-5**: Delegated employees can view the full message history of the ticket and post messages into the unified conversation thread.
- **AC-6**: When delegated employee messaging is disabled, delegated tickets are excluded from the employee messages view, and attempts by non creator employees to post messages are rejected with an authorization error.

## Options considered

### Option 1: Centralized Configuration Service with Unified Three Party Thread (Recommended)

Store the messaging participation policy inside `configuration-service` under the `ticket_configurations` store with Redis cache. Use the existing MongoDB messaging collection with sender identification (`customer`, `cs`, `employee`). When delegated employee participation is enabled, tickets assigned to the employee appear in their message list and allow full conversation history access.

**Pros**:
- Consistent with existing system architecture for lifecycle windows and notification routing.
- All participants share a single chronological timeline, preventing fragmented conversations.
- Instant configuration updates via existing Redis cache invalidation and event broadcasting.

**Cons**:
- Customers, support representatives, and technicians all share one channel, requiring clear sender identity badges.

### Option 2: Hardcoded Delegation Rules in Ticket Service

Hardcode the employee participation rule inside ticket service controllers without exposing a SuperAdmin configuration toggle.

**Pros**:
- Slightly fewer configuration UI components to build initially.

**Cons**:
- Inflexible for organizations that want customer support to remain the sole contact point.
- Violates the mandate for SuperAdmin lifecycle and workflow customization.

## Decision

**Chosen option**: Option 1: Centralized Configuration Service with Unified Three Party Thread.

Store the messaging delegation policy in `configuration-service` under the configuration key `messaging`. Connect the SuperAdmin Lifecycle and Workflow UI to update this record via REST APIs. Expose delegated tickets in `MessagingPage.jsx` when this policy is active, allowing employees to participate directly in ticket communication.

**Implementation skills**: `laravel-microservice` (`services/configuration-service`, `services/messaging-service`, `services/ticket-service`), `react-frontend` (`frontend/web/src/pages/SuperAdminTicketConfig.jsx`, `frontend/web/src/pages/MessagingPage.jsx`).

## Rationale

Storing this configuration in `configuration-service` aligns with how closure windows, transitions, and notification routes are governed. The configuration service already manages system wide lifecycle policies, validates superadmin credentials, and invalidates Redis caches cleanly.

Allowing assigned technicians to join the existing message thread with full history gives technicians immediate context regarding prior diagnostic conversations. This eliminates the need for customer service representatives to manually summarize previous exchanges.

## Feature design

**Data model sketch**:

JSON payload for `ticket_configurations` where `key = 'messaging'`:
```json
{
  "default_participants": "customer_cs",
  "allow_delegated_employee": true,
  "allow_full_history": true,
  "notify_on_employee_join": true,
  "updated_at": "2026-10-22T10:30:00Z"
}
```

Database default row in MySQL `ticket_configurations`:
- `key`: `messaging`
- `value`: JSON encoded representation of the settings above
- `created_at`, `updated_at`: timestamps

**State transitions**:
1. Ticket is created: participants are Customer and Customer Support.
2. Ticket is delegated / assigned to an employee: if `allow_delegated_employee` is true, the ticket becomes accessible in the assigned employee's messages view.
3. Ticket is closed: conversation archives if closure archival is enabled.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /ticket-configurations/messaging | GET | none | `{ key: 'messaging', value: {...} }` | Bearer (Superadmin or internal) | 401, 500 |
| /ticket-configurations/messaging | PUT | `{ allow_delegated_employee: boolean, allow_full_history: boolean }` | `{ message: 'Configuration updated', data: {...} }` | Bearer (Superadmin) | 401, 403, 422 |
| /ticket-configurations/messaging/reset | POST | none | `{ message: 'Reset to defaults', data: {...} }` | Bearer (Superadmin) | 401, 403 |
| /employee-tickets | GET | `employee_email: string` | `{ tickets: [...] }` | Bearer (Employee / Subsystem) | 401 |
| /tickets/{ticket_id}/messages | GET | `ticket_id: int` | `{ messages: [...] }` | Bearer | 401, 403 |
| /tickets/{ticket_id}/messages | POST | `message: string` | `{ message: 'Message stored', message_obj: {...} }` | Bearer | 401, 403, 422 |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| SuperAdmin loads Messaging tab | Toggle states for employee participation | GET `/ticket-configurations/messaging` from configuration service |
| SuperAdmin saves Messaging tab | Success alert and updated toggle state | PUT `/ticket-configurations/messaging` payload |
| Employee opens messages view | Delegated tickets list | Merged list of internal tickets and assigned tickets from ticket service |
| Employee sends message | New chat bubble with employee badge | POST `/tickets/{ticket_id}/messages` with sender identity from auth token |

**Key invariants**:
- When `allow_delegated_employee` is false, employees can only message on internal tickets they personally created.
- When `allow_delegated_employee` is true, employees can only access conversations for tickets explicitly assigned to them or created by them.
- Closed tickets honor the configured closure window and archival policies.

**Security model**:
- Updating messaging configuration requires SuperAdmin authorization verified by JWT role inspection.
- Reading configuration is available to authenticated internal subsystems and employee sessions.
- Message submission in `services/messaging-service` verifies that the sender is either the customer owner, a customer service representative, or an assigned employee when permitted.

**Configuration required**:
- None. Uses existing MySQL connection and Redis broker.

**Critical test scenarios**:
- Happy path: SuperAdmin enables delegated employee messaging, and an employee assigned to ticket TKT-1001 opens `/employee/messages`, views the conversation history, and sends a reply, verifying AC-1, AC-2, AC-3, AC-4, AC-5.
- Delegation restriction: SuperAdmin disables delegated employee messaging, and delegated tickets no longer show in the employee messages list, verifying AC-6.
- Unauthorized post guard: An employee not assigned to the ticket attempts to send a message and receives HTTP 403 Forbidden, verifying AC-6.

## Build plan

1. Add `messaging` configuration default key, validator, and controller endpoints in `services/configuration-service/app/Http/Controllers/TicketConfigurationController.php` and `routes/api.php` (satisfies AC-2, AC-3).
2. Add the Messaging tab (`TAB_MESSAGING`) to `GROUP_LIFECYCLE` in `frontend/web/src/pages/SuperAdminTicketConfig.jsx` with real time saving and reset buttons (satisfies AC-1, AC-2).
3. Add configuration service client helper functions in `frontend/web/src/services/configurationService.js` for getting and updating messaging settings (satisfies AC-2, AC-3).
4. Update `services/messaging-service/app/Http/Controllers/MessageController.php` to verify employee assignment against the messaging configuration policy before allowing message retrieval and posting (satisfies AC-5, AC-6).
5. Update `frontend/web/src/pages/MessagingPage.jsx` so that for employee users, both internal tickets and assigned/delegated tickets are loaded when messaging configuration permits it (satisfies AC-4, AC-5).
6. Verify end to end behavior across SuperAdmin configuration and employee messaging views (satisfies AC-1, AC-2, AC-4, AC-5, AC-6).

## Consequences

**Positive**:
- Direct communication channel between technicians, customer support, and clients when tickets are delegated.
- SuperAdmin operators have complete granular control to toggle this feature on or off according to organizational policy.
- Zero database schema migrations needed; leverages existing dynamic configuration architecture.

**Negative**:
- Customer support and employees need clear visual tags in the chat UI so customers know who is talking.
