# Technology Stack & Dependency Matrix

This document provides a comprehensive inventory of all programming languages, runtimes, frameworks, client libraries, databases, and infrastructural components utilized across the **Enterprise Ticketing System**.

---

## Technology Matrix Overview

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Backend Runtime** | PHP | `8.2+` | Core server-side runtime for all 8 microservices |
| **Backend Framework** | Laravel Framework | `10.x / 11.x` | Enterprise MVC application framework |
| **Identity / OAuth** | Laravel Passport | `11.x / 12.x` | OAuth2 server and JWT token issuer |
| **WebSockets Server** | Laravel Reverb | `1.x` | High-performance real-time WebSocket server |
| **Relational Database** | MySQL | `8.0` | Primary ACID database for relational business entities |
| **Document Database** | MongoDB | `7.0.14` | High-throughput document store for real-time chat messages |
| **Cache & Queue** | Redis | `7.x` | Key-value store for queues, sessions, and query caching |
| **Antivirus Engine** | ClamAV | `stable` | Daemon-based malware and virus scanning engine |
| **API Gateway / Proxy**| Nginx | `alpine` | Reverse proxy, FastCGI translator, and WebSocket multiplexer |
| **Frontend Runtime** | Node.js | `20.x LTS` | Build and tooling environment for the frontend |
| **Frontend Framework**| React | `19.2.6` | Modern component-based UI library |
| **Build Tool** | Vite | `8.0.10` | Next-generation frontend bundler and dev server |
| **Styling** | Tailwind CSS | `4.3.0` | Utility-first responsive CSS framework |
| **Icons** | Lucide React | `1.21.0` | Clean, modern SVG icon set |
| **Charts & Metrics** | Chart.js / React-Chartjs-2 | `4.5.1 / 5.3.1`| Interactive analytics and reporting visualizations |
| **WebSockets Client** | Laravel Echo / Pusher-js | `1.11.0 / 8.0.0`| Real-time event subscriber for frontend components |
| **Client Encryption** | JSEncrypt | `3.5.4` | Client-side RSA payload encryption prior to HTTP transit |
| **PDF & Export** | jsPDF / html2canvas | `4.2.1 / 1.4.1` | Client-side PDF export for tickets and work logs |

---

## Backend Infrastructure Details

### 1. PHP & Laravel Framework Ecosystem
* **PHP 8.2**: Utilizes modern PHP features including typed class properties, match expressions, union/intersection types, readonly classes, and JIT compilation.
* **Laravel Framework**:
  * **Eloquent ORM**: Data abstraction for relational models with relationships, scopes, and query caching.
  * **Database Migrations**: Version-controlled relational database schema changes across services.
  * **Queue Workers**: Asynchronous job handling utilizing the Redis queue driver (`php artisan queue:work redis`).
  * **Event Broadcasting**: Broadcasting events (`TicketChanged`, `MessageSent`) to WebSocket channels via Redis and Reverb.

### 2. Microservice Database Drivers
* **MySQL 8 (`pdo_mysql`)**:
  * Character set: `utf8mb4_unicode_ci` for full multilingual and emoji support.
  * InnoDB storage engine with foreign keys, compound indexes, and ACID transaction guarantees.
* **MongoDB (`mongodb/laravel-mongodb`)**:
  * Driver: PHP `ext-mongodb` with Laravel Eloquent bridge.
  * Connection URI: `mongodb://root:secret@mongodb:27017/ticketing_messaging?authSource=admin`.
* **Redis (`phpredis` / `predis`)**:
  * Persistent caching with prefix isolation (`laravel_cache`).
  * Asynchronous queue processing and WebSocket message brokering.

---

## Frontend Web Architecture

The frontend application (`frontend/web`) is a unified, reactive Single Page Application (SPA) designed with a multi-mode configuration:

```
+--------------------------+
|  Vite 8 Build Pipeline   |
|     (frontend/web)       |
+------------+-------------+
             |
             v
+--------------------------+
| Single React 19 Bundle   |
+------------+-------------+
             |
             +---> [VITE_APP_MODE=employee] --> Port 5005 (Base Path: /ticketing/)
             |
             +---> [VITE_APP_MODE=customer] --> Port 5006 (Base Path: /)
```

### Key Frontend Libraries & Tools
1. **React 19 (`react`, `react-dom`)**:
   * Uses modern React hooks (`useState`, `useEffect`, `useContext`, `useCallback`, `useMemo`).
   * React Router v7 (`react-router-dom`) for declarative client-side routing.
2. **Tailwind CSS v4 (`@tailwindcss/postcss`)**:
   * Modern v4 CSS-first configuration using `@import "tailwindcss";`.
   * High-contrast design palette tailored for enterprise dashboards and dark/light modes.
3. **Cryptographic Security (`jsencrypt`)**:
   * Implements client-side asymmetric RSA encryption.
   * Passwords and sensitive OTP credentials are encrypted in the browser before being transmitted across the wire.
4. **Real-Time Client (`laravel-echo`, `pusher-js`)**:
   * Configured to connect directly through the Nginx reverse proxy via secure WebSockets (`wsHost: window.location.hostname`, `wsPort: 80` or `443`).
   * Subscribes to private and presence channels for ticket status updates and live messaging threads.
5. **Data Visualization (`chart.js`, `react-chartjs-2`)**:
   * Renders predictive analytics metrics, CSAT scores, equipment risk charts, and technician productivity trends.

---

## Development vs. Production Differences

| Feature | Local Development | Production Environment |
| :--- | :--- | :--- |
| **PHP Execution** | `php artisan serve` (Port 8000 per container) | `php-fpm` (FastCGI Port 9000, optimized workers) |
| **Frontend Serving** | Vite Dev Server with HMR (Ports 5005 & 5006) | Multi-stage Nginx static build (`dist/` container) |
| **Configuration Caching** | Dynamically loaded on each request | Baked via `php artisan config:cache`, `route:cache` |
| **File Upload Storage** | Docker local volume mount | Persistent mapped block storage |
| **Container Networking**| Port exposure on host for debug (`8001`-`8007`) | Internal bridge network only; ingress via Port 80/443 |
