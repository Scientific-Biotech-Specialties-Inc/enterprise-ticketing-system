# 0043. Rationale: customer ticket intake, department codes, and queue display fixes

## Context

Nine defects were reported on 2026-11-14 across the customer intake flow, superadmin configuration, feedback, and CS queues. Diagnosis of the current code:

- **Serial and null machine.** `TicketReviewModal` (`AISupportPage.jsx`) builds its data from `ticketOptions`, which loads in a separate effect. Opened early, `resolveRegisteredMachine` sees an empty list and returns null. The modal's reset effect then wipes any later value. `/create-ticket` reapplies prefill whenever `options.problem_categories` changes. Neither surface shows the serial on its own.
- **Title.** When Gemini sends no title, `generateRealReviewData` falls back to the customer's first non greeting message, often a bare machine name or the first words of a sentence. AI-service `IntakeTitleBuilder` only covers numbered intake answers.
- **Department code.** `departments` (employee-service) has no code. The ticket number takes one global `deptCode` from number format config. `CreateTicketAction` and `TicketService` hardcode `IT` and `SVC` by name match, with a first 4 letters fallback. No superadmin screen creates departments.
- **Category and equipment.** Problem categories were consolidated to Software and Service (migration `2026_11_13_000002`). Customers still pick the category freely. `TicketCreation.jsx` derives the department with `includes('it')`, which matches unrelated words. The AI modal never sends `department_id`, so the server defaults to IT. Customer `PATCH /tickets/{id}` accepts any existing `machine_ID` without an ownership check. Nothing marks a machine as Software eligible.
- **Feedback.** Question groups are hardcoded `IT / Service / Others` in the frontend and configuration-service, and both fall back to `IT`. IT is no longer a problem category.
- **Drafts.** `CreateTicketAction` broadcasts `created` for every customer ticket, draft or not, so the gap is on a path not yet identified. It needs reproduction.
- **Customer edit.** Save Changes calls `PATCH /tickets/{id}`. The failure is not visible statically and needs reproduction.
- **Multi assignee.** `CSAssigned.jsx` renders `assigned_employees` chips. CS Incoming and the summary modal show one assignee, and the optimistic multi assign update writes a single one.
- **My Tickets.** One "All Tickets" tab mixes active work with closed tickets awaiting feedback. History holds the rest.

Constraints: microservices own their tables but share one database (spec 0026). Category drives SLA, routing, and now the ticket number. Customers must not be able to influence routing by editing requests.

## Options considered

### Category authority

**Option 1: AI decides on the server, CS corrects (chosen).** ticket-service calls the classifier on create and ignores client category. Failures go in unclassified.
- Pros: one trustworthy source, tamper proof, matches the engineer's operating model.
- Cons: creation depends on AI-service latency, nullable category ripples through readers, customers cannot fix a wrong pick.

**Option 2: AI preselects, customer may change.** Today's create page behavior, extended to the AI modal.
- Pros: no nullable column, customers self correct.
- Cons: customers can route tickets anywhere through the API, so category based SLA and codes stay unreliable.

### Equipment eligibility for Software tickets

**Option 1: Software tickets carry no equipment (chosen).**
- Pros: no new data to maintain, deterministic, easy to enforce on the server.
- Cons: a software issue tied to one unit's embedded software loses the machine link.

**Option 2: `ticket_scope` flag on `machine_categories`.**
- Pros: precise per equipment type.
- Cons: needs a management UI nobody has today, and the default would list no machines for Software.

**Option 3: AI judges machine fit.**
- Cons: not deterministic, hard to test or audit.

### Department code storage

**Option 1: `code` column on `departments`, per ticket department (chosen).**
- Pros: real per department numbers, a unique index guarantees no clash, lives with the owner (employee-service).
- Cons: a cross service read of `departments.code` by ticket-service (allowed under spec 0026).

**Option 2: keep one global code, auto suggested.**
- Pros: no schema change.
- Cons: every ticket gets the same code, so the segment says nothing about the department.

### Fix shape

**Option 1: fix in place, one umbrella spec (chosen).** **Option 2: nine separate specs.** Separate specs would repeat the same files (`AISupportPage.jsx`, `TicketCreation.jsx`, `CreateTicketAction`) and the category decision underlies four of the fixes, so one spec keeps them consistent. Con: a larger PR, mitigated by slicing.

## Rationale

The engineer chose AI as the category authority with CS as the fallback. Given that, letting the client send a category would keep the old tampering hole, so classification has to run on the server, with the form showing only a preview. That forces `problem_category_ID` to be nullable. The safe alternative of a placeholder "Unclassified" category row was weighed. NULL was preferred because a fake category would silently match SLA rules and feedback sets and pass assignment checks, whereas NULL makes every reader handle the state on purpose (AC-21) and lets the assign endpoint enforce the gate.

"Software means no equipment" follows from the same model: once the AI owns category, a per machine eligibility flag would need data nobody maintains. Leaving out the department segment for unclassified tickets keeps numbers permanent. Assigning a provisional code would either be wrong after reclassify or force renumbering, which breaks references in emails and chat.

Department codes live on `departments` because employee-service owns that table. The suggestion rule runs on the server only, so the client preview and the stored value can never disagree. Keeping `IT` and `SVC` in the backfill preserves continuity with numbers customers already hold.
