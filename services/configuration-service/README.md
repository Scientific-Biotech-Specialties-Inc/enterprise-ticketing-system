# Configuration Service

The **Configuration Service** is a dedicated microservice in the Enterprise Ticketing System responsible for managing system-level configurations, specifically third-party service credentials such as email delivery (strictly Resend).

## Service Overview

| Attribute | Specification |
| :--- | :--- |
| **Port (Host)** | `8009` |
| **Port (Container)** | `8000` |
| **Framework** | Laravel 10 / PHP 8.2 |
| **Database** | MySQL (`email_configurations` table) |
| **Cache & Queue** | Redis (`capstone-redis:6379`) |
| **Network** | `default`, `shared-capstone-network` |

## Key Security Invariants

1. **Client-Side RSA Encryption**:
   - Before transmission, API keys are encrypted in the browser using 2048-bit RSA with public keys retrieved from `GET /api/encryption-key`.
   - The encrypted payload is transmitted alongside an `X-Key-Id` header.
   - Decrypted in backend middleware (`DecryptRsaPayload`) using private keys stored in Redis with short TTLs.

2. **Live Resend Ping Validation**:
   - During configuration creation, update, or test sending, the decrypted API key is validated live against the official Resend API (`GET https://api.resend.com/api-keys`).
   - If the key is invalid or revoked, Resend's 401/403 triggers a 422 Unprocessable Entity response with a human-readable validation error.

3. **AES-256 Encryption at Rest**:
   - Resend API keys are encrypted at rest using Laravel's native `'encrypted'` Eloquent casting backed by the service's `APP_KEY`.
   - The model `$hidden` array guarantees that `api_key` is never serialized into JSON models directly.

4. **Zero Key Exposure & Masking**:
   - Stored keys are strictly masked as `re_•••••••••` in all API responses.
   - Frontend components, state trees, and DOM inspection never encounter or reveal the plaintext secret once entered.

## API Endpoints

| Method | URI | Description | Auth / Security |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/encryption-key` | Obtains ephemeral RSA public key & key ID | Public |
| `GET` | `/api/email` | Fetches active configuration with masked API key | Authenticated |
| `POST` | `/api/email` | Creates/replaces email configuration (live validated) | RSA Decrypt (`apiKey`) |
| `PUT` | `/api/email/api-key` | Updates Resend API key (live validated) | RSA Decrypt (`apiKey`) |
| `DELETE` | `/api/email` | Deletes the active configuration | Authenticated |
| `POST` | `/api/email/test` | Dispatches a test email via Resend API | RSA Decrypt (`apiKey` optional) |

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
