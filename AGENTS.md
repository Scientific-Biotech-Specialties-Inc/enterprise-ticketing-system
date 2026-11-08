# Enterprise Ticketing System - Agent Guidelines & Governance

Welcome to the **Enterprise Ticketing System** codebase. This file serves as the primary orientation and operating guide for AI coding assistants and developers.

## Repository Overview

This repository is an enterprise-grade, microservice-based IT service desk and ticketing platform:

- **Microservices (`services/`)**:
  - `services/AI-service` (Port 8005): Google Gemini 2.0 Flash automated support assistant, conversation persistence, ticket triage, and fallback ticket escalation.
  - `services/customer-service` (Port 8001): Customer identity, authentication, client profiles, and user management.
  - `services/ticket-service` (Port 8002): Core ticket lifecycle, SLA monitoring, status state machines, and priority management.
  - `services/notification-service` (Port 8003): Real-time Reverb WebSocket broadcasting and transactional email alerts.
  - `services/analytics-service` (Port 8004): CSAT ratings, performance metrics, and reporting.
  - `services/attachment-service` (Port 8006): Attachment storage with mandatory ClamAV antivirus daemon inspection.
  - `services/messaging-service` (Port 8007): Real-time ticket chat messaging backed by MongoDB 7.
  - `services/employee-service` (Port 8008): Staff directory, employee assignment eligibility, and technician workload routing.
  - `services/configuration-service` (Port 8009): System and third-party configuration management (Resend email delivery, RSA cryptography, live credential validation).
- **Frontend (`frontend/web/`)**: React 19 SPA with Vite, Tailwind CSS v4, Lucide icons, and dual-mode runtime (`employee` at `/ticketing/` vs `customer` at `/`).
- **Gateway (`nginx.conf` & `nginx.prod.conf`)**: Nginx reverse proxy routing `/api/*` to corresponding microservice FastCGI or HTTP sockets.
- **Documentation (`docs/`)**: Technical specs and architecture guides (maintained with zero Mermaid diagrams, relying on clear ASCII tables).

## Agent Customizations

AI assistants operating within this repository are configured with specialized rules and skills:

### Rules (`.agents/rules/`)

- [`.agents/rules/coding-standards.md`](.agents/rules/coding-standards.md): Cryptography standards (client-side RSA), ClamAV scanning, thin controllers, and non-blocking Redis cache invalidation.
- [`.agents/rules/70-commits-pull-requests.md`](.agents/rules/70-commits-pull-requests.md): Branch naming rules (`feat/*`, `fix/*`), Conventional Commits, and pull request generation standards.

### Skills (`.agents/skills/`)

- **`github-pr`**: Inspects status, branches from `dev`, enforces commit conventions, and opens reviewable PRs via GitHub CLI (`gh`).
- **`laravel-microservice`**: Scaffolds and modifies Laravel services adhering to migrations, models, thin controllers, Redis caching, and inter-service authentication.
- **`react-frontend`**: Implements UI features in `frontend/web/` honoring dual-mode context, Tailwind v4 design tokens, and client-side RSA encryption.
- **`docker-runbook`**: Executes container commands, database migrations, logs, and ClamAV/Reverb operational checks.
- **`gemini-ai`**: Manages the Google Gemini 2.0 Flash AI support subsystem, conversation persistence, escalation payloads, and direct manual ticket fallback.
- **`api-testing`**: Verifies endpoints across the Nginx gateway and microservices with JWT bearer tokens.
- **`security-audit`**: Inspects code changes, git diffs, and staged commits for secret leaks and verifies compliance with repository security standards.
- **`architect`**: Designs technical solutions, asks clarifying questions, and writes build specifications.
- **`audit`**: Bootstraps repository AI context and AGENTS.md documentation.
- **`check`**: Confirms implementation behavior through verification and code reviews.
- **`debug`**: Identifies root causes of issues and validates minimal bug fixes.
- **`develop`**: Implements features and services from approved specifications.
- **`document`**: Generates pull request descriptions, changelogs, and release notes.
- **`scope`**: Defines product slices and feature tracking in docs/scope/.
- **`sync`**: Reconciles durable knowledge files, scope status, and specification statuses.
- **`test`**: Authors automated test suites for recent changes.

## Inviolable Architectural Invariants

1. **Strictly No Mermaid Diagrams**: All documentation must use markdown tables, ASCII diagrams, or structured text. Never generate Mermaid syntax.
2. **Strictly No Ollama**: AI fallback must degrade directly to manual ticket creation (`escalate: true`). Do not reintroduce local Ollama fallbacks.
3. **No Direct Database Coupling**: Microservices communicate exclusively through REST APIs or event broadcasts. Do not query another microservice's database tables directly.
4. **Client-Side RSA Encryption**: Passwords and sensitive credentials must be encrypted using `frontend/web/src/utils/rsa.js` before network transmission and decrypted with `DecryptRsaPayload` middleware.
5. **Mandatory Antivirus Scanning**: File uploads in `attachment-service` must pass ClamAV daemon verification before being saved to storage.
6. **Non-Blocking Cache Invalidation**: Always use Redis `SCAN` chunking for ticket cache invalidation; never issue blocking `KEYS *`.
7. **Branch Protection**: Never push directly to `dev` or `main`. Always create a typed work branch and open a PR targeting `dev`.

UI & Frontend Design Guardrails (ONE UI Specification)
All frontend engineering and user interface work must strictly follow the rules in `DESIGN.md`. The canonical source of truth is `docs/ONE UI DESIGN.pdf`, representing the unified ONE UI standard across all 4 industry subsystems (CRMS, SERMS, PRS, TS) and the central Auth Module SPA.
Mandatory Rules for AI Agents & Subagents
Always Consult `DESIGN.md` First: Before creating, editing, or evaluating any Vue component, view, dialog, or style in `web-interface/`, AI agents and subagents MUST read and follow `DESIGN.md`. Never invent arbitrary colors, margins, paddings, or component styles.
Canonical Token Adherence:
Primary: `#252578` (Sidebar background, page titles, main CTA buttons, badges)
Accent: `#2E85D8` (Active sidebar border, focus rings, link hovers, notification unread badge)
Brand Deep: `#3A3A85` (Active sidebar link background)
Brand Deep Border: `#4E4E91` (Active sidebar link background border)
Page Background: `#F8F9FA` (Master body, table header backgrounds)
Surface Pure White: `#FFFFFF` (Cards, modals, dropdowns, inputs, top header)
Dark Slate: `#1E293B` (Metric numbers, modal titles, body typography)
Muted Slate: `#8D8B8F` (Subtitles, table cells, helper copy)
Avatar Circle: `#A7A7C8` | Eyebrow/Tracker: `#8086A3` | Table Headers: `#94A3B8`
Strict 8px Spacing Grid: All margins and paddings must use 8px increments (`8px`, `16px`, `24px`, `32px`, `48px`). 4px is reserved exclusively for micro-badges. Arbitrary values (`p-[13px]`, `m-[7px]`) are strictly prohibited.
Component Primitive Architecture:
Base UI components must exclusively use shadcn-vue (Radix Vue headless primitives styled with Tailwind CSS).
Icons must exclusively be sourced from Lucide Icons (`lucide-vue-next`).
Tailwind Version Pinning: `web-interface` uses Tailwind 3.4. Do NOT upgrade to Tailwind v4 and do not use Tailwind v4 CSS syntax in the frontend SPA.
Bifurcated Loading States:
Skeleton Loaders: Mandatory for all data fetching and layout rendering (metric cards, activity tables, ranking views, schedule cards, profile shells).
Spinner Graphics (`Loader2`): Reserved exclusively for action triggers, button submissions, login/logout transitions, and file upload progress.
Badge Semantics: Status badges must use Title Case (`Active`, `Pending`, `Approved`, `Rejected`), never all-caps. Maintain a single visual tier (bordered or low-emphasis) per table column.
Figma MCP Integration: AI agents must utilize the local Figma MCP server (`figma-dev-mode-mcp-server`) with canonical project PRS Figma Component Library to inspect nodes, verify measurements, check variants, and extract exact assets whenever designing UI.
Proper Subagent Delegation for UI Tasks
When coordinating UI development, AI orchestrators must route tasks to the appropriate specialized subagents:
`@ui-designer`: Visual design specifications, color/typography token audits, Figma MCP node inspections, interaction state definitions (hover, active, disabled), and accessibility checks.
`@frontend-developer`: Vue 3 SPA implementation (`web-interface/src/`), TypeScript typing, shadcn-vue integration, Tailwind 3.4 styling, router navigation, and reactive state management adhering to `DESIGN.md`.
`@architect-reviewer`: Gateway route integration, API contract consistency, cross-subsystem auth token validation, and SPA architectural reviews.
`@code-reviewer`: Pre-commit / pre-PR compliance audits checking that UI changes strictly adhere to `DESIGN.md` guardrails (no arbitrary styles, correct loading patterns, strict tokens).
`@qa-expert`: Form validation testing, confirmation modal workflow checks, toast auto-dismiss verification, and responsive viewport audits.
