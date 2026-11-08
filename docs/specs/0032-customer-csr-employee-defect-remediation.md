# 0032 Customer, CSR and employee defect remediation

**Status**: In Progress
**Mode**: ENHANCEMENT
**Date**: 2026-11-06
**Related**: 0010 (reassignment and eligibility), 0002 (ticket messaging), 0021 (security hardening)

## Summary

Twelve defects were reported across the customer, CSR and employee flows. Four are already fixed in code (marked Done). One is partly fixed. The rest need a short build, and three of them needed a product decision, which you made (see Decisions).

## Decisions made with you

| Topic | Decision | Why |
|---|---|---|
| Resolve on an On Hold internal ticket | Resume then resolve in one user action | Keeps the state machine rule (On Hold cannot jump to Resolved) and still gives users a working button. |
| Session expiry | Access token 30 minutes, refresh cookie 14 days, no idle logout | Smallest change that ends the one year token. Idle logout can be added later. |
| Reassignment requests | Go to the CSR who delegated the ticket, with same branch CSRs as fallback | A CSR in another branch should never see another branch's request. |

## Requirements and status

| # | Defect | Root cause (proven or suspected) | Status |
|---|---|---|---|
| 1a | No token expiration | Proven: `AuthServiceProvider` never set a Passport lifetime, so tokens lasted one year. | Done: `PASSPORT_ACCESS_TOKEN_TTL_MINUTES`, default 30. |
| 1b | Back button twice after login | Suspected: the back trap in `PrivateRoute.jsx` pushes one history entry per pop, so rapid presses can reach the login page. Needs a browser run to confirm. | Open |
| 1c | Tokens after logout | Server revokes tokens in `AuthController::logout`. Needs a check that a revoked token returns 401 on downstream services. | Done: verified on the live stack. After logout the customer service and ticket service both return 401 for the old token. |
| 1d | Logout should land on the Landing Page | `SidebarBase.jsx` already redirects to `BASE_URL`. Needs a browser run to confirm. | Open (verify) |
| 2 | Reassignment routed to non delegator | Proven: `notifyCS` messaged every CSR, and `listRequests` showed all requests to every CSR. | Done: delegator first, branch fallback, pending queue filtered. |
| 3 | Ticket acceptance invalid for external ticket | Not yet localized. | Open |
| 4 | XSS in internal ticket description | Proven: `TicketService::updateTicket` saved the description with `trim()` only (the title was already stripped). | Done: `strip_tags` on compare and save. |
| 5 | Resolve button dead on On Hold | Proven: the state machine rejects On Hold to Resolved and the UI shows no error. | Done: the CS Resolve button resumes a held ticket first, then resolves it, and shows an error if either step fails (`CSModals.jsx`). The resume then resolve runs as two calls from the browser, not one backend transaction. |
| 6 | 504 on internal ticket status change | Suspected: emails are sent inside the request (`dispatchEmail` uses a 6 second timeout, 3 retries, then an SMTP fallback). No 504 appears in the gateway log, so it is not reproduced. | Done: customer emails now go out after the response and never inside the database transaction. Internal tickets no longer notify customer #1. A rejected transition now returns 422 instead of a false 200. Measured 4.08s before, 0.91s after. |
| 7 | AI Chat history button and ticket number display | Not yet localized. | Done: `RagService.php` had a stray brace (from `eda51df`) that crashed the AI service with a 500. The AI conversations call now returns 200 for a CSR. The sidebar and header now use the real ticket number. |
| 8 | Scanning indicator on plain text messages | Not yet localized. | Done: the "Scanning file for malware" line shows only when files are attached (`MessagingPage.jsx`). |
| 9 | Notification "Assign" does nothing | Not yet localized. | Done: the notification modal had no `onAssign`, so Assign only closed it. It now opens the assignment modal on the Incoming page. |
| 10 | No past ticket for reassigned ticket | Not yet localized. | Open |
| 11 | File missing after customer edit removes it | Not yet localized. | Not reproduced. Needs a browser run of the edit and remove file flow. |
| 12 | External ticket attachment not visible | Not yet localized. | Not reproduced: the API returns the file to both CSR and the assigned employee, and `/storage` serves it on all three origins. Needs a browser run. |

## Decision

Build the open items in this order, each as its own small change so it can be checked alone:

1. Security first: confirm item 1c, then 1b and 1d in a browser.
2. Item 5: add a `resolveFromHold` action in the ticket service that resumes and then resolves inside one database transaction, writes both audit entries, and returns one response. The frontend Resolve button calls it only when the status is On Hold.
3. Item 6: move email sending out of the request using `dispatch(...)->afterResponse()` (or the existing queue worker), and drop the retry. Do this only after a reproduction shows the emails are the cause.
4. Items 11 and 12: treat together. Both are attachment visibility. Check the bind call in `createInternalTicket` and ticket creation (`Http::post` to `attachment-service/api/bind`, with no timeout and its failure only logged) and the ticket edit path that removes a file.
5. Items 9, 7, 8, 10, 3: frontend and routing fixes, each localized first.

## Consequences

- Access tokens now expire after 30 minutes. The frontend refresh flow handles this, but any caller that stores a token for longer will need to refresh.
- Pending reassignment requests are hidden from CSRs who did not delegate the ticket. Admins still see all.
- `strip_tags` on the description means a legitimate `<` in text may be cut. This matches how the create path already behaves.

## Follow-up

- Add regression tests (hand to /test): token expiry, description tag stripping, reassignment routing for two CSRs in two branches.
- Notification and broadcast text on the create path still uses the raw title (`TicketService::createInternalTicket`). Switch it to the stripped title.
- Run `php artisan config:clear` in `customer-service` after setting the new env variable.
