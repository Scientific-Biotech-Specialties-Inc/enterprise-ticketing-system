# 0012. Artificial Intelligence Department Triage Modal And Optional Equipment For IT Software Issues

Date: 2026-10-29
Status: Accepted

## Summary

This enhancement introduces an artificial intelligence department classification flow on the customer ticket creation page. When a customer writes an issue description, the artificial intelligence analyzes the text to determine whether the problem belongs to the IT department (software or account or digital systems) or the Service department (physical machinery or hardware). A clear confirmation modal displays the suggestion with reasoning and allows the customer to switch departments with one click. When an issue is classified as IT, equipment selection becomes optional because software issues do not require a physical machine. When an issue is classified as Service, equipment selection remains mandatory.

## Context

Customers submitting tickets on the customer portal were previously forced to select a physical equipment item for every single ticket. For software issues such as account permissions, system bugs, or network access, selecting medical or office machinery does not make sense. Furthermore, tickets often arrived without clear department routing, which slowed down triage between the IT team and the physical equipment service engineers.

In addition, customer ticket submissions encountered authorization errors because subsystem authentication in the ticket service intercepted customer tokens and rejected them prematurely.

## Requirements

### User stories

* As a customer reporting a software or account problem, I do not want to be forced to select physical equipment because my problem is software related.
* As a customer describing my issue, I want smart assistance to identify the right department automatically so that my ticket reaches the correct engineering team immediately.
* As a customer reviewing the suggestion, I want to see the reason why the system classified my ticket as IT or Service and have the freedom to switch departments if the suggestion does not match my intent.

### Acceptance criteria

* AC 1: The artificial intelligence service exposes an endpoint to classify ticket title and description into either IT or Service, returning confidence, department identifier, whether it is software, and a plain language explanation.
* AC 2: On the customer ticket creation page, when you enter a description and blur the field (or submit), the system analyzes the issue and displays a confirmation modal with the detected department and reasoning.
* AC 3: The modal provides a one click toggle allowing you to switch between IT and Service before confirming.
* AC 4: When IT (Software) is confirmed, the equipment dropdown becomes optional on the form and in validation. If no equipment is selected, the ticket is created with a null machine identifier and department set to IT.
* AC 5: When Service (Hardware) is confirmed, the equipment dropdown remains mandatory. If no equipment is selected, the form prompts you to select one before submission can proceed.
* AC 6: The ticket service database schema allows null values for the machine identifier in the tickets table, and the ticket controller validates machine selection conditionally based on department.
* AC 7: Customer token authentication in the ticket service allows customer requests to fall through to Passport authentication when employee token signature verification fails.

## Options considered

### Option 1: Real time description blur analysis with interactive modal and backend conditional validation (Chosen)

Analyze the problem when you finish typing the description, show an informative modal where you can confirm or switch departments, make equipment optional for IT, and update database and controller validation to accept null equipment.

Pros:
* Fast and intuitive customer experience.
* Prevents unnecessary form submission errors.
* Keeps customer in control with one click department switching.

Cons:
* Requires updating the database column definition and controller validation.

### Option 2: Pure client side keyword detection without modal

Detect software keywords in JavaScript directly and hide the equipment field without asking the user.

Pros:
* No modal dialog needed.

Cons:
* Prone to false positives without user confirmation.
* Lacks the reasoning transparency provided by the artificial intelligence model.

## Decision

We adopt Option 1. The artificial intelligence service handles classification using Gemini with a resilient heuristic fallback. The frontend displays a modal showing the detected department and reason, allowing one click switching. When IT is selected, equipment is optional. The database column is made nullable, and the controller validates conditionally.

## Technical design

### Database changes

Modify `tickets.machine_ID` to be nullable:

```sql
ALTER TABLE tickets MODIFY machine_ID bigint unsigned NULL;
```

A Laravel migration handles this modification safely.

### API contracts

#### Artificial intelligence triage endpoint

* Route: `POST /api/ticketing/ai/classify-department`
* Request payload:
  * `title`: string (required)
  * `description`: string (required)
* Response format:
  * `department`: string (`IT` or `Service`)
  * `department_id`: integer (`2` for IT, `1` for Service)
  * `is_software`: boolean (`true` for IT, `false` for Service)
  * `requires_equipment`: boolean (`false` for IT, `true` for Service)
  * `confidence`: number
  * `reasoning`: string

#### Ticket creation endpoint update

* Route: `POST /api/ticketing/ticket/tickets`
* Payload accepts optional `department_id` (defaults to 2 for IT or 1 for Service).
* If `department_id` is 2 (IT), `machine_ID` is nullable.
* If `department_id` is 1 (Service), `machine_ID` is required.

### User interface flow

1. Customer fills in Title and Problem Category.
2. Customer types Detailed Description and blurs the input (or clicks Submit).
3. The system triggers department classification and opens the AI Department Triage Modal.
4. The modal shows:
   * Heading: AI Department Recommendation
   * Detected department: IT (Software) or Service (Hardware)
   * Explanation: Clear sentence explaining why this was chosen
   * Switch button: Allows changing department if desired
   * Confirm button: Saves classification to form state and closes modal
5. If IT is selected:
   * Form label updates: Equipment Name / ID (Optional for IT)
   * Equipment field is no longer required
6. If Service is selected:
   * Form label remains: Equipment Name / ID *
   * Equipment field remains required

## Build plan

1. Step 1: Fix 401 unauthorized issue in ticket service subsystem authentication middleware (Completed).
2. Step 2: Create ticket service migration to make `machine_ID` nullable on `tickets` table.
3. Step 3: Update `TicketController` and `TicketService` to support conditional `machine_ID` validation and nullable persistence.
4. Step 4: Implement `classify-department` endpoint in `AI-service` with Gemini prompt and heuristic fallback.
5. Step 5: Build `AIDepartmentModal` component in `frontend/web/src/components/AIDepartmentModal.jsx`.
6. Step 6: Integrate triage flow into `TicketCreation.jsx` on blur and submit, updating equipment requirement dynamically.
7. Step 7: Verify end to end creation of both IT and Service tickets.
