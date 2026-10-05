# Embeddable Widget & Lead-Capture Platform

## Project Overview

The FlyRank Embeddable Widget & Lead-Capture Platform is a multi-tenant backend system designed to allow customers to generate embeddable lead capture forms via a single-line `<script>` tag. The platform is designed to securely accept submissions across origins, enforce validation and anti-spam controls, perform geo-enrichment with provider failover, persist records in PostgreSQL, and trigger asynchronous background side-effects.

## Current Status

**Phase 2B — Widget Management & Delivery Completed**

Phase 2B is implemented and verified. The platform includes full tenant-scoped widget management CRUD, automatic version incrementing, embed snippet generation, public configuration endpoint with origin allowlisting and ETag revalidation (`304 Not Modified`), embeddable `widget.js` loader with safe DOM rendering (XSS protection via `textContent` and scoped CSS isolation), and comprehensive automated integration tests (47 tests passing).

## System Architecture & Specifications

The complete, authoritative system architecture, entity relationship schema, REST API contracts, public submission pipeline, multi-tenancy model, security boundaries, and behavioral test strategies are detailed in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Implemented & planned components:

- **Tenant Management & Authentication (Implemented - Phase 2A)**: Secure JWT-based access for tenant administration with strict repository-level isolation.
- **Relational Storage (Implemented - Phase 2A & 2B)**: PostgreSQL 16 schema with UUIDv4 primary keys, connection pooling, automated migrations (`001_identity_domain.sql`, `002_widget_domain.sql`).
- **Widget Service & Delivery (Implemented - Phase 2B)**:
  - Tenant-scoped CRUD (`POST /api/v1/widgets`, `GET /api/v1/widgets`, `GET /api/v1/widgets/:id`, `PATCH /api/v1/widgets/:id`, `DELETE /api/v1/widgets/:id`).
  - Automatic version tracking on configuration updates.
  - Soft deactivation on delete preserving future submission history.
  - Dynamic embed snippet generation (`<script src="http://localhost:4000/widget.js?id=..."></script>`).
  - Public configuration endpoint (`GET /api/v1/public/widgets/:id/config`) with origin allowlist validation and ETag 304 revalidation.
  - Embeddable `widget.js` loader (`GET /widget.js?id=...`) rendering forms dynamically with standard DOM APIs (zero unsafe `innerHTML`) and CSS scoping.
- **Public Submission Gateway (Planned Phase 2C)**: Cross-origin endpoint with dynamic CORS matching, 16 KB payload limits, schema validation, rate limiting, and honeypot spam protection.
- **Geo-Enrichment (Planned Phase 2D)**: Strategy pattern with sequential fallback (Provider A -> Provider B -> Graceful Nil Degradation).
- **Async Processing (Planned Phase 2E)**: Transactional outbox job queue (`jobs` table) with worker row locking (`FOR UPDATE SKIP LOCKED`), exponential backoff retries, and dead-letter isolation (`job_failures`).
- **Tenant Dashboard (Planned Phase 2F)**: Scoped analytical endpoints for lead tracking, submission trends, and geographic breakdown.

## Tech Stack

- **Runtime & Language**: Node.js (v20+) with TypeScript (strict mode)
- **Framework**: Express
- **Database**: PostgreSQL 16 (via Docker Compose, port 5433 to avoid host collisions)
- **Password Hashing**: bcryptjs (10 salt rounds)
- **Authentication**: Stateless JSON Web Tokens (jsonwebtoken)
- **Validation**: Zod
- **Testing**: Vitest & Supertest (47 tests passing)
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

## Local Demo

A sample host page is provided in [`demo/index.html`](demo/index.html) to demonstrate cross-origin widget delivery:

1. Start the FlyRank platform API on port 4000:
   ```bash
   npm run dev
   ```
2. In a separate terminal, serve the `demo` directory on port 5000 (e.g. using Python or `npx serve`):
   ```bash
   python -m http.server 5000 --directory demo
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
│   │   └── widgets/    # Widget domain: types, schemas, repo, service, loader, routes
│   ├── shared/         # Database pool, migrations, and shared types
│   ├── app.ts          # Express application initialization and route mounting
│   └── server.ts       # Server entrypoint and lifecycle listener
├── tests/              # Test suites (Vitest / Supertest)
│   ├── health.test.ts
│   ├── auth.test.ts
│   ├── tenant-isolation.test.ts
│   ├── widget-crud.test.ts
│   └── widget-delivery.test.ts
├── db/
│   ├── migrations/     # 001_identity_domain.sql, 002_widget_domain.sql
│   └── migrate.ts      # Automated database migration runner
├── docs/               # Architectural documentation (ARCHITECTURE.md)
├── demo/               # Cross-origin client test harness (index.html)
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

This is **Phase 2B**. Only Identity (Phase 2A) and Widget Management & Delivery (Phase 2B) are implemented.
Public submission ingestion, rate limiting, honeypot filters, geo-location enrichment, background workers, and dashboard analytics are deferred to subsequent phases.
