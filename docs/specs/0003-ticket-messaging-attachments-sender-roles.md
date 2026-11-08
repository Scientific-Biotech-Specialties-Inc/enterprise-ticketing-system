# 0003. Ticket Messaging Attachments, Role Snapshots, and Edit History

**Date**: 2026-10-22
**Status**: In Progress

## Summary

This design enables users in all ticket messaging threads to attach files to messages, see accurate sender roles and timestamps recorded at the moment of sending, and edit previously sent messages within a configurable time window with full version history retention. All file uploads pass through the existing ClamAV antivirus daemon and file validation pipeline before exposure. Clean files are displayed inline with preview and download controls, pending scans are clearly indicated, and quarantined files are blocked from distribution. Historical sender role snapshots ensure that changing employee departments or user assignments never distorts past conversation logs.

## Context

The microservice ticketing platform supports real time communication between customers, customer service agents, and delegated technicians through MongoDB backed messaging and Reverb WebSockets. While basic text messaging exists, users frequently need to share screenshots, error logs, and technical documents to provide evidence and diagnose issues.

Currently:
1. Message sending does not allow file attachments. Users are forced to attach files separately at the ticket level or rely on external channels.
2. Messages store only `sender_type` (`customer`, `cs`, `employee`) rather than capturing the sender's exact role title at the point of send (such as `Customer Support`, `Service Engineer`, `IT Admin`, or `Customer`). If an employee changes positions, historical message bubbles might reflect an inaccurate title.
3. Message timestamps must be preserved strictly at the point of send to maintain immutable chronological ordering across web and mobile viewports.
4. Message editing requires strict guardrails: original sent timestamps must remain untouched for thread ordering, prior versions must be preserved for audit traceability, edits must be restricted to the original author within the configured window, and empty content must be rejected with helpful error messages.

## Requirements

**User stories**:
- As a user sending a message, I want to attach files and see clear sender roles and timestamps on every message, so that I can share evidence and track exactly who said what and when.
- As a user, I want to edit a message I have already sent, so that I can correct a typo or error without sending follow up messages.

**Acceptance criteria**:
- **AC-1**: The message sending endpoint accepts attached files alongside text or attachments alone, validating files against system limits and ClamAV malware scanning via the attachment service.
- **AC-2**: Each stored message captures an immutable snapshot of the sender role at time of sending (`sender_role`), guaranteeing that historical display remains accurate even if user assignments change later.
- **AC-3**: Message timestamps are recorded at the point of send and used consistently for chronological ordering and display.
- **AC-4**: Attachments tied to a message remain retrievable through the public storage proxy and are gated by scan status (`clean`, `pending`, `quarantined`). Quarantined files are masked and blocked from downloads.
- **AC-5**: Clear, structured error responses distinguish attachment validation failures (`ATTACHMENT_VALIDATION_FAILED`, `MALWARE_DETECTED`) from message sending failures (`MESSAGE_SEND_FAILED`, `CONVERSATION_ARCHIVED`).
- **AC-6**: The frontend message composer provides file attachment selection, per file progress indication, pre send removal, inline error messaging, and retry handling that preserves unsent text and attachments upon network failure.
- **AC-7**: Messages display attached files inline with file size, type icons, download links, sender role badges, and formatted timestamps.
- **AC-8**: Message editing is restricted to the original author within the configured edit window, retains prior versions in MongoDB `edit_history` without destructive overwrite, retains the original sent timestamp, and logs audit events.

## Options considered

### Option 1: Direct Attachment Upload Pipeline via Attachment Service and MongoDB Storage (Recommended)

Clients upload files to the dedicated `attachment-service` via `/api/ticketing/attachment/upload` with ClamAV inspection. The verified attachment metadata (`id`, `name`, `url`, `file_path`, `file_type`, `file_size`, `scan_status`) is passed into `POST /api/ticketing/messaging/tickets/{ticket_id}/messages` along with optional message text. Alternatively, the messaging endpoint accepts multipart form data and proxies files to the attachment service. The MongoDB message record stores an `attachments` array and an explicit `sender_role` string snapshot.

**Pros**:
- Reuses the existing ClamAV antivirus scanner daemon and system wide file limit configurations without duplicating scan logic.
- Avoids bloating the MongoDB document with heavy binary files; only metadata and public storage URLs are stored.
- Scan status gating (`clean`, `pending`, `quarantined`) is enforced both at the storage layer and in the UI.
- Works across all thread types (customer, CS, delegated employee).

**Cons**:
- Requires coordinating between `attachment-service` and `messaging-service`.

### Option 2: Store Binary Files Inside MongoDB GridFS

Upload files directly into MongoDB collections using GridFS streams.

**Pros**:
- Single database handles text and file binary data.

**Cons**:
- Bypasses the mandatory ClamAV antivirus scanning infrastructure and system wide file upload limits in `configuration-service`.
- Rapidly inflates MongoDB memory usage and backup sizes.
- Violates architectural standards requiring centralized attachment management.

## Decision

**Chosen option**: Option 1: Direct Attachment Upload Pipeline via Attachment Service and MongoDB Storage.

The implementation details:
1. `services/messaging-service/app/Models/Message.php`:
   - Adds `attachments` and `sender_role` to `$fillable`.
2. `services/messaging-service/app/Http/Controllers/MessageController.php`:
   - In `store()`:
     - Allows message text to be empty if attachments are present; returns structured 422 if both are empty.
     - Supports direct multipart file uploads by proxying to `attachment-service:8000/api/upload`, or accepts pre verified attachment objects in `attachments`.
     - Validates scan status: marks clean files, quarantines threats, and isolates suspicious files.
     - Captures `sender_role` snapshot at send time (`Customer`, `Customer Support`, `Service Engineer`, `IT Admin`, etc.).
     - Preserves `created_at` timestamp.
     - Broadcasts `attachments` and `sender_role` in `MessageSent` event and includes them in `index()` response.
   - In `update()`:
     - Enforces author restriction, edit time window (configurable via `MESSAGE_EDIT_WINDOW_MINUTES` or `ticket_configurations`), and non empty text validation.
     - Appends prior version to `edit_history`, preserving original `created_at` timestamp.
     - Records audit log entry in MySQL `ticket_audit_logs`.
   - In `history()`:
     - Returns full version history array and original timestamp.
3. `frontend/web/src/services/messagingService.js`:
   - Updates `sendTicketMessage` to accept attachments metadata or multipart data.
4. `frontend/web/src/pages/MessagingPage.jsx`:
   - Adds attachment paperclip button and hidden file input in the composer.
   - Shows selected files preview chips with removal cross button before send.
   - Shows per file upload progress and inline validation error alerts.
   - Displays sender name, role snapshot badge, and timestamp on every message.
   - Displays attached files inline in chat bubbles with type icons, clean download links, and quarantined threat warnings.
   - Displays `(edited)` indicator and edit window check before showing Edit button.
   - Preserves message text and attached files if send fails, allowing immediate retry.

## Build plan

1. Backend: Update `Message` model fillable attributes in `messaging-service`.
2. Backend: Update `MessageController` in `messaging-service` to process attachments, capture `sender_role`, enforce scan gating, and format error responses.
3. Backend: Update `MessageSent` and `MessageUpdated` events to broadcast `attachments` and `sender_role`.
4. Frontend: Update `messagingService.js` to support attachments payload.
5. Frontend: Update `MessagingPage.jsx` with composer attachment controls, file upload progress, attachment chips, scan status badges, sender role display, and retry logic.
6. Validation: Run PHP syntax checks and build frontend with `npm run build`.

## Consequences

- All message attachments are scanned by ClamAV before becoming accessible.
- Infected files are quarantined and never served to other participants.
- Historical messages preserve immutable role snapshots and original timestamps.
- Edit history is preserved with full audit traceability.
