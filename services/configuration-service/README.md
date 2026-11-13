# Configuration Service

The **Configuration Service** is a dedicated microservice in the Enterprise Ticketing System responsible for managing system-level configurations, specifically third-party service credentials such as transactional email delivery (Brevo, see spec 0040).

## Service Overview

| Attribute | Specification |
| :--- | :--- |
| **Port (Host)** | `8009` |
| **Port (Container)** | `8000` |
| **Framework** | Laravel 11 / PHP 8.2 |
| **Database** | MySQL (`email_configurations` table) |
| **Cache & Queue** | Redis (`capstone-redis:6379`) |
| **Network** | `default`, `shared-capstone-network` |

## Email Provider

Controllers depend on `App\Contracts\EmailProvider`, bound to `App\Services\BrevoService` in `AppServiceProvider`. Brevo is reached through its REST API v3 with an API v3 key (`xkeysib-...`) sent in the `api-key` header.

| Operation | Brevo request |
| :--- | :--- |
| Verify key | `GET https://api.brevo.com/v3/account` (200 = valid) |
| Send email | `POST https://api.brevo.com/v3/smtp/email` with `{sender, to, subject, htmlContent}` |

Before saving a key in production, the sender (domain or address) must be verified in Brevo. If **Authorised IPs** is turned on in the Brevo account, the server's egress IP must be allowed, otherwise verification fails with a message that says so.

## Key Security Invariants

1. **Client-Side RSA Encryption**:
   - Before transmission, API keys are encrypted in the browser using 2048-bit RSA with public keys retrieved from `GET /api/encryption-key`.
   - The encrypted payload is transmitted alongside an `X-Key-Id` header.
   - Decrypted in backend middleware (`DecryptRsaPayload`) using private keys stored in Redis with short TTLs.

2. **Live Brevo Key Validation**:
   - During configuration creation, update, or test sending with a new key, the decrypted API key is validated live against `GET https://api.brevo.com/v3/account`.
   - Brevo SMTP keys (`xsmtpsib-...`), malformed keys, revoked keys and blocked server IPs each return a 422 with a specific, human-readable message.

3. **AES-256 Encryption at Rest**:
   - Brevo API keys are encrypted at rest using Laravel's native `'encrypted'` Eloquent casting backed by the service's `APP_KEY`.
   - The model `$hidden` array guarantees that `api_key` is never serialized into JSON models directly.

4. **Zero Key Exposure & Masking**:
   - Stored keys are strictly masked as `xkeysib-•••••••••` in all API responses.
   - Frontend components, state trees, and DOM inspection never encounter or reveal the plaintext secret once entered.

## API Endpoints

| Method | URI | Description | Auth / Security |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/encryption-key` | Obtains ephemeral RSA public key & key ID | Public |
| `GET` | `/api/email` | Fetches active configuration with masked API key | Admin |
| `POST` | `/api/email` | Creates/replaces email configuration (live validated) | Admin, RSA Decrypt (`apiKey`) |
| `PUT` | `/api/email/api-key` | Updates the Brevo API key (live validated) | Admin, RSA Decrypt (`apiKey`) |
| `DELETE` | `/api/email` | Deactivates the active configuration | Admin |
| `POST` | `/api/email/test` | Dispatches a test email via Brevo, returns `message_id` | Admin, RSA Decrypt (`apiKey` optional) |
| `POST` | `/api/email/dispatch` | Sends an email for another service. Optional `category`: `security` (never skipped by notification channels) or `notification` | Internal token only |
| `POST` | `/api/email/dispatch-event` | Sends a template driven ticket lifecycle email | Internal token only |

*Note: All endpoints are also accessible prefixed with `/configuration/` (e.g. `/api/configuration/email`).*

## Docker Execution

```bash
# Build and start the container
docker compose up -d configuration-service

# Run database migrations
docker compose exec configuration-service php artisan migrate --force

# View logs
docker compose logs -f configuration-service
```
