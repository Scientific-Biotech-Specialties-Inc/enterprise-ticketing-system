# 0005. Ticket Message Participant Notifications and Presence Suppression

**Date**: 2026-10-22  
**Status**: Accepted  

## Summary

This decision extends ticket messaging to automatically notify all conversation participants whenever a new message is posted. It resolves participants dynamically across external and internal tickets by combining ticket creators, current assigned employees, and all staff who have posted in the thread. It integrates with notification delivery channels and customer notification preferences, suppresses in app alerts when a recipient is actively viewing the live thread, and ensures safe failure tolerance and deep link navigation across desktop and mobile screens.

## Context

The enterprise ticketing system allows customers, customer service representatives, and assigned technicians to communicate through a unified ticket chat backed by MongoDB and Reverb WebSockets. However, when a message is posted, participants who are not actively staring at that exact screen or who work across multiple tickets miss new replies unless someone manually alerts them.

The system currently contains partial notification logic in `MessageController` and centralized notification services in `TicketNotificationService`. However, participant resolution is fragmented: internal tickets differ from customer tickets, assigned technicians change over time, and previous contributors to a thread are often omitted. Furthermore, users already viewing an active conversation on the screen receive unnecessary in app notification badges and alerts for their own open thread, creating distraction.

A cohesive architecture is required to resolve genuine thread participants at send time, respect configured delivery channels and user preferences, suppress in app alerts for users actively present in the thread, and provide seamless click through navigation directly to the message in the conversation.

## Requirements

**User stories**:
- As a customer or employee ticket creator, I want to receive an alert when someone posts a message on my ticket so that I can respond promptly.
- As an assigned technician or participating support agent, I want to be notified of replies on tickets I am handling without receiving alerts when I am already actively chatting in that thread.
- As a ticket participant receiving a notification, I want clicking the alert to take me directly to the relevant ticket thread and scroll to the new message.

**Acceptance criteria**:
- **AC-1**: When a message is successfully saved in MongoDB, a notification event is dispatched immediately to all current thread participants, strictly excluding the sender.
- **AC-2**: Participant resolution accurately unions the ticket requester (client for external tickets, employee for internal tickets), the currently assigned employee from MySQL at send time, and any staff or CS members who have previously posted messages in this ticket.
- **AC-3**: System delivery channels in the `notification_channels` table for key `new_message` (channel: `in_app`, `email`, or `both`) and client preferences in Redis (`client:notification_preferences:{id}`) are strictly honored.
- **AC-4**: Real time thread presence is tracked in Redis (`ticket:presence:{ticket_id}:{user_key}` with a 30 second expiration). If a recipient is actively viewing the ticket thread, in app notification insertion is suppressed for them while the message continues to appear via WebSocket.
- **AC-5**: Notification records include ticket ID, title, sender name, message preview text, and structured data containing a deep link to the thread (`/messages?ticketId={id}` or role equivalent).
- **AC-6**: Notification delivery failures are caught and logged with retries without blocking or rolling back successful message creation.
- **AC-7**: In app notification dropdown and notifications page render message alerts with sender preview, and clicking a notification navigates directly to the ticket conversation with focus on the target thread across desktop and mobile views.

## Options considered

### Option 1: Live Thread Presence Suppression with Central Participant Union (Recommended)

Resolve thread participants at send time by inspecting the current ticket record in MySQL, querying unique historical staff senders in MongoDB for that ticket, and excluding the sender. Track thread viewing presence in Redis with a 30 second rolling key updated by the frontend every 15 seconds. If a recipient's presence key is active, suppress the in app notification row while letting the WebSocket broadcast update the thread.

**Pros**:
- Solves alert fatigue by not pinging users who are already reading the message.
- Always uses the freshest assignment state from MySQL rather than stale cached values.
- Thread participants who joined earlier retain conversational continuity.

**Cons**:
- Requires a lightweight presence heartbeat endpoint and periodic Redis write while a conversation is open.

### Option 2: Static Two Party Routing Without Presence Suppression

Only notify the ticket creator and the assigned employee, with no thread presence check.

**Pros**:
- Slightly simpler logic with no heartbeat endpoint.

**Cons**:
- Fails to notify secondary technicians or customer service staff who helped on the ticket.
- Spams users with popups and unread badges for messages they are already looking at.

## Decision

**Chosen option**: Option 1: Live Thread Presence Suppression with Central Participant Union.

Implement dynamic participant resolution in `services/messaging-service`, check Redis presence keys to suppress in app alerts for active viewers, verify delivery preferences, and provide deep link navigation in the frontend.

**Implementation skills**: `laravel-microservice` (`services/messaging-service`, `services/ticket-service`, `services/notification-service`), `react-frontend` (`frontend/web/src/pages/MessagingPage.jsx`, `frontend/web/src/components/Header.jsx`, `frontend/web/src/pages/Notifications.jsx`).

## Rationale

Dynamic participant resolution ensures that every stakeholder who has engaged in a ticket thread stays informed of replies. Querying MySQL directly at send time guarantees that recent reassignments or transfers are instantly reflected.

Using Redis for presence suppression with a 30 second key provides high performance non blocking checks without database load. If a user closes their tab or switches tickets, presence expires quickly, ensuring subsequent notifications are delivered reliably.

## Feature design

**Data model sketch**:

Redis Keys:
- `ticket:presence:{ticket_id}:{user_key}`: string timestamp or JSON `{"user_key": "employee:5", "active_at": "..."}` with TTL of 30 seconds.
- `client:notification_preferences:{client_id}`: JSON `{"in_app": true, "email": true}`.

MySQL `notifications` table columns utilized:
- `recipient_id`: integer
- `recipient_type`: enum or string (`client` or `employee`)
- `title`: string (e.g. `New Message on Ticket #1042`)
- `message`: text preview (e.g. `John Smith: Can you verify the diagnostic logs?`)
- `ticket_id`: integer
- `data`: JSON string `{"type": "new_message", "ticket_id": 1042, "sender_name": "...", "sender_type": "...", "sender_role": "...", "message_preview": "...", "link": "/employee/messages?selectedTicketId=1042"}`
- `is_read`: boolean (default false)
- `created_at`, `updated_at`: timestamps

MySQL `notification_channels` table:
- Row where `alert_key = 'new_message'` with `channel` in `['in_app', 'email', 'both']`.

**State transitions**:
1. Frontend opens ticket thread: sends heartbeat ping to `/api/ticketing/messaging/tickets/{ticket_id}/presence`. Redis key `ticket:presence:{ticket_id}:{user_key}` is stored with 30s TTL.
2. User posts message: `MessageController::store` creates message in MongoDB and triggers Reverb WebSocket broadcast.
3. Notification processor evaluates thread participants:
   - Requester (client or employee depending on `ticket.is_internal`).
   - Current `assigned_to` and all `ticket_assignments` rows from MySQL.
   - Distinct historical staff/CS senders from MongoDB for this `ticket_id`.
   - Excludes current sender.
4. For each recipient:
   - Check channel preference in `notification_channels` and `client:notification_preferences`.
   - Check if Redis presence key exists for this recipient on this ticket.
   - If present and channel is `in_app`, suppress in app row.
   - If not present and in app enabled, insert into `notifications`.
   - If email enabled, dispatch email notification job.
5. Frontend receives WebSocket event: updates chat messages instantly; header updates unread count only if an in app notification was created.
6. User clicks notification: deep links to `/messages?selectedTicketId={id}` (or role path) and selects the ticket thread.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/ticketing/messaging/tickets/{ticket_id}/presence | POST | None (bearer token identifies user) | `{"status": "ok", "expires_in": 30}` | Bearer JWT | 401, 404 |
| /api/ticketing/messaging/tickets/{ticket_id}/presence | DELETE | None | `{"status": "cleared"}` | Bearer JWT | 401 |
| /api/ticketing/messaging/tickets/{ticket_id}/messages | POST | message: string, attachments: array | `{"message": "...", "data": {...}}` | Bearer JWT | 401, 403, 422 |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Notification creation | Recipient set | Computed from MySQL `tickets.requested_by` or `created_by`, `assigned_to`, `ticket_assignments`, and MongoDB message senders |
| Notification creation | In app suppression | Derived from Redis `ticket:presence:{ticket_id}:{user_key}` existence check |
| Notification creation | Channel filter | Read from MySQL `notification_channels` where `alert_key = 'new_message'` |
| Notification creation | Client preferences | Read from Redis `client:notification_preferences:{id}` |
| Notification creation | Deep link URL | Computed from recipient role context and ticket ID (`/messages`, `/employee/messages`, or `/cs/messages`) |

**Key invariants**:
- The sender of a message never receives a notification for their own message.
- A user actively viewing a ticket thread on their screen does not receive an in app unread alert or notification badge for that thread.
- Notification dispatch errors must never roll back or prevent message persistence in MongoDB.
- Participant resolution must read the latest `assigned_to` and `ticket_assignments` from MySQL at send time without relying on stale caches.
- Internal ticket threads must never leak messages or notifications to external clients.

**Security model**:
- All presence pings and message actions require validated JWT bearer tokens.
- Notifications are strictly inserted with `recipient_id` and `recipient_type` corresponding to authorized participants.
- Non participants cannot ping presence or receive notifications for tickets they cannot access.

**Critical test scenarios**:
- External ticket reply: Customer posts message, assigned technician and participating CS receive notifications, verifies **AC-1**, **AC-2**, **AC-5**.
- Active viewer suppression: Technician is actively viewing ticket with presence ping, customer posts message, message appears live via WebSocket, no in app notification row is inserted for technician, verifies **AC-4**.
- Offline / inactive participant: Technician is on dashboard, customer posts message, in app notification row is created and badge appears, verifies **AC-1**, **AC-7**.
- Internal ticket scoping: Employee posts on internal ticket, only internal assignees and requester are notified, client is never contacted, verifies **AC-2**.
- Preference honor: Client with in app disabled receives email only, verifies **AC-3**.
- Click through navigation: Clicking notification opens messaging with ticket selected, verifies **AC-7**.

## Build plan

### Slice 1: Thread Presence & Participant Resolution (Backend)
- Implement presence heartbeat endpoint in `services/messaging-service/routes/api.php` and `MessageController.php` (POST and DELETE `/tickets/{ticket_id}/presence`). Satisfies **AC-4**.
- Implement dynamic participant resolution in `MessageController.php`: resolve requester, current assigned employees from MySQL, historical staff participants from MongoDB, and exclude sender. Satisfies **AC-1**, **AC-2**.
- Implement preference checking against `notification_channels` and `client:notification_preferences`. Satisfies **AC-3**.
- Implement presence check suppression: if recipient key exists in Redis, skip in app notification insertion. Satisfies **AC-4**.
- Build enriched notification payload with title, preview, ticket ID, and deep link. Satisfies **AC-5**, **AC-6**.

### Slice 2: Frontend Presence Heartbeat & Real Time Thread Handling (Frontend)
- Update `MessagingPage.jsx` to dispatch presence ping every 15 seconds while a conversation is open, and clear on unmount or ticket change. Satisfies **AC-4**.
- Support `ticketId` or `selectedTicketId` URL search parameter and location state so deep links auto open the conversation. Satisfies **AC-7**.
- Ensure Reverb message listener does not trigger in app alert banners for the currently focused ticket. Satisfies **AC-4**.

### Slice 3: Notification Rendering & Deep Link Click Through (Frontend)
- Update `Header.jsx` and `Notifications.jsx` to render `new_message` notifications with ticket context and sender preview. Satisfies **AC-5**, **AC-7**.
- Implement notification click handler to navigate directly to the appropriate messaging URL with `selectedTicketId` state. Satisfies **AC-7**.
- Test mobile and desktop responsive views. Satisfies **AC-7**.
