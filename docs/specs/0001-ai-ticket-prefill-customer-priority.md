# 0001. Prefill Ticket Fields From AI Support And Remove Customer Priority Selection

**Date**: 2026-10-22
**Status**: Accepted

## Summary

This enhancement carries over diagnostic details from the artificial intelligence support assistant directly into the customer ticket creation form. When you escalate or proceed to create a ticket from chat, the title, equipment name, problem category, and description are automatically filled. Customer priority selection is removed from the form and handled automatically with sensible defaults in the background.

## Context

Customers chatting with the artificial intelligence support assistant currently get redirected to the ticket creation form, but the extracted problem title, equipment, category, and conversation summary are not carried over reliably. In several places, navigation state keys do not match what the form expects, and machine or category names returned by the assistant are not mapped to their numeric identifiers.

At the same time, the customer ticket creation page currently requires customers to select a ticket priority. Customer service guidelines and service level agreements dictate that ticket priority should be evaluated by customer support engineers and automated triage rules, not manually chosen by customers. Removing the priority selector simplifies the customer experience while preventing customer side priority inflation.

## Requirements

**User stories**:
* As a customer using artificial intelligence support, I want my ticket creation form to be prefilled with the title, equipment, category, and summary from our conversation so that I do not have to retype my problem.
* As a customer submitting a ticket, I want a streamlined form without an artificial priority dropdown so that I can submit my issue quickly without guessing internal priority levels.

**Acceptance criteria**:
* **AC-1**: When navigating from artificial intelligence support to ticket creation, the ticket title, equipment name, problem category, and detailed description are prefilled into the form fields.
* **AC-2**: Equipment names and models identified during the chat are resolved to the corresponding equipment identifier in the customer equipment list.
* **AC-3**: Problem category names identified by artificial intelligence are resolved to the corresponding problem category identifier in the form options.
* **AC-4**: If you refresh the page or navigate via a conversation identifier, the form falls back to fetching prefill data from the conversation handoff endpoint.
* **AC-5**: The priority dropdown selector is completely removed from the customer ticket creation user interface.
* **AC-6**: Form submissions and draft saves still include a valid priority identifier in the background payload so backend validation succeeds.

## Options considered

### Option 1: Direct navigation state with backend handoff fallback

Pass the prefill data directly via navigation state when transitioning between routes, while also supporting an asynchronous lookup from the conversation handoff endpoint when only a conversation identifier is present.

**Pros**:
* Instant prefill without an extra network round trip during normal navigation.
* Graceful fallback if the customer reloads the page or arrives via deep link.

**Cons**:
* Requires maintaining consistent property names across both the navigation state and the backend response.

### Option 2: Backend handoff endpoint only

Do not pass form values in route state, and instead always fetch the conversation handoff payload from the backend using the conversation identifier.

**Pros**:
* Single path for reading prefill data.

**Cons**:
* Introduces a network delay on page load, and loses any immediate client side machine matching resolved during the active chat session.

## Decision

**Chosen option**: Option 1: Direct navigation state with backend handoff fallback

We pass the prefilled title, equipment, category, and description directly in route state from the chat component, and map them in the ticket creation page alongside the existing conversation handoff loader. We also remove the priority input from the form template and default the priority value in the submission payload to Low or the first available priority option.

## Rationale

Passing state directly makes the transition instant for the user and preserves the client side machine matching already performed during the troubleshooting session. Keeping the backend handoff query as a secondary loader ensures resilience if the page is refreshed. Removing the customer priority selector aligns customer portal behavior with company service level agreements.

## Feature design

**Component changes**:
* `AISupportPage.jsx`: When triggering ticket creation from `handleCreateTicket`, review modal confirmation, or prompt suggestions, pass a complete `prefillData` object containing `title`, `machine_ID`, `machineModel`, `problem_category_ID`, `category`, and `description`, along with `conversationId`.
* `TicketCreation.jsx`:
  * Read `location.state?.prefillData` and map title, description, machine, and category into `formData`.
  * Resolve machine by identifier, name, model, or brand against `options.machines`.
  * Resolve problem category by identifier or name against `options.problem_categories`.
  * Support `location.state?.conversationId` in addition to `conversation_id`.
  * Remove the priority dropdown input from the visual form grid.
  * Adjust the form layout grid so Problem Category cleanly occupies the row.
  * Maintain `priority_ID` in state and payload default values so backend validation passes.

## Build plan

1. Update `AISupportPage.jsx` navigation handlers to pass complete `prefillData` and conversation identifiers (satisfies AC-1, AC-2, AC-3).
2. Update `TicketCreation.jsx` state initialization and options resolution effect to map incoming machine and category data to their identifiers (satisfies AC-1, AC-2, AC-3, AC-4).
3. Remove the priority selector element and clean up the form layout in `TicketCreation.jsx` while keeping background payload defaults (satisfies AC-5, AC-6).
4. Verify build and end to end behavior.
