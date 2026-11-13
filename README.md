# Enterprise Ticketing System

An enterprise-grade, distributed microservices IT service desk and support platform designed for multi-tenant customer ticket management, SLA monitoring, live chat messaging, automated AI triage, and predictive analytics.

---

## Architecture Overview

The system is architected as an event-driven, decoupled microservices suite fronted by an Nginx reverse proxy gateway and a dual-mode React 19 Single-Page Application (SPA).

```
                          +------------------------------------------+
                          |        Client Browsers / SPAs            |
                          |  Customer Mode (5006) / Employee (5005)  |
                          +--------------------+---------------------+
                                               |
                                               v
                          +--------------------+---------------------+
                          |           Nginx API Gateway              |
                          |      (Port 80 HTTP / 443 HTTPS)          |
                          +----+---------------+---------------+-----+
                               |               |               |
        +----------------------+               |               +----------------------+
        | /api/ticketing/customer              | /app/*, /messaging-app/*             | /api/ticketing/ticket
        v                                      v                                      v
+------------------+                 +-------------------+                  +------------------+
| customer-service |                 |   Laravel Reverb  |                  |  ticket-service  |
| (Auth, Clients,  |                 | (WebSockets: 6001 |                  | (Core Tickets,   |
|  Identities)     |                 |  & 6002 Messaging)|                  |  SLAs, Audits)   |
+--------+---------+                 +---------+---------+                  +--------+---------+
         |                                     |                                     |
         +-----------------+                   |                   +-----------------+
                           |                   |                   |
                           v                   v                   v
                    +-----------------------------------------------------+
                    |           Infrastructure & Shared Services          |
                    |  - MySQL 8 (Relational DB on 3306)                  |
                    |  - Redis 7 (Cache, Queue, Pub/Sub on 6379)          |
                    |  - MongoDB 7 (Chat & Message Store on 27017)        |
                    |  - ClamAV (Antivirus Socket Daemon on 3310)         |
                    |  - attachment-service (Scanned File Storage: 8006)  |
                    |  - analytics-service (CSAT & Predictions: 8004)     |
                    |  - AI-service (Gemini 2.0 Flash LLM Support: 8005)  |
                    |  - employee-service (Staff & Routing: 8008)         |
                    |  - configuration-service (System Keys & Config: 8009|
                    |  - notification-service (Email & Push: 8003)        |
                    +-----------------------------------------------------+
```

---

## Microservices Breakdown

| Service | Port | Primary Purpose & Technologies |
| :--- | :--- | :--- |
| **`customer-service`** | `8001` | Customer identity, OAuth2 / JWT authentication, client management, polymorphic auth provider. |
| **`ticket-service`** | `8002` | Core ticket lifecycle state machine, SLA calculation, priority management, audit logging. |
| **`notification-service`** | `8003` | Real-time Reverb WebSocket dispatching (`:6001`) and transactional email delivery (Brevo API / SMTP). |
| **`analytics-service`** | `8004` | Customer satisfaction (CSAT) surveys, SLA compliance reporting, and predictive volume metrics. |
| **`AI-service`** | `8005` | Google Gemini 2.0 Flash AI assistant, conversation persistence, sentiment triage, and direct fallback escalation. |
| **`attachment-service`** | `8006` | File upload handling with mandatory ClamAV antivirus inspection (`:3310`) prior to storage. |
| **`messaging-service`** | `8007` | Real-time two-way ticket chat messages backed by MongoDB 7 and dedicated Reverb WebSockets (`:6002`). |
| **`employee-service`** | `8008` | Staff directory, department hierarchy, role-based workload routing, and assignment eligibility. |
| **`configuration-service`** | `8009` | Central configuration management, RSA public/private key pairs, and live third-party service credential testing. |

---

## Frontend Application

The frontend is a modern **React 19** Single-Page Application located in `frontend/web/`:
* **Customer Portal** (`/`): Ticket submission, real-time ticket tracking, AI support chat, customer-facing file attachments, CSAT surveys.
* **Employee / Support Portal** (`/ticketing/`): Workload dashboard, SLA tracking queues, staff assignment, ticket triage, internal messaging.
* **Security**: Client-side RSA payload encryption (`src/utils/rsa.js`) ensures credentials are encrypted in-browser before HTTP transmission.

---

## Documentation Navigation

Detailed domain specifications and operational guides are organized in the [`docs/`](docs/) directory:

| Document | Description |
| :--- | :--- |
| **[Architecture Guide](docs/architecture.md)** | System topology, microservice boundaries, synchronous vs. asynchronous data flows, and Nginx gateway routing. |
| **[Tech Stack Reference](docs/tech-stack.md)** | Comprehensive inventory of backend runtimes, frontend libraries, databases, caching layers, and protocols. |
| **[Docker & DevOps](docs/docker.md)** | Docker Compose orchestration, dev vs. prod configurations, networks, volumes, environment variables, and tuning. |
| **[Business Rules & Workflows](docs/business-rules.md)** | Complete ticket lifecycle state machine, SLA calculation rules, escalation paths, RBAC matrix, and proof-of-work logic. |
| **[Security Architecture](docs/security.md)** | End-to-end RSA client-side payload encryption, OAuth2 public-key token verification, ClamAV antivirus pipelines, and rate limiting. |
| **[API & Event Contracts](docs/api-contracts.md)** | Nginx reverse proxy routing rules, REST API endpoint definitions per microservice, and WebSocket channels. |
| **[Database Schema & State](docs/database-schema.md)** | Relational MySQL 8 data structures, MongoDB 7 chat storage, and Redis caching key patterns and invalidation strategies. |
| **[Implementation Plan & Roadmap](docs/implementation-plan.md)** | Current subsystem maturity assessment, future roadmap, and standard feature lifecycle. |
| **[Troubleshooting & Operations Runbook](docs/troubleshooting.md)** | Step-by-step diagnostic workflows for container connection drops, ClamAV timeouts, Reverb WebSocket issues, and Nginx 502s. |
| **[AI Developer Guidelines](docs/ai-guidelines.md)** | Core invariants, coding conventions, testing expectations, and anti-patterns for AI pair programmers and human engineers. |

---

## Quickstart Guide

### Prerequisites
* **Docker Engine** 24.0+ and **Docker Compose** v2.20+
* **Git**
* **Node.js** 20+ (optional, for standalone frontend development)
* **PHP** 8.2+ & **Composer** 2.6+ (optional, for direct local microservice development)

### Running with Docker Compose

1. **Clone the repository:**
   ```bash
   git clone <repo-url> enterprise-ticketing-system
   cd enterprise-ticketing-system
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

3. **Spin up all containers:**
   ```bash
   docker compose up -d --build
   ```

4. **Verify container health:**
   ```bash
   docker compose ps
   ```

5. **Access the application:**
   * **Customer Portal**: [http://localhost/](http://localhost/) (or dev direct: [http://localhost:5006/](http://localhost:5006/))
   * **Employee / Support Portal**: [http://localhost/ticketing/](http://localhost/ticketing/) (or dev direct: [http://localhost:5005/](http://localhost:5005/))
   * **API Gateway Entrypoint**: [http://localhost/api/ticketing/](http://localhost/api/ticketing/)

---

## Repository Structure

```
.
├── .agents/                    # Agent guidelines, rules, and governance
│   └── rules/                  # Repository coding standards & PR workflow rules
├── docs/                       # Technical & architectural documentation suite
├── frontend/
│   └── web/                    # Single-Page React 19 application (Customer & Employee modes)
├── services/
│   ├── AI-service/             # Gemini 2.0 Flash AI assistant & triage microservice
│   ├── analytics-service/      # CSAT feedback and predictive metrics microservice
│   ├── attachment-service/     # File uploads, ClamAV antivirus quarantine & storage
│   ├── configuration-service/  # RSA key rotation & system configuration microservice
│   ├── customer-service/       # Auth, OAuth2 server, client provisioning, customer accounts
│   ├── employee-service/       # Staff directory, assignment eligibility & routing microservice
│   ├── messaging-service/      # Real-time chat microservice backed by MongoDB & Reverb
│   ├── notification-service/   # Email and notification distribution microservice
│   └── ticket-service/         # Core ticketing engine, SLA tracking & audit logging
├── docker-compose.yml          # Local development container orchestration
├── docker-compose.prod.yml     # Production container orchestration
├── nginx.conf                  # Nginx API Gateway configuration (Development)
├── nginx.prod.conf             # Nginx API Gateway configuration (Production)
├── deploy-prod.sh              # Production deployment automation script
└── production-optimize.sh      # Production artisan caching and performance tuning script
```

---

## AI Agent Quick Task Map

When working on specific feature areas or bugfixes, reference this quick map to locate the relevant source code:

| Engineering Task | Primary Backend Files | Primary Frontend Files | Key Directives |
| :--- | :--- | :--- | :--- |
| **Authentication & Tokens** | `services/customer-service/app/Http/Controllers/AuthController.php`<br/>`services/ticket-service/app/Http/Middleware/AuthenticateSubsystem.php`<br/>`services/customer-service/app/Http/Middleware/DecryptRsaPayload.php` | `frontend/web/src/pages/Loginpage.jsx`<br/>`frontend/web/src/utils/rsa.js`<br/>`frontend/web/src/api/axiosInstance.js` | Never transmit unencrypted passwords. Respect dual-token validation. |
| **Ticket Lifecycle & SLAs** | `services/ticket-service/app/Http/Controllers/TicketController.php`<br/>`services/ticket-service/app/Services/SLAService.php`<br/>`services/ticket-service/app/Http/Controllers/SLARuleController.php` | `frontend/web/src/pages/MyTickets.jsx`<br/>`frontend/web/src/pages/EmployeeMyTickets.jsx`<br/>`frontend/web/src/pages/CSIncoming.jsx` | Invalidate Redis cache on updates via `SCAN`. Broadcast `TicketChanged`. |
| **Employee & Staff Routing** | `services/employee-service/app/Http/Controllers/EmployeeController.php`<br/>`services/employee-service/app/Http/Controllers/DepartmentController.php` | `frontend/web/src/pages/AdminEmployees.jsx`<br/>`frontend/web/src/components/AssignTicketModal.jsx` | Verify employee assignment eligibility and department workloads. |
| **File Uploads & Antivirus** | `services/attachment-service/app/Http/Controllers/AttachmentController.php`<br/>`services/attachment-service/app/Services/ClamAVScanner.php` | `frontend/web/src/components/FilePreviewModal.jsx` | Stream to ClamAV (port 3310) before saving. Max size 15MB. |
| **Live Chat & Messaging** | `services/messaging-service/app/Http/Controllers/MessageController.php`<br/>`services/messaging-service/app/Models/Message.php` | `frontend/web/src/pages/MessagingPage.jsx` | Store in MongoDB `messages`. Broadcast over Reverb (port 6002). |
| **AI Support & Escalation** | `services/AI-service/app/Http/Controllers/GeminiChatController.php`<br/>`services/AI-service/app/Services/GeminiService.php` | `frontend/web/src/components/AIChatModal.jsx` | Use Gemini 2.0 Flash. Fallback strictly to manual ticket creation (`escalate: true`). |
| **Predictive Analytics & CSAT** | `services/analytics-service/app/Http/Controllers/PredictiveAnalyticsController.php`<br/>`services/analytics-service/app/Http/Controllers/FeedbackController.php` | `frontend/web/src/pages/PredictiveAnalytics.jsx`<br/>`frontend/web/src/pages/AdminReports.jsx` | Read from local analytics MySQL tables. Render via Chart.js. |
| **System Configuration & Keys** | `services/configuration-service/app/Http/Controllers/EmailConfigurationController.php`<br/>`services/configuration-service/app/Services/BrevoService.php` | `frontend/web/src/pages/AdminSettings.jsx` | Validate credentials against live APIs. Protect RSA private keys. |
| **Gateway & Reverse Proxy** | `nginx.conf`<br/>`nginx.prod.conf` | N/A | Maintain route parity between dev and prod configurations. |

