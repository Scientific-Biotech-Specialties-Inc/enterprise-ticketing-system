---
name: security-audit
allowed-tools: Bash, Read, Grep, Glob, Write, Edit, Agent, AskUserQuestion
description: "Run /security-audit to inspect code changes, git diffs, and staged commits for secret leaks and verify compliance with repository security standards."
---

## Output style (plain words, no dashes, no hyphens)

<!-- OUTPUT-STYLE:START -->
Write everything this skill produces, files and messages alike, in plain simple language. Talk to the reader as `you`, warm and direct like a colleague, and present every step as a recommendation they may run or skip, never an order. Keep technical terms that carry real meaning; explain each in plain words. Never use a dash or a hyphen as punctuation: no em dash, no en dash, and no hyphenated compounds. Write `read only`, not `read-only`. Say it in simple words, or reword the sentence. Code, file paths, command flags, and values other skills match on keep their hyphens. Use short sentences, commas, or parentheses. Clear beats clever.
<!-- OUTPUT-STYLE:END -->

## What this skill does

The security auditor agent inspects code changes, diffs, untracked files, and pull requests to ensure:

1. No secrets, credentials, API keys, tokens, or private certificates are exposed.
2. Code strictly adheres to the repository architectural invariants and security standards.
3. Temporary runtime logs and build artifacts are not committed to source control.

Run `/security-audit` before committing changes, before opening a pull request, or whenever modifying authentication, file uploads, routes, caching, or inter service logic.

## The security checklist

Whenever invoked, the auditor reviews changes against these core standards:

### 1. Secret and credential leakage check
* Search all added lines for hardcoded passwords, tokens, API keys, private keys, and connection strings.
* Confirm that configuration values rely on environment variables and Laravel `config(...)` helpers rather than literal values.
* Ensure bearer tokens are extracted dynamically from incoming requests (`$request->bearerToken()`) when forwarding calls between services.

### 2. Antivirus scanning on file uploads
* Verify that file uploads in `attachment-service` stream content directly through the ClamAV daemon (`capstone-clamav:3310`) prior to persistence.
* Check frontend upload handlers to ensure forms block submission or saving while an antivirus scan is in progress.
* Verify infected or quarantined uploads are rejected immediately.

### 3. Client side cryptography and backend decryption
* Confirm that plaintext user passwords or sensitive credentials are never transmitted over plain HTTP.
* Verify frontend login and credential payloads call `encryptPayload()` using the RSA public key in `frontend/web/src/utils/rsa.js`.
* Confirm backend credential ingestion routes apply the `decrypt.rsa` middleware (`App\Http\Middleware\DecryptRsaPayload`).

### 4. Downstream authorization and token verification
* Verify downstream microservice routes are protected by `auth.subsystem` or `AuthenticateSubsystem` middleware.
* Ensure caller identity is verified against the shared public key (`storage/oauth-public.key`).

### 5. Microservice boundary isolation
* Confirm microservices communicate strictly through HTTP REST endpoints or real time Reverb WebSockets.
* Ensure no service directly queries or writes to another service database tables.

### 6. Non blocking cache invalidation
* Check cache invalidation code in `TicketCacheService.php` or controller classes.
* Verify that Redis key scanning strictly uses non blocking `SCAN` chunking with cursors. Blocking `KEYS *` commands are strictly forbidden.

### 7. SQL injection prevention
* Verify all database queries use Eloquent query builder parameter bindings rather than raw string concatenation.

### 8. Log and repository hygiene
* Verify temporary runtime log modifications (such as `laravel.log`) are discarded before committing.

## Audit execution procedure

When you run `/security-audit`, execute the following workflow:

### Phase 1: Inspect change scope
1. Run `git status --short` to identify all staged, unstaged, and untracked files.
2. Run `git diff` and `git diff --cached` to collect the exact lines introduced.
3. If specific files were modified in `storage/logs/`, recommend reverting them so diagnostic logs are not tracked.

### Phase 2: Search for sensitive patterns
Run pattern searches across the diff looking for keywords:
* `password`
* `secret`
* `api_key`
* `private_key`
* `Bearer`
* `BEGIN RSA PRIVATE KEY`
* `BEGIN OPENSSH PRIVATE KEY`

For each match, verify whether it is a legitimate variable name, configuration lookup, dynamic header forward, or an accidental secret leak.

### Phase 3: Evaluate security invariants
* For upload routes: verify ClamAV scanning integration.
* For credential routes: verify RSA encryption and decryption.
* For route definitions: verify middleware protection (`auth.subsystem`).
* For cache operations: verify non blocking SCAN chunking.
* For database queries: verify parameter binding.

### Phase 4: Deliver the audit report
Present your findings in a structured, direct format addressing the reader as `you`:
1. **Secret Exposure Verdict**: State clearly whether any credentials or secrets were found.
2. **Standard Compliance Summary**: Break down each security invariant with a clear pass, warning, or fail status.
3. **Recommended Actions**: If any violations or risks exist, list specific remediation steps. If all checks pass, confirm that the code is safe to commit.
