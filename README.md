# Embeddable Widget & Lead-Capture Platform

## Project Overview

The FlyRank Embeddable Widget & Lead-Capture Platform is a multi-tenant backend system designed to allow customers to generate embeddable lead capture forms via a single-line `<script>` tag. The platform is designed to securely accept submissions across origins, enforce validation and anti-spam controls, perform geo-enrichment with provider failover, persist records in PostgreSQL, and trigger asynchronous background side-effects.

## Current Status

**Phase 3A — Dashboard & Lead Management Backend Completed**

Phase 3A is implemented and verified. The platform provides authenticated, tenant-isolated backend APIs for dashboard and lead management: paginated and whitelisted-sorted lead submission inspection, strict widget and half-open date interval filtering (`from`/`to`), single submission detail retrieval with privacy-safe field exposure (visitor IP and user agent omitted), high-performance SQL aggregate statistics (`totalSubmissions`, `today`, `thisWeek`, `thisMonth`, `byWidget`), tenant-scoped background job observability, and widget listing. 141 automated integration tests are passing with a 100% pass rate.

## System Architecture & Specifications

The complete, authoritative system architecture, entity relationship schema, REST API contracts, public submission pipeline, multi-tenancy model, security boundaries, and behavioral test strategies are detailed in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Implemented & planned components:

- **Tenant Management & Authentication (Implemented - Phase 2A)**: Secure JWT-based access for tenant administration with strict repository-level isolation.
- **Relational Storage (Implemented - Phases 2A, 2B, 2C-1, 2C-2, 2C-3)**: PostgreSQL 16 schema with UUIDv4 primary keys, connection pooling, automated migrations (`001_identity_domain.sql`, `002_widget_domain.sql`, `003_submissions_domain.sql`, `004_jobs_domain.sql`), storing tenants, users, widgets, submissions, jobs, and job failure records.
- **Widget Service & Delivery (Implemented - Phase 2B)**:
  - Tenant-scoped CRUD (`POST /api/v1/widgets`, `GET /api/v1/widgets`, `GET /api/v1/widgets/:id`, `PATCH /api/v1/widgets/:id`, `DELETE /api/v1/widgets/:id`).
  - Automatic version tracking on configuration updates.
  - Soft deactivation on delete preserving historical submission integrity.
  - Dynamic embed snippet generation (`<script src="http://localhost:4000/widget.js?id=..."></script>`).
  - Public configuration endpoint (`GET /api/v1/public/widgets/:id/config`) with origin allowlist validation and ETag 304 revalidation.
  - Embeddable `widget.js` loader (`GET /widget.js?id=...`) rendering forms dynamically with standard DOM APIs (zero unsafe `innerHTML`) and CSS scoping.
- **Public Submission Gateway (Implemented - Phase 2C-1)**:
  - Public ingestion endpoint (`POST /api/v1/public/submissions`) and CORS preflight (`OPTIONS /api/v1/public/submissions`).
  - Origin allowlist validation against widget `allowed_origins` (no wildcard `*` CORS).
  - 16 KB body payload guard returning HTTP `413 PAYLOAD_TOO_LARGE`.
  - Dynamic field schema validation against `widget.fieldsConfig` (required presence, type checking, unconfigured field rejection).
  - Partial unique index duplicate prevention on `(widget_id, idempotency_key)` with atomic replay (`200 OK`) and conflict detection (`409 IDEMPOTENCY_CONFLICT`).
  - Server-authoritative tenant isolation: submission `tenant_id` resolved exclusively from PostgreSQL widget owner.
- **Anti-Spam & Abuse Protection (Implemented - Phase 2C-2)**:
  - In-memory sliding-window rate limiting keyed by client IP (60 req/min), returning `429 RATE_LIMIT_EXCEEDED` with `Retry-After` header.
  - Honeypot spam traps (`_hp_title`, `_website`) rejecting automated bots with `400 SPAM_DETECTED`, zero DB persistence, and zero geo overhead.
- **Geo-Enrichment & Graceful Nil-Degradation (Implemented - Phase 2C-2)**:
  - Provider strategy abstraction (`IGeoProvider`) with deterministic mock providers (Provider A primary, Provider B fallback).
  - 500ms timeout containment via `Promise.race`.
  - Non-critical best-effort degradation: if both providers fail or time out, `geo_country`, `geo_city`, and `geo_provider` remain `NULL` and lead capture still succeeds (`201 Created`).
  - Idempotent replays safely skip geo-enrichment.
- **Background Jobs & Transactional Outbox (Implemented - Phase 2C-3)**:
  - Atomic submission and job creation within the same PostgreSQL transaction.
  - Asynchronous background worker (`npm run worker`) using PostgreSQL row-level locking (`FOR UPDATE SKIP LOCKED`).
  - Centralized retry scheduling with exponential backoff delays (30s, 120s, 600s).
  - Dead-letter state (`status = 'failed'`) after max attempts (3 retries / 4 total attempts).
  - Immutable attempt history audit in `job_failures`.
  - Stale processing lock recovery and graceful shutdown (`SIGINT`/`SIGTERM`).
  - Minimal job payload (`submissionId`, `widgetId`, `jobType`) with zero personal data duplication.
- **Tenant Dashboard & Lead Management API (Implemented - Phase 3A)**:
  - Strict tenant-isolated lead inspection (`GET /api/v1/dashboard/submissions`) with pagination (`page`, `limit` up to 100), whitelisted sorting (`created_at_desc`, `created_at_asc`), widget scoping, and ISO date range boundaries (`from`/`to`).
  - Single submission detail retrieval (`GET /api/v1/dashboard/submissions/:id`) with privacy-conscious fields (visitor IP and user-agent omitted) and safe `404 Not Found` responses that never leak cross-tenant entity existence.
  - High-performance SQL aggregate metrics (`GET /api/v1/dashboard/submissions/stats`) computing `totalSubmissions`, `today`, `thisWeek`, `thisMonth`, and `byWidget` breakdown using single-query SQL filters.
  - Operational job monitoring (`GET /api/v1/dashboard/jobs`) exposing execution status and retry counters while preventing sensitive payload leaks.
  - Tenant widget metadata list (`GET /api/v1/dashboard/widgets`).
- **Dashboard Frontend UI (Planned - Phase 3B)**: Web client interface for visual charts, submissions tables, and lead exports.

## Tech Stack

- **Runtime & Language**: Node.js (v20+) with TypeScript (strict mode)
- **Framework**: Express
- **Database**: PostgreSQL 16 (via Docker Compose, port 5433 to avoid host collisions)
- **Password Hashing**: bcryptjs (10 salt rounds)
- **Authentication**: Stateless JSON Web Tokens (jsonwebtoken)
- **Validation**: Zod
- **Testing**: Vitest & Supertest (141 tests passing)
- **Code Quality**: ESLint (Flat Config) & Prettier

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended)
- [npm](https://www.npmjs.com/) (v10+)
- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/)
- [Git](https://git-scm.com/)

### 1. Environment Setup

Copy the example environment configuration:

```bash
cp .env.example .env
```

Review `.env` to customize local development variables if needed. The repository ignores `.env` by default to prevent secret leakage.

### 2. Start PostgreSQL via Docker Compose

```bash
docker compose up -d
```

To stop the database:

```bash
docker compose down
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Execute Database Migrations

Run the SQL migration runner to apply pending schema migrations:

```bash
npm run db:migrate
```

### 5. Run Development Server

```bash
npm run dev
```

The server will start at `http://localhost:4000`.

### 6. Run Tests

Execute the comprehensive Vitest integration suite:

```bash
npm test
```

### 7. Type Check, Lint, and Format

```bash
npm run typecheck
npm run lint
npm run format:check
```

### 8. Production Build and Run

```bash
npm run build
npm start
```

## API Documentation

### Authentication & Identity Endpoints

#### 1. Register a Tenant and User

`POST /api/v1/auth/register`
Creates tenant and user inside a database transaction, hashes password with bcrypt, and returns user, tenant, and JWT.

#### 2. Authenticate / Login

`POST /api/v1/auth/login`
Verifies credentials in constant time. Returns generic 401 error on missing account or invalid password to prevent account enumeration.

#### 3. View Current Identity Context

`GET /api/v1/auth/me`
Requires `Authorization: Bearer <token>` header. Resolves tenant context exclusively from the verified JWT claims.

---

### Widget Management Endpoints (Authenticated)

All protected widget endpoints require `Authorization: Bearer <token>` and enforce strict tenant scoping.

#### 1. Create Widget

`POST /api/v1/widgets`

```json
{
  "name": "Contact Form",
  "allowedOrigins": ["http://localhost:5000"],
  "fields": [
    { "name": "name", "type": "text", "label": "Full Name", "required": true },
    { "name": "email", "type": "email", "label": "Email Address", "required": true },
    { "name": "message", "type": "textarea", "label": "Your Message", "required": false }
  ],
  "theme": {
    "primaryColor": "#2563eb",
    "buttonText": "Send Message"
  }
}
```

**Response (201 Created):** Returns widget details, initial version `1`, and the copy-pasteable embed snippet:

```json
{
  "widget": { "id": "...", "version": 1, ... },
  "embedSnippet": "<script src=\"http://localhost:4000/widget.js?id=...\"></script>"
}
```

#### 2. List Widgets

`GET /api/v1/widgets`
Returns array of widgets belonging strictly to the authenticated tenant.

#### 3. Get Widget

`GET /api/v1/widgets/:id`
Returns single widget by ID scoped to authenticated tenant. Non-existent or foreign tenant widgets return `404 NOT_FOUND`.

#### 4. Update Widget

`PATCH /api/v1/widgets/:id`
Allows modifying `name`, `fields`, `theme`, `allowedOrigins`, and `isActive`. Any change automatically increments `version` (e.g., version 1 -> 2).

#### 5. Deactivate / Delete Widget

`DELETE /api/v1/widgets/:id`
Soft-deactivates widget (`is_active = false`) to preserve historical submission integrity while immediately revoking public delivery.

---

### Public Widget Delivery Endpoints

#### 1. Load Widget Script

`GET /widget.js?id=<widgetId>`
Delivers embeddable JavaScript loader. Returns `Cache-Control: public, max-age=3600`. Prevents path traversal via strict UUID validation.

#### 2. Fetch Public Widget Configuration

`GET /api/v1/public/widgets/:id/config`

- Validates the incoming `Origin` header against `widget.allowed_origins`.
- Disallowed origins receive HTTP `403 FORBIDDEN` (no wildcard `*` CORS).
- Allowed origins receive HTTP `200 OK` with `Access-Control-Allow-Origin: <origin>` and an ETag header: `W/"<widget_id>-v<version>"`.
- Revalidations with matching `If-None-Match` header receive HTTP `304 Not Modified`.
- Never exposes tenant IDs, user hashes, or private metadata.

---

### Public Lead Submission Endpoints

#### 1. CORS Preflight

`OPTIONS /api/v1/public/submissions`

- Handles preflight checks for cross-origin lead submissions.
- Checks origin against widget allowlists in PostgreSQL.
- Disallowed origins receive HTTP `403 FORBIDDEN` and omit CORS headers.
- Allowed origins receive HTTP `204 No Content` with `Access-Control-Allow-Origin: <origin>`, `Access-Control-Allow-Methods: POST, OPTIONS`, and `Access-Control-Allow-Headers: Content-Type, Idempotency-Key, x-widget-id`.

#### 2. Ingest Lead Submission

`POST /api/v1/public/submissions`

- Accepts cross-origin form submissions.
- **Headers**:
  - `Content-Type: application/json`
  - `Idempotency-Key: <unique-client-key>` (optional, enforces duplicate prevention)
  - `Origin: <host-origin>` (validated against widget `allowed_origins`)
- **Body**:
  ```json
  {
    "widgetId": "10b4d283-ea2e-4e16-ad1b-2e79c3db6665",
    "data": {
      "name": "Jane Doe",
      "email": "jane@example.com",
      "message": "Interested in enterprise plan"
    },
    "_hp_title": ""
  }
  ```
- **Responses**:
  - `201 Created`: Fresh submission persisted with resolved geo.
    ```json
    {
      "status": "success",
      "submissionId": "uuid-here",
      "createdAt": "2026-10-05T...",
      "receivedAt": "2026-10-05T..."
    }
    ```
  - `200 OK` (Idempotent Replay): Duplicate request with identical key and payload replays previous result with `"idempotentReplay": true` (skipping geo-enrichment).
  - `400 Bad Request` (`VALIDATION_ERROR`): Missing required fields, invalid email format, unknown/unconfigured fields, or malformed JSON.
  - `400 Bad Request` (`SPAM_DETECTED`): Honeypot trap field (`_hp_title` or `_website`) populated.
  - `403 Forbidden` (`FORBIDDEN`): Request origin is not permitted by the widget's allowed origins allowlist.
  - `404 Not Found` (`NOT_FOUND`): Non-existent or inactive widget.
  - `409 Conflict` (`IDEMPOTENCY_CONFLICT`): Idempotency key previously used with differing payload values.
  - `413 Payload Too Large` (`PAYLOAD_TOO_LARGE`): Request body exceeds 16 KB boundary limit.
  - `429 Too Many Requests` (`RATE_LIMIT_EXCEEDED`): Client IP exceeded sliding-window rate limit (60 req/min). Returns `Retry-After` header.

---

### Authenticated Dashboard & Lead Management Endpoints

All dashboard endpoints require a valid JWT bearer token in the `Authorization: Bearer <token>` header and enforce strict repository-level tenant scoping (`tenant_id = $authTenantId`). Cross-tenant access attempts return safe `404 Not Found` responses to prevent leaking resource existence.

#### 1. List Submissions

`GET /api/v1/dashboard/submissions`

- **Query Parameters**:
  - `page` (optional integer >= 1, default `1`)
  - `limit` (optional integer between 1 and 100, default `20`)
  - `sort` (optional: `created_at_desc` [default], `created_at_asc`)
  - `widgetId` (optional UUIDv4, strictly verified to belong to authenticated tenant)
  - `from` (optional ISO 8601 date string, half-open interval: `created_at >= from`)
  - `to` (optional ISO 8601 date string, half-open interval: `created_at < to`)
- **Response (200 OK)**:
  ```json
  {
    "status": "success",
    "data": [
      {
        "id": "c138d948-261f-4444-a957-3f3c30656a8d",
        "submissionId": "c138d948-261f-4444-a957-3f3c30656a8d",
        "widgetId": "73bc5b66-0db9-46f3-9d0b-21d9f4851eb3",
        "widgetName": "Contact Sales Form",
        "payload": { "name": "Alice Smith", "email": "alice@example.com" },
        "geoCountry": "US",
        "geoCity": "San Francisco",
        "geoProvider": "provider_a",
        "origin": "https://tenant-site.com",
        "createdAt": "2026-10-05T09:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1
    }
  }
  ```

#### 2. Get Submission Detail

`GET /api/v1/dashboard/submissions/:id`

- Returns safe submission detail if `submission.tenant_id === req.auth.tenantId`.
- Excludes sensitive fields (visitor IP address and user-agent omitted for privacy).
- If the submission does not exist or belongs to another tenant, returns HTTP `404 NOT_FOUND` with message `"Submission not found"`.

#### 3. Submission Statistics

`GET /api/v1/dashboard/submissions/stats`

- **Query Parameters**:
  - `widgetId` (optional UUIDv4, scoped to tenant)
- **Response (200 OK)**:
  ```json
  {
    "status": "success",
    "data": {
      "totalSubmissions": 42,
      "today": 5,
      "thisWeek": 18,
      "thisMonth": 42,
      "byWidget": [
        {
          "widgetId": "73bc5b66-0db9-46f3-9d0b-21d9f4851eb3",
          "widgetName": "Contact Sales Form",
          "count": 30
        },
        {
          "widgetId": "f9a463db-f8aa-4e96-a81d-e5cf233306db",
          "widgetName": "Newsletter Signup",
          "count": 12
        }
      ]
    }
  }
  ```

#### 4. Operational Jobs Visibility

`GET /api/v1/dashboard/jobs`

- **Query Parameters**: `page` (default 1), `limit` (default 20, max 100), `status` (optional: `pending`, `processing`, `completed`, `failed`)
- Returns paginated background jobs scoped strictly to the tenant.
- Sensitive job payloads and database internals are omitted.

#### 5. List Widgets

`GET /api/v1/dashboard/widgets`

- Returns all widgets belonging strictly to the authenticated tenant.

---

## Local Demo

A sample host page is provided in [`demo/index.html`](demo/index.html) to demonstrate cross-origin widget delivery:

1. Start the FlyRank platform API on port 4000:
   ```bash
   npm run dev
   ```
2. In a separate terminal, serve the `demo` directory on port 5000 (e.g. using Python or `npm run demo:serve`):
   ```bash
   npm run demo:serve
   ```
3. Open `http://localhost:5000` in your browser.
4. The page will fetch the widget configuration from `http://localhost:4000/api/v1/public/widgets/<id>/config` and render the isolated, styled lead form seamlessly.

---

## Project Structure

```
flyrank-capstone-widget-platform/
├── src/
│   ├── config/         # Environment parsing and typed schema validation (Zod)
│   ├── middleware/     # Auth, error, tenant-context, and request-id middleware
│   ├── modules/
│   │   ├── auth/       # Identity, bcrypt, and JWT services & routes
│   │   ├── widgets/    # Widget domain: types, schemas, repo, service, loader, routes
│   │   ├── submissions/# Submission domain: types, schemas, repo, service, rate-limiter, routes
│   │   ├── jobs/       # Background jobs: types, repo, handler abstraction, side-effect handler
│   │   └── dashboard/  # Dashboard domain: types, schemas, repo, service, routes
│   ├── providers/
│   │   └── geo/        # Geo-enrichment strategy: IGeoProvider, MockProviderA, MockProviderB, GeoService
│   ├── workers/        # Background worker process (job-worker.ts) with FOR UPDATE SKIP LOCKED
│   ├── shared/         # Database pool, migrations, and shared types
│   ├── app.ts          # Express application initialization and route mounting
│   └── server.ts       # Server entrypoint and lifecycle listener
├── tests/              # Test suites (Vitest / Supertest - 141 tests passing)
│   ├── health.test.ts
│   ├── db.test.ts
│   ├── auth.test.ts
│   ├── tenant-isolation.test.ts
│   ├── widget-crud.test.ts
│   ├── widget-delivery.test.ts
│   ├── submissions.test.ts
│   ├── abuse-and-geo.test.ts
│   ├── jobs-and-worker.test.ts
│   └── dashboard.test.ts
├── db/
│   ├── migrations/     # 001_identity_domain.sql, 002_widget_domain.sql, 003_submissions_domain.sql, 004_jobs_domain.sql
│   └── migrate.ts      # Automated database migration runner
├── docs/               # Architectural documentation (ARCHITECTURE.md)
├── demo/               # Cross-origin client test harness (index.html, serve.js)
├── docker-compose.yml  # Local PostgreSQL service definition
├── .env.example        # Reference environment variables
├── package.json        # Dependencies and execution scripts
├── README.md           # Project documentation
├── BUILDLOG.md         # Chronological development log
└── capstone.yaml       # Project metadata manifest
```

## Environment Variables

The project uses a typed configuration schema in [`src/config/env.ts`](src/config/env.ts). Safe reference values are provided in [`.env.example`](.env.example):

| Variable               | Description                                                   | Default in Development                                                       |
| :--------------------- | :------------------------------------------------------------ | :--------------------------------------------------------------------------- |
| `NODE_ENV`             | Application environment (`development`, `test`, `production`) | `development`                                                                |
| `PORT`                 | HTTP server port                                              | `4000`                                                                       |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed origins                       | `http://localhost:5000`                                                      |
| `WIDGET_BASE_URL`      | Base URL for widget script delivery snippets                  | `http://localhost:4000`                                                      |
| `POSTGRES_USER`        | PostgreSQL superuser username                                 | `postgres`                                                                   |
| `POSTGRES_PASSWORD`    | PostgreSQL password for development                           | `postgres_dev_password`                                                      |
| `POSTGRES_DB`          | PostgreSQL target database                                    | `flyrank_widgets`                                                            |
| `POSTGRES_PORT`        | PostgreSQL host port binding                                  | `5432` (mapped to `5433` on host via Docker Compose)                         |
| `DATABASE_URL`         | Full PostgreSQL connection string                             | `postgresql://postgres:postgres_dev_password@localhost:5433/flyrank_widgets` |
| `JWT_SECRET`           | Secret token used for signing JWTs                            | _(configured in .env)_                                                       |

## Limitations

This is **Phase 3A**. Identity (Phase 2A), Widget Management & Delivery (Phase 2B), Hardened Lead Submission Persistence & Idempotency (Phase 2C-1), Abuse Protection, Honeypot & Geo Enrichment (Phase 2C-2), Background Jobs, Transactional Outbox & Reliable Side Effects (Phase 2C-3), and Dashboard Lead Management Backend (Phase 3A) are implemented and verified.
Dashboard frontend client (Phase 3B), charts UI, and external email/webhook notifications are deferred to subsequent phases.
