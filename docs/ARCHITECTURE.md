# Architecture & Technical Design Specification

## Status

**Phase 2A — Database, Authentication & Tenant Isolation (IMPLEMENTED)**  
_Phase 2A delivers the database connection pool, migration system, tenants and users tables, password hashing, JWT authentication, and strict repository-level tenant isolation._

---

## Phase 2A Implementation Notes

Phase 2A was implemented strictly in accordance with the Phase 1 specifications with zero architectural deviations:

- **Database Engine**: PostgreSQL 16 via Docker Compose. Host port configured to `5433` (container port `5432`) to eliminate port collisions with any pre-existing host database services.
- **Migration Engine**: Minimal, robust TypeScript migration runner (`db/migrate.ts`) tracking applied SQL files in `schema_migrations`. Initial migration `001_identity_domain.sql` establishes `tenants` and `users` tables with UUID primary keys and foreign keys.
- **Password Security**: Implemented via `bcryptjs` with 10 salt rounds. Plaintext passwords and `password_hash` are never stored plaintext, logged, or exposed in API responses.
- **Authentication Routes**:
  - `POST /api/v1/auth/register`: Atomic transaction creating tenant, hashing password, and creating owner user.
  - `POST /api/v1/auth/login`: Constant-time password comparison; returns generic 401 on missing email or incorrect password (anti-enumeration).
  - `GET /api/v1/auth/me`: Protected by `requireAuth` middleware, returning verified user and tenant profiles.
- **Tenant Context & Isolation**:
  - Authenticated context `req.auth = { userId, tenantId, role }` is derived exclusively from cryptographically verified JWT bearer tokens.
  - Repository layer enforces strict tenant scoping (`WHERE tenant_id = $2`); client-supplied tenant identifiers are never trusted.

---

## 1. System Overview

The **FlyRank Embeddable Widget & Lead-Capture Platform** is a secure, multi-tenant backend platform engineered to power embeddable lead-capture forms across arbitrary external client websites. The platform enables authenticated tenant accounts to configure custom lead capture forms, receive a single-line `<script>` embed snippet, host cross-origin form widgets, ingest visitor submissions under strict security and validation boundaries, enrich submissions with geographic metadata via external fallback providers, store submissions durably in PostgreSQL, and execute asynchronous background side effects (such as webhooks/alerts).

### High-Level Data & Control Flow

```
Owner / Customer
       │
       ▼
Management API (/api/v1/widgets, /api/v1/auth)
       │
       ▼
PostgreSQL Database (tenants, users, widgets)
       │
       ▼
Embed Snippet (<script src=".../widget.js?id=..."></script>)
       │
       ▼
Customer External Host Website
       │
       ▼
Browser Execution of widget.js
       │
       ▼
Widget Config Request (/api/v1/public/widgets/:id/config)
       │
       ▼
Dynamic DOM Rendering & User Interaction
       │
       ▼
Visitor Form Submission (POST /api/v1/public/submissions)
       │
       ├── CORS & Preflight Verification
       ├── Payload Size Inspection (16 KB max)
       ├── Zod Boundary Validation
       ├── Idempotency Key Evaluation
       ├── IP & Widget Rate Limiting
       ├── Honeypot Anti-Spam Check
       └── Geo Enrichment (Provider A -> Provider B -> Failover)
       │
       ▼
Atomic Persistence in PostgreSQL (submissions + jobs)
       │
       ▼
Background Worker Dispatch (Asynchronous retries & webhook notifications)
       │
       ▼
Tenant Analytics Dashboard (/api/v1/dashboard/stats, /api/v1/dashboard/submissions)
```

### Architectural Classification of Boundaries

1. **Authenticated Management APIs (`/api/v1/auth`, `/api/v1/widgets`)**:
   - Access restricted to registered tenant users via cryptographically signed JWT bearer tokens.
   - Enforces strict tenant isolation scoping on all reads, mutations, and deletions.
2. **Public Widget Delivery APIs (`/widget.js`, `/api/v1/public/widgets/:id/config`)**:
   - High-throughput, publicly accessible read endpoints.
   - Served with aggressive caching headers (`Cache-Control`, `ETag`) and versioning hashes.
   - Cross-origin configuration requests validated against tenant-configured origin allowlists.
3. **Public Submission APIs (`/api/v1/public/submissions`)**:
   - Publicly exposed write endpoint accepting cross-origin `POST` requests.
   - Zero trust boundary: enforces payload limits, strict schema parsing, honeypot spam detection, tenant/IP rate limiting, and duplicate prevention.
4. **Authenticated Dashboard APIs (`/api/v1/dashboard/*`)**:
   - Authenticated tenant query interface for submission inspection, aggregate metrics, and geographic distribution.
   - Read-only, paginated, and scoped exclusively to the authenticated tenant.
5. **Background Worker Engine**:
   - Decoupled asynchronous job processor executing durable side effects (webhooks, notifications).
   - Operates against a database-backed job queue with exponential backoff retries, ensuring submission ingestion latency is decoupled from downstream network failures.

---

## 2. Architecture Diagram

```
+-------------------------------------------------------------------------------------------------------------+
|                                             CLIENT TIER (Untrusted)                                          |
|                                                                                                             |
|  +------------------------+                                      +---------------------------------------+  |
|  | Tenant Admin / Owner   |                                      | Visitor Browser (3rd Party Origin)    |  |
|  | (Browser / Dashboard)  |                                      |                                       |  |
|  +-----------+------------+                                      |  +---------------------------------+  |  |
|              |                                                   |  | Host Webpage (e.g. example.com)  |  |  |
|              | JWT Bearer                                        |  |   │                             |  |  |
|              | Authorization                                     |  |   ▼                             |  |  |
|              |                                                   |  | <script src="/widget.js?id=.."> |  |  |
|              |                                                   |  +-----------------+---------------+  |  |
|              |                                                   |                    |                  |  |
|              |                                                   |                    | Fetch Script     |  |
|              |                                                   +--------------------┼------------------+  |
+--------------┼------------------------------------------------------------------------┼---------------------+
               |                                                                        |
═══════════════╪════════════════════════════════════════════════════════════════════════╪═══════════════════════
               |                         TRUST BOUNDARY (Public Internet)               |
═══════════════╪════════════════════════════════════════════════════════════════════════╪═══════════════════════
               |                                                                        |
+--------------┼────────────────────────────────────────────────────────────────────────┼---------------------+
|              ▼                                                                        ▼                     |
|  +-------------------------------------------------------------------------------------------------------+  |
|  |                                  EXPRESS APPLICATION GATEWAY                                          |  |
|  |                                                                                                       |  |
|  |  +-------------------------------+   +-----------------------------+   +---------------------------+  |  |
|  |  | Security Middleware           |   | Public Widget Gateway       |   | Public Submission Pipeline|  |  |
|  |  | - Helmet Security Headers     |   | - GET /widget.js            |   | - Dynamic CORS Check      |  |  |
|  |  | - Body Parser (16KB limit)    |   | - GET /api/v1/public/widget |   | - Payload Size Guard      |  |  |
|  |  | - Request ID Tracing (UUID)   |   |   s/:id/config              |   | - Zod Schema Validation   |  |  |
|  |  | - JWT Auth & Tenant Resolver  |   | - Cache-Control & ETag      |   | - In-Memory Rate Limiter  |  |  |
|  |  +---------------+---------------+   +--------------+--------------+   | - Honeypot Trap Filter    |  |  |
|  |                  |                                  |                  | - Idempotency Resolver    |  |  |
|  |                  ▼                                  |                  +-------------+-------------+  |  |
|  |  +-------------------------------+                  |                                |                |  |
|  |  | Authenticated Domain Modules  |                  |                                ▼                |  |
|  |  | - /api/v1/auth (Users/Tokens) |                  |                  +---------------------------+  |  |
|  |  | - /api/v1/widgets (CRUD)      |                  |                  | Geo Enrichment Engine     |  |  |
|  |  | - /api/v1/dashboard (Stats)   |                  |                  | - Primary: Provider A     |  |  |
|  |  +---------------+---------------+                  |                  | - Failover: Provider B    |  |  |
|  |                  |                                  |                  | - Fallback: Degrade Nil   |  |  |
|  |                  |                                  |                  +-------------+-------------+  |  |
|  |                  |                                  |                                |                |  |
|  +------------------┼──────────────────────────────────┼────────────────────────────────┼----------------+  |
|                     |                                  |                                |                   |
|                     ▼                                  ▼                                ▼                   |
|  +-------------------------------------------------------------------------------------------------------+  |
|  |                                   PERSISTENCE LAYER (PostgreSQL 16)                                   |  |
|  |                                                                                                       |  |
|  |   [tenants] <─────── [users]              [widgets] (tenant_id, allowed_origins, config)              |  |
|  |        │                                      │                                                       |  |
|  |        └──────────────────────────────┬───────┘                                                       |  |
|  |                                       ▼                                                               |  |
|  |                       [submissions] (tenant_id, widget_id, data, geo, idempotency_key)                |  |
|  |                                       │                                                               |  |
|  |                                       ▼                                                               |  |
|  |                       [jobs] (queue, payload, status, retries, run_at) <─── [job_failures]           |  |
|  +---------------------------------------┬---------------------------------------------------------------+  |
|                                          │                                                                  |
|                                          ▼ Polling / Transactional Pick                                     |
|  +-------------------------------------------------------------------------------------------------------+  |
|  |                                   BACKGROUND WORKER RUNTIME                                           |  |
|  |                                                                                                       |  |
|  |  +-------------------------------+   +-----------------------------+   +---------------------------+  |  |
|  |  | Job Scheduler & Executor       |-->| Side Effect Dispatcher      |-->| Outbound Integrations     |  |  |
|  |  | - Exponential Backoff         |   | - Webhook Poster            |   | - Customer Webhook URLs   |  |  |
|  |  | - Max Retries (3 Attempts)    |   | - Email Alert Stub          |   | - External Webhook Sinks  |  |  |
|  |  +-------------------------------+   +-----------------------------+   +---------------------------+  |  |
|  +-------------------------------------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------------------------------------+
```

---

## 3. Tenancy Model

The system utilizes a **Shared-Database, Shared-Process Multi-Tenant Architecture** with logical row-level discriminator keys (`tenant_id`).

### Entity Relationship Hierarchy

```
User (Account Credentials & Identity)
  └── belongs to ──> Tenant (Account / Organization Workspace)
                       ├── owns ──> Widgets (Form definitions, origins, styles)
                       │              └── receives ──> Submissions (Visitor leads)
                       └── owns ──> Submissions (Scoped directly via tenant_id)
```

### Tenancy Principles

1. **Tenant Identity Resolution**:
   - Authenticated HTTP requests must supply an `Authorization: Bearer <JWT>` header.
   - The verified JWT payload contains `{ sub: userId, tenantId: string, role: string }`.
   - The application middleware extracts `tenantId` and sets it on the strongly-typed `req.user` context.
2. **Repository-Level Isolation Enforcement**:
   - Raw queries or ORM/query builder calls must **never** accept tenant ID solely from client path parameters or request bodies.
   - Every read query, update mutation, and delete operation across `widgets` and `submissions` strictly injects `WHERE tenant_id = req.user.tenantId`.
   - In cross-entity joins (e.g., retrieving submissions for a widget), both `widget.tenant_id = req.user.tenantId` and `submission.tenant_id = req.user.tenantId` are enforced.
3. **Cross-Tenant Attack Containment**:
   - **Tenant A attempts to read Tenant B's widget (`GET /api/v1/widgets/:id`)**:
     Query executes: `SELECT * FROM widgets WHERE id = :id AND tenant_id = :tenantA_id`. Returns `404 Not Found` (rather than `403 Forbidden` to prevent object existence enumeration).
   - **Tenant A attempts to modify/delete Tenant B's widget (`PATCH/DELETE /api/v1/widgets/:id`)**:
     Query executes: `UPDATE/DELETE FROM widgets WHERE id = :id AND tenant_id = :tenantA_id`. Zero rows are affected, resulting in a safe `404 Not Found`.
   - **Tenant A attempts to access Tenant B's submissions (`GET /api/v1/dashboard/submissions?widgetId=:tenantB_widget`)**:
     Validation verifies the requested `widgetId` belongs to `tenantA_id`. If invalid, query rejects immediately with `404 Not Found`.

---

## 4. Database Design (PostgreSQL Schema)

All tables use **UUID v4** strings for globally unique, non-enumerable primary keys. Timestamps are stored in `TIMESTAMPTZ` (UTC).

### 4.1. Table: `tenants`

Represents an isolated organizational account / customer boundary.

| Column       | Type           | Nullable | Constraints     | Purpose                       |
| :----------- | :------------- | :------- | :-------------- | :---------------------------- |
| `id`         | `UUID`         | No       | `PRIMARY KEY`   | Unique tenant identifier      |
| `name`       | `VARCHAR(100)` | No       |                 | Organization or customer name |
| `slug`       | `VARCHAR(100)` | No       | `UNIQUE`        | URL-safe tenant identifier    |
| `created_at` | `TIMESTAMPTZ`  | No       | `DEFAULT NOW()` | Record creation timestamp     |
| `updated_at` | `TIMESTAMPTZ`  | No       | `DEFAULT NOW()` | Record update timestamp       |

### 4.2. Table: `users`

Represents credentials and identity for authenticated dashboard owners.

| Column          | Type           | Nullable | Constraints                                | Purpose                                |
| :-------------- | :------------- | :------- | :----------------------------------------- | :------------------------------------- |
| `id`            | `UUID`         | No       | `PRIMARY KEY`                              | Unique user identifier                 |
| `tenant_id`     | `UUID`         | No       | `REFERENCES tenants(id) ON DELETE CASCADE` | Scoped parent tenant workspace         |
| `email`         | `VARCHAR(255)` | No       | `UNIQUE`                                   | User login email (case-insensitive)    |
| `password_hash` | `VARCHAR(255)` | No       |                                            | Secure argon2id / bcrypt password hash |
| `role`          | `VARCHAR(30)`  | No       | `DEFAULT 'owner'`                          | RBAC identifier (`owner`, `admin`)     |
| `created_at`    | `TIMESTAMPTZ`  | No       | `DEFAULT NOW()`                            | User creation timestamp                |
| `updated_at`    | `TIMESTAMPTZ`  | No       | `DEFAULT NOW()`                            | User update timestamp                  |

### 4.3. Table: `widgets`

Represents customer-configured embeddable form instances.

| Column            | Type           | Nullable | Constraints                                | Purpose                                                       |
| :---------------- | :------------- | :------- | :----------------------------------------- | :------------------------------------------------------------ |
| `id`              | `UUID`         | No       | `PRIMARY KEY`                              | Public widget ID (referenced in embed script)                 |
| `tenant_id`       | `UUID`         | No       | `REFERENCES tenants(id) ON DELETE CASCADE` | Owning tenant identifier                                      |
| `name`            | `VARCHAR(100)` | No       |                                            | Descriptive widget name (e.g., "Pricing Page")                |
| `is_active`       | `BOOLEAN`      | No       | `DEFAULT TRUE`                             | Master toggle to enable/disable submissions                   |
| `allowed_origins` | `TEXT[]`       | No       | `DEFAULT '{}'`                             | Array of allowed CORS origins (e.g. `["https://client.com"]`) |
| `fields_config`   | `JSONB`        | No       | `DEFAULT '[]'`                             | Schema of form fields (names, types, required flags)          |
| `theme_config`    | `JSONB`        | No       | `DEFAULT '{}'`                             | Appearance settings (brand color, position, font)             |
| `version`         | `INTEGER`      | No       | `DEFAULT 1`                                | Optimistic locking and caching version token                  |
| `created_at`      | `TIMESTAMPTZ`  | No       | `DEFAULT NOW()`                            | Creation timestamp                                            |
| `updated_at`      | `TIMESTAMPTZ`  | No       | `DEFAULT NOW()`                            | Update timestamp                                              |

### 4.4. Table: `submissions`

Stores ingested leads submitted by website visitors.

| Column            | Type           | Nullable | Constraints                                 | Purpose                                                |
| :---------------- | :------------- | :------- | :------------------------------------------ | :----------------------------------------------------- |
| `id`              | `UUID`         | No       | `PRIMARY KEY`                               | Unique submission identifier                           |
| `tenant_id`       | `UUID`         | No       | `REFERENCES tenants(id) ON DELETE CASCADE`  | Direct tenant scoping for performant querying          |
| `widget_id`       | `UUID`         | No       | `REFERENCES widgets(id) ON DELETE RESTRICT` | Source widget that captured the lead                   |
| `idempotency_key` | `VARCHAR(128)` | Yes      |                                             | Client-supplied key to prevent duplicate leads         |
| `payload`         | `JSONB`        | No       |                                             | Sanitized visitor lead payload (e.g., name, email)     |
| `ip_address`      | `VARCHAR(45)`  | Yes      |                                             | Client IP (anonymized/hashed if required)              |
| `user_agent`      | `TEXT`         | Yes      |                                             | Client browser user agent string                       |
| `origin`          | `TEXT`         | Yes      |                                             | Host site origin URL header                            |
| `geo_country`     | `VARCHAR(2)`   | Yes      |                                             | ISO 3166-1 alpha-2 country code (e.g., "US")           |
| `geo_city`        | `VARCHAR(100)` | Yes      |                                             | Resolved city name                                     |
| `geo_provider`    | `VARCHAR(50)`  | Yes      |                                             | Resolved provider (`provider_a`, `provider_b`, `none`) |
| `created_at`      | `TIMESTAMPTZ`  | No       | `DEFAULT NOW()`                             | Ingestion timestamp                                    |

### 4.5. Table: `jobs`

Lightweight, transactional, database-backed job queue for background side effects.

| Column         | Type           | Nullable | Constraints                                | Purpose                                               |
| :------------- | :------------- | :------- | :----------------------------------------- | :---------------------------------------------------- |
| `id`           | `UUID`         | No       | `PRIMARY KEY`                              | Unique job identifier                                 |
| `tenant_id`    | `UUID`         | No       | `REFERENCES tenants(id) ON DELETE CASCADE` | Scoped tenant ID                                      |
| `queue`        | `VARCHAR(50)`  | No       | `DEFAULT 'default'`                        | Named worker queue (e.g., `webhooks`, `alerts`)       |
| `type`         | `VARCHAR(50)`  | No       |                                            | Task identifier (e.g., `SUBMISSION_WEBHOOK`)          |
| `payload`      | `JSONB`        | No       |                                            | Input data needed to execute the side effect          |
| `status`       | `VARCHAR(20)`  | No       | `DEFAULT 'pending'`                        | State: `pending`, `processing`, `completed`, `failed` |
| `attempts`     | `INTEGER`      | No       | `DEFAULT 0`                                | Current execution attempts                            |
| `max_attempts` | `INTEGER`      | No       | `DEFAULT 3`                                | Maximum retry threshold before permanent failure      |
| `run_at`       | `TIMESTAMPTZ`  | No       | `DEFAULT NOW()`                            | Scheduled execution time (supports backoff)           |
| `locked_at`    | `TIMESTAMPTZ`  | Yes      |                                            | Timestamp when worker acquired lock                   |
| `locked_by`    | `VARCHAR(100)` | Yes      |                                            | Worker identifier holding active lease                |
| `created_at`   | `TIMESTAMPTZ`  | No       | `DEFAULT NOW()`                            | Job creation timestamp                                |
| `updated_at`   | `TIMESTAMPTZ`  | No       | `DEFAULT NOW()`                            | Job status change timestamp                           |

### 4.6. Table: `job_failures`

Persistent dead-letter audit log for exhaustively failed background tasks.

| Column          | Type          | Nullable | Constraints                                | Purpose                                      |
| :-------------- | :------------ | :------- | :----------------------------------------- | :------------------------------------------- |
| `id`            | `UUID`        | No       | `PRIMARY KEY`                              | Unique audit record identifier               |
| `job_id`        | `UUID`        | No       | `REFERENCES jobs(id) ON DELETE CASCADE`    | Link to the failed job                       |
| `tenant_id`     | `UUID`        | No       | `REFERENCES tenants(id) ON DELETE CASCADE` | Scoped tenant owner                          |
| `error_message` | `TEXT`        | No       |                                            | Final error description or exception message |
| `stack_trace`   | `TEXT`        | Yes      |                                            | Debugging trace (scrubbed of secrets)        |
| `attempts`      | `INTEGER`     | No       |                                            | Total attempts executed prior to failure     |
| `failed_at`     | `TIMESTAMPTZ` | No       | `DEFAULT NOW()`                            | Timestamp of dead-letter transition          |

---

## 5. Index Strategy

Indexes are explicitly structured to ensure predictable latency at scale and prevent full table scans.

```sql
-- 1. Tenant lookup & foreign key relationships
CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_widgets_tenant_id ON widgets(tenant_id);

-- 2. Submission analytics & dashboard query performance
-- Used by GET /api/v1/dashboard/submissions?widgetId=... ORDER BY created_at DESC
CREATE INDEX idx_submissions_tenant_created ON submissions(tenant_id, created_at DESC);
CREATE INDEX idx_submissions_widget_created ON submissions(widget_id, created_at DESC);

-- 3. Idempotency duplicate prevention index
-- Partial unique index ensuring the same client idempotency key is unique per widget
CREATE UNIQUE INDEX idx_submissions_widget_idempotency
ON submissions(widget_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

-- 4. Geographic breakdown queries (Dashboard aggregation)
-- Used by GET /api/v1/dashboard/geo (COUNT(*) GROUP BY geo_country)
CREATE INDEX idx_submissions_tenant_geo ON submissions(tenant_id, geo_country);

-- 5. Job Queue polling & lock acquisition index
-- Highly optimized partial index for worker polling: SELECT ... FOR UPDATE SKIP LOCKED
CREATE INDEX idx_jobs_pending_run ON jobs(queue, run_at)
WHERE status = 'pending';

-- 6. Dead letter log lookup
CREATE INDEX idx_job_failures_tenant_id ON job_failures(tenant_id);
```

### Index Rationale Summary

- `idx_submissions_tenant_created`: Ensures that listing tenant leads sorted by timestamp does not require an in-memory sort or cross-tenant scan.
- `idx_submissions_widget_idempotency`: Leverages a PostgreSQL partial unique index to reject duplicate submission attempts at the database engine level with zero table locking.
- `idx_jobs_pending_run`: Enables workers to poll runnable tasks in constant time `O(log N)` without scanning completed or currently processing tasks.

---

## 6. Widget Lifecycle & Embed Architecture

### Full Lifecycle Workflow

1. **Widget Provisioning**: The tenant creates a widget via `POST /api/v1/widgets`. A unique UUID `widget_id` is generated, and form parameters are stored in PostgreSQL.
2. **Snippet Generation**: The platform generates an embed snippet for the customer:
   ```html
   <script
     src="http://localhost:4000/widget.js?id=e7b4a2f8-9a3d-4c5e-8b1a-2d3e4f5a6b7c"
     async
     defer
   ></script>
   ```
3. **Host Site Placement**: The customer embeds the snippet into their website header or footer.
4. **Script Execution (`widget.js`)**:
   - The browser downloads `widget.js`.
   - The script parses its own query parameter `?id=...` to extract the `widgetId`.
   - The script creates an isolated host container (`<div id="flyrank-widget-root"></div>`) utilizing a Shadow DOM or CSS-isolated namespace to eliminate CSS collisions with the host site.
5. **Config Retrieval (`GET /api/v1/public/widgets/:id/config`)**:
   - `widget.js` issues a cross-origin `fetch` for the widget configuration.
   - The backend validates that the requesting `Origin` matches the widget's `allowed_origins`.
   - The response includes caching headers (`Cache-Control: public, max-age=300, stale-while-revalidate=60`).
6. **Form Rendering**: `widget.js` renders inputs, labels, submit button, and a hidden honeypot anti-spam input.
7. **Lead Submission**: On submit, `widget.js` collects values, generates a client-side UUID `Idempotency-Key`, and posts the payload to `POST /api/v1/public/submissions`.
8. **Feedback State**: `widget.js` displays a success confirmation or inline validation errors without reloading the host page.

### Asset Versioning & Safe Configuration Updates

- **Script Versioning**: Core assets can be requested with explicit semantic versioning query parameters (e.g. `/widget.js?v=1.0.0&id=...`). The server returns immutable cache headers (`Cache-Control: public, max-age=31536000, immutable`) for hashed script builds.
- **Config Invalidation**: When a tenant updates widget styling or fields (`PATCH /api/v1/widgets/:id`), the widget's internal `version` counter is incremented. The config endpoint returns an `ETag: W/"<version>-<updated_at>"`. If the client issues an `If-None-Match`, the server returns `304 Not Modified`, saving bandwidth while immediately reflecting updates.

---

## 7. API Contract (`/api/v1`)

### 7.1. Authentication APIs

#### `POST /api/v1/auth/register`

- **Auth**: None (Public)
- **Request Body**:
  ```json
  {
    "organizationName": "Acme SaaS",
    "email": "owner@acme.com",
    "password": "StrongPassword123!"
  }
  ```
- **Validation**: `email` must be valid format; `password` must be >= 8 chars with mixed characters.
- **Success Response**: `201 Created`
  ```json
  {
    "user": { "id": "uuid", "email": "owner@acme.com", "role": "owner" },
    "tenant": { "id": "uuid", "name": "Acme SaaS", "slug": "acme-saas" },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
- **Errors**: `400 Bad Request` (validation failure), `409 Conflict` (email already registered).

#### `POST /api/v1/auth/login`

- **Auth**: None (Public)
- **Request Body**:
  ```json
  {
    "email": "owner@acme.com",
    "password": "StrongPassword123!"
  }
  ```
- **Success Response**: `200 OK` (returns user, tenant, and JWT token).
- **Errors**: `400 Bad Request`, `401 Unauthorized` (invalid credentials).

#### `GET /api/v1/auth/me`

- **Auth**: Required (`Bearer <JWT>`)
- **Success Response**: `200 OK` (returns current user profile and tenant details).
- **Errors**: `401 Unauthorized`.

---

### 7.2. Widget Management APIs

#### `POST /api/v1/widgets`

- **Auth**: Required (`Bearer <JWT>`)
- **Request Body**:
  ```json
  {
    "name": "Homepage Lead Form",
    "allowedOrigins": ["https://acme.com", "https://staging.acme.com"],
    "fieldsConfig": [
      { "name": "fullName", "type": "text", "label": "Full Name", "required": true },
      { "name": "email", "type": "email", "label": "Business Email", "required": true },
      { "name": "companySize", "type": "text", "label": "Company Size", "required": false }
    ],
    "themeConfig": {
      "primaryColor": "#3b82f6",
      "position": "bottom-right",
      "buttonText": "Get Free Demo"
    }
  }
  ```
- **Validation**: `name` string 1-100 chars; `allowedOrigins` array of valid URLs; `fieldsConfig` valid JSON schema array.
- **Success Response**: `201 Created` with full widget entity and auto-generated `embedSnippet`.
- **Errors**: `400 Bad Request`, `401 Unauthorized`.

#### `GET /api/v1/widgets`

- **Auth**: Required (`Bearer <JWT>`)
- **Query Params**: `page` (default 1), `limit` (default 20).
- **Success Response**: `200 OK`
  ```json
  {
    "data": [/* array of widgets belonging exclusively to req.user.tenantId */],
    "pagination": { "page": 1, "limit": 20, "total": 3 }
  }
  ```

#### `GET /api/v1/widgets/:id`

- **Auth**: Required (`Bearer <JWT>`)
- **Path Params**: `id` (UUID)
- **Success Response**: `200 OK` with widget object.
- **Errors**: `401 Unauthorized`, `404 Not Found` (if widget does not exist or belongs to another tenant).

#### `PATCH /api/v1/widgets/:id`

- **Auth**: Required (`Bearer <JWT>`)
- **Path Params**: `id` (UUID)
- **Request Body**: Partial widget object (`name`, `allowedOrigins`, `fieldsConfig`, `themeConfig`, `isActive`).
- **Success Response**: `200 OK` with updated widget entity (increments `version`).
- **Errors**: `400 Bad Request`, `401 Unauthorized`, `404 Not Found`.

#### `DELETE /api/v1/widgets/:id`

- **Auth**: Required (`Bearer <JWT>`)
- **Path Params**: `id` (UUID)
- **Success Response**: `204 No Content`.
- **Errors**: `401 Unauthorized`, `404 Not Found`.

---

### 7.3. Public Widget Delivery APIs

#### `GET /widget.js`

- **Auth**: None (Public)
- **Headers Returned**:
  - `Content-Type: application/javascript; charset=utf-8`
  - `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`
- **Success Response**: `200 OK` with lightweight loader script.

#### `GET /api/v1/public/widgets/:id/config`

- **Auth**: None (Public, verified via `Origin` header)
- **Path Params**: `id` (Widget UUID)
- **Success Response**: `200 OK`
  ```json
  {
    "widgetId": "e7b4a2f8-9a3d-4c5e-8b1a-2d3e4f5a6b7c",
    "isActive": true,
    "fields": [
      { "name": "fullName", "type": "text", "label": "Full Name", "required": true },
      { "name": "email", "type": "email", "label": "Business Email", "required": true }
    ],
    "theme": {
      "primaryColor": "#3b82f6",
      "buttonText": "Get Free Demo"
    },
    "version": 1
  }
  ```
- **Errors**: `403 Forbidden` (if requesting origin is not in `allowed_origins`), `404 Not Found` (if widget not found or inactive).

---

### 7.4. Public Submission APIs

#### `OPTIONS /api/v1/public/submissions`

- **Auth**: None (CORS Preflight)
- **Headers Returned**:
  - `Access-Control-Allow-Origin: <Origin of host site if valid>`
  - `Access-Control-Allow-Methods: POST, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type, Idempotency-Key`
  - `Access-Control-Max-Age: 86400`
- **Success Response**: `204 No Content`.

#### `POST /api/v1/public/submissions`

- **Auth**: None (Public submission endpoint)
- **Headers Required**:
  - `Content-Type: application/json`
  - `Idempotency-Key: <UUID or string>` (optional but strongly recommended)
- **Request Body**:
  ```json
  {
    "widgetId": "e7b4a2f8-9a3d-4c5e-8b1a-2d3e4f5a6b7c",
    "data": {
      "fullName": "Jane Doe",
      "email": "jane@example.com"
    },
    "_hp_title": ""
  }
  ```
- **Validation**:
  - Payload must be under 16 KB.
  - `widgetId` must be a valid UUID pointing to an active widget.
  - `_hp_title` must be empty string (honeypot field).
  - `data` object must satisfy the widget's configured required fields.
- **Success Response**: `201 Created`
  ```json
  {
    "status": "success",
    "submissionId": "uuid-here",
    "receivedAt": "2026-10-05T12:00:00.000Z"
  }
  ```
- **Errors**:
  - `400 Bad Request`: Validation failure or filled honeypot trap.
  - `403 Forbidden`: Cross-origin mismatch with widget allowlist.
  - `404 Not Found`: Inactive or non-existent widget.
  - `409 Conflict`: Idempotency collision with different payload.
  - `413 Payload Too Large`: Body exceeds 16 KB.
  - `429 Too Many Requests`: IP or widget rate limit exceeded.

---

### 7.5. Dashboard APIs

#### `GET /api/v1/dashboard/submissions`

- **Auth**: Required (`Bearer <JWT>`)
- **Query Params**:
  - `widgetId` (optional UUID filter)
  - `page` (default 1)
  - `limit` (default 20, max 100)
  - `startDate`, `endDate` (ISO dates)
- **Success Response**: `200 OK` (paginated submissions including captured data and resolved geo).

#### `GET /api/v1/dashboard/stats`

- **Auth**: Required (`Bearer <JWT>`)
- **Query Params**: `timeRange` (`24h`, `7d`, `30d`)
- **Success Response**: `200 OK`
  ```json
  {
    "totalSubmissions": 1420,
    "submissionsTrend": [{ "date": "2026-10-01", "count": 210 }],
    "activeWidgetsCount": 3
  }
  ```

#### `GET /api/v1/dashboard/geo`

- **Auth**: Required (`Bearer <JWT>`)
- **Success Response**: `200 OK`
  ```json
  {
    "countries": [
      { "code": "US", "name": "United States", "count": 890, "percentage": 62.7 },
      { "code": "GB", "name": "United Kingdom", "count": 310, "percentage": 21.8 },
      { "code": "UNKNOWN", "name": "Unresolved", "count": 220, "percentage": 15.5 }
    ]
  }
  ```

---

## 8. Public Submission Flow

```
                        Incoming Request
                               │
                               ▼
            [Step 1: Origin & CORS Inspection]
               │ Request Origin matching widget.allowed_origins?
               ├── NO  ──> Terminate (403 Forbidden)
               └── YES ──> Continue
                               │
                               ▼
            [Step 2: Payload Size Guard]
               │ Content-Length > 16 KB or Body > 16 KB?
               ├── YES ──> Terminate (413 Payload Too Large)
               └── NO  ──> Continue
                               │
                               ▼
            [Step 3: Boundary Schema Validation]
               │ Valid JSON? Fields adhere to Zod rules?
               ├── NO  ──> Terminate (400 Bad Request: VALIDATION_ERROR)
               └── YES ──> Continue
                               │
                               ▼
            [Step 4: Rate Limiting Inspection]
               │ Exceeds 60 req/min per IP or 300 req/min per widget?
               ├── YES ──> Terminate (429 Too Many Requests + Retry-After)
               └── NO  ──> Continue
                               │
                               ▼
            [Step 5: Honeypot Anti-Spam Check]
               │ Is hidden field `_hp_title` non-empty?
               ├── YES ──> Terminate silently / (400 Bad Request: SPAM_DETECTED)
               └── NO  ──> Continue
                               │
                               ▼
            [Step 6: Idempotency Key Evaluation]
               │ Has Idempotency-Key already been stored for this widget?
               ├── YES (Identical)   ──> Return stored response (200 OK)
               ├── YES (Conflicting) ──> Terminate (409 Conflict)
               └── NO (Fresh Key)    ──> Continue
                               │
                               ▼
            [Step 7: Geo Enrichment Resolution]
               │ Execute GeoProvider chain (A -> B -> None)
               │ (Failure MUST NOT abort pipeline)
               └── Yields: { country, city, provider }
                               │
                               ▼
            [Step 8: Atomic Persistence in PostgreSQL]
               │ Execute in single DB transaction:
               │   1. INSERT INTO submissions (...)
               │   2. INSERT INTO jobs (queue: 'webhooks', ...)
               ├── DB ERROR ──> Terminate (500 Internal Error)
               └── COMMIT   ──> Continue
                               │
                               ▼
            [Step 9: Return Client Confirmation]
               │ Output 201 Created { status: 'success', submissionId: '...' }
```

### Failure Mode Matrix

| Pipeline Stage        | Failure Cause            | Behavior / Response Code     | Degrades Gracefully?               |
| :-------------------- | :----------------------- | :--------------------------- | :--------------------------------- |
| **Origin / CORS**     | Origin not in allowlist  | `403 Forbidden`              | No (Security Rejection)            |
| **Payload Guard**     | Body > 16 KB             | `413 Payload Too Large`      | No (DoS Rejection)                 |
| **Schema Validation** | Missing required email   | `400 Bad Request`            | No (Data Quality Rejection)        |
| **Rate Limiter**      | Burst exceeded           | `429 Too Many Requests`      | No (Rate Throttling)               |
| **Honeypot Trap**     | Bot filled hidden input  | `400 Bad Request`            | No (Spam Rejection)                |
| **Idempotency**       | Exact duplicate key      | `200 OK` (Cached replay)     | Yes (Idempotent replay)            |
| **Geo Provider A**    | Provider A timeout/500   | Fallback to Provider B       | **Yes (Automatic failover)**       |
| **Geo Provider B**    | Provider B timeout/500   | Default `geo_country = NULL` | **Yes (Graceful degradation)**     |
| **Database Write**    | Database connection loss | `500 Internal Server Error`  | No (Persistence guarantee)         |
| **Background Job**    | Downstream webhook 500   | Job retries in background    | **Yes (Submission already saved)** |

---

## 9. CORS Architecture & Cross-Origin Security

The widget platform specifically serves requests embedded inside host websites running on different origins (e.g., `https://clientwebsite.com`).

### Security Distinction: Delivery vs. Submissions

1. **Widget Loader Script (`/widget.js`)**:
   - Delivered as a standard JavaScript asset (`<script src="...">`).
   - Standard browser script tags do not require CORS; however, `Access-Control-Allow-Origin: *` is safe and permissible for static JavaScript assets.
2. **Widget Config Endpoint (`GET /api/v1/public/widgets/:id/config`)**:
   - Fetched via client-side `fetch()`.
   - The server inspects the incoming `Origin` request header against the target widget's `allowed_origins` stored in the database.
   - If matched, the server echoes back `Access-Control-Allow-Origin: https://clientwebsite.com`.
   - If unmatched, the response returns `403 Forbidden` without CORS allow headers, causing the browser to reject the fetch.
3. **Submission Endpoint (`POST /api/v1/public/submissions`)**:
   - **Never uses wildcard `*`**.
   - Submissions must only be accepted from origins authorized by the tenant who owns the widget.
   - For `OPTIONS` preflight, the server checks the widget's origin allowlist. If valid:
     - `Access-Control-Allow-Origin: <matching-origin>`
     - `Access-Control-Allow-Methods: POST, OPTIONS`
     - `Access-Control-Allow-Headers: Content-Type, Idempotency-Key`
     - `Access-Control-Max-Age: 86400` (caches preflight result for 24 hours to reduce latency)
   - Credentials policy: `Access-Control-Allow-Credentials: false` (public submission endpoints never require or accept cookies or visitor sessions).

---

## 10. Rate Limiting Design

Rate limiting protects against malicious DoS attacks, submission spam, and brute force flooding while preserving service for legitimate users.

### Multi-Tiered Rate Limiter Configuration

Rate limiting is enforced at two distinct tiers:

1. **Tier 1 — Client IP Scope**:
   - Identity Key: `rl:ip:<ip_address>`
   - Window: 60 seconds (Sliding Window / Token Bucket)
   - Limit: 60 requests per minute
   - Target: Protects the gateway from single-IP flooding.
2. **Tier 2 — Widget Target Scope**:
   - Identity Key: `rl:widget:<widget_id>`
   - Window: 60 seconds
   - Limit: 300 requests per minute per widget
   - Target: Protects a specific customer widget from distributed bot attacks.

### 429 Response Protocol

When a limit is exceeded, the server terminates the request immediately:

- **HTTP Status**: `429 Too Many Requests`
- **Headers**:
  - `Retry-After: 45` (seconds until window reset)
  - `X-RateLimit-Limit: 60`
  - `X-RateLimit-Remaining: 0`
  - `X-RateLimit-Reset: <epoch_timestamp>`
- **Response Body**:
  ```json
  {
    "error": {
      "code": "RATE_LIMIT_EXCEEDED",
      "message": "Too many requests. Please retry after 45 seconds.",
      "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
    }
  }
  ```
- **Burst Recovery**: Sliding window tracking ensures that legitimate users are immediately unblocked as soon as their usage falls back within the window threshold.

---

## 11. Spam & Honeypot Protection

To block automated bots without imposing intrusive CAPTCHAs on human leads, the platform employs a **Honeypot Form Trap**.

### Honeypot Architecture

1. **Form Injection**:
   The rendered HTML form generated by `widget.js` includes an off-screen, visually hidden text input:
   ```html
   <div
     style="position: absolute; left: -9999px; top: -9999px; opacity: 0; pointer-events: none;"
     aria-hidden="true"
   >
     <label for="form_title_hp">Do not fill this field</label>
     <input type="text" id="form_title_hp" name="_hp_title" tabindex="-1" autocomplete="off" />
   </div>
   ```
2. **Behavioral Trapping**:
   - **Human Visitors**: Browsers do not display the field; screen readers ignore it via `aria-hidden="true"`; users never enter text into it.
   - **Automated Scraping Bots**: Inspect the DOM and indiscriminately populate all `<input>` elements with spam data.
3. **Backend Filter**:
   - During submission validation, the server inspects `req.body._hp_title`.
   - If `_hp_title` is non-empty or contains data, the request is flagged as spam.
   - **Response**: The server rejects with `400 Bad Request` `{ "error": { "code": "SPAM_DETECTED", "message": "Submission rejected." } }` and **aborts without persisting the record to PostgreSQL**.

---

## 12. Geo Enrichment & Fallback Architecture

Submissions are enriched with geographic data (country and city) to provide analytics to the tenant. Enrichment is architected using the **Strategy Pattern with Automatic Failover**.

```
              Visitor IP Address
                      │
                      ▼
         [GeoProvider Interface]
                      │
                      ├──────────────────────────┐
                      ▼                          ▼
               [Provider A: Primary]     [Test Mock Provider]
                      │ (e.g. ip-api.com)
                      │
              Success? ── YES ──> { country: 'US', city: 'Denver', provider: 'provider_a' }
                      │
                     NO (Timeout / 5xx)
                      │
                      ▼
             [Provider B: Secondary]
                      │ (e.g. ipgeolocation.io)
                      │
              Success? ── YES ──> { country: 'US', city: 'Denver', provider: 'provider_b' }
                      │
                     NO (Timeout / 5xx)
                      │
                      ▼
             [Graceful Degradation]
                      │
                      └──> { country: null, city: null, provider: 'none' }
```

### Technical Design Rules

1. **Provider Abstraction**:
   ```ts
   export interface GeoResult {
     country: string | null;
     city: string | null;
     provider: string;
   }

   export interface IGeoProvider {
     name: string;
     lookup(ip: string): Promise<GeoResult>;
   }
   ```
2. **Timeout Boundaries**: Each external provider call is wrapped with a strict **500ms timeout** using `AbortController` to prevent slow third-party networks from degrading submission latency.
3. **Non-Blocking Ingestion Guarantee**: If **both Provider A and Provider B fail**, the exception is caught, logged to observability, and the submission continues with `geo_country = null, geo_provider = 'none'`. **The lead submission is always successfully stored.**
4. **Deterministic Testing**: Behavioral tests inject mock provider implementations that simulate Provider A downtime, verifying automatic failover to Provider B and graceful degradation when all providers fail without contacting live external APIs.

---

## 13. Asynchronous Background Jobs & Retry Semantics

Lead ingestion must remain decoupled from downstream notification mechanisms (such as customer webhooks, email alerts, or third-party CRM syncing). Downstream network delays must **never** block the client HTTP response.

### Transactional Outbox Pattern

When a visitor submits a lead:

1. Inside a single atomic PostgreSQL transaction:
   - The lead is inserted into `submissions`.
   - A task record is inserted into `jobs` with `queue = 'webhooks'`, `status = 'pending'`, `payload = { submissionId, tenantId, widgetId }`.
2. The HTTP response immediately returns `201 Created` to the visitor.
3. A background worker periodically claims pending jobs using PostgreSQL row locking:
   ```sql
   SELECT id, payload, attempts
   FROM jobs
   WHERE queue = 'webhooks'
     AND status = 'pending'
     AND run_at <= NOW()
   FOR UPDATE SKIP LOCKED
   LIMIT 10;
   ```
4. The worker executes the webhook HTTP POST to the customer's endpoint.

### Retry & Exponential Backoff Strategy

If the customer's webhook endpoint times out or returns a 5xx error:

- Attempt 1: Retries in **30 seconds**.
- Attempt 2: Retries in **120 seconds** (2 minutes).
- Attempt 3: Retries in **600 seconds** (10 minutes).
- Calculation: `run_at = NOW() + INTERVAL '30 seconds' * (2 ^ (attempts - 1))`.

```
[Job Created] ──> [Attempt 1] ── Fails ──> [Wait 30s]
                     │
                     ▼
                  [Attempt 2] ── Fails ──> [Wait 120s]
                     │
                     ▼
                  [Attempt 3] ── Fails ──> [Wait 600s]
                     │
                     ▼
                  [Final Failure]
                     │
                     ├── Update jobs SET status = 'failed'
                     └── INSERT INTO job_failures (error_message, stack_trace, ...)
```

### Dead-Letter Isolation (`job_failures`)

When `attempts >= max_attempts`, the job transitions permanently to `failed`. A record is logged in `job_failures` for tenant debugging and platform alerting, guaranteeing that no job runs indefinitely in an unrecoverable loop.

---

## 14. Idempotency & Duplicate Prevention

In mobile or high-latency network conditions, visitors may tap the "Submit" button multiple times, or browsers may automatically retry unacknowledged POST requests.

### Idempotency Specification

1. **Client Header**: The client script supplies an `Idempotency-Key: <UUID>` HTTP header.
2. **Uniqueness Scope**: Idempotency is uniquely evaluated across `(widget_id, idempotency_key)`.
3. **Execution Semantics**:
   - **Initial Request**: Key is unrecognized. The record is inserted into `submissions`, and the `idempotency_key` is persisted. Status `201 Created` is returned.
   - **Identical Duplicate Request**: A request with the same `(widget_id, idempotency_key)` arrives. The unique index `idx_submissions_widget_idempotency` catches the duplicate. The server detects the existing record and replays the original success response:
     ```json
     {
       "status": "success",
       "submissionId": "<original-submission-id>",
       "idempotentReplay": true
     }
     ```
     No duplicate submission or background job is created.
   - **Conflicting Payload**: If the same key is reused with a materially different payload, the server returns `409 Conflict`:
     ```json
     {
       "error": {
         "code": "IDEMPOTENCY_CONFLICT",
         "message": "Idempotency key was previously used with a different payload.",
         "requestId": "uuid"
       }
     }
     ```

---

## 15. Security Boundaries & Threat Model

| Attack Vector                  | Vulnerability / Threat                        | Applied Mitigation Boundary                                        |
| :----------------------------- | :-------------------------------------------- | :----------------------------------------------------------------- |
| **SQL Injection**              | Malicious visitor input compromising database | Strict parameterized queries; no dynamic SQL concatenation.        |
| **Cross-Tenant Leakage**       | Tenant A reading Tenant B widgets/leads       | Repository boundary enforces `tenant_id` injection on all queries. |
| **DDoS / Flooding**            | High-volume traffic exhausting node server    | In-memory token bucket rate limiting (IP & Widget scopes).         |
| **Large Payload Flooding**     | Memory exhaustion via giant JSON uploads      | Global body parser limit enforced strictly at 16 KB.               |
| **Spam / Bot Submissions**     | Automated marketing form spam                 | Hidden honeypot form input (`_hp_title`).                          |
| **Unauthorized Origin**        | Rogue website stealing widget config/leads    | Dynamic CORS origin check against widget `allowed_origins`.        |
| **Credential Theft**           | Password database exfiltration                | Password hashing using Argon2id / Bcrypt with unique salts.        |
| **Secret Exfiltration**        | Database passwords or JWT secrets in code     | Zero secrets committed; strict Zod `.env` schema validation.       |
| **Cross-Site Scripting (XSS)** | Injected HTML executed on host site           | Widget DOM uses `textContent` rendering; Shadow DOM isolation.     |
| **Information Disclosure**     | Stack traces exposed to visitors              | Central error handler sanitizes 500 responses into opaque IDs.     |

---

## 16. Error Model & Standard Response Envelope

All API errors adhere to a uniform, machine-readable JSON structure.

### Standard Error Schema

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The submission payload failed validation checks.",
    "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "details": [
      {
        "field": "data.email",
        "message": "Invalid email address format"
      }
    ]
  }
}
```

### Standard Error Catalog

| Status Code | Error Code              | Description                                                 |
| :---------- | :---------------------- | :---------------------------------------------------------- |
| `400`       | `BAD_REQUEST`           | Generic client syntax error                                 |
| `400`       | `VALIDATION_ERROR`      | Request body failed Zod schema parsing                      |
| `400`       | `SPAM_DETECTED`         | Honeypot trap field was filled                              |
| `401`       | `UNAUTHORIZED`          | Missing, expired, or invalid JWT bearer token               |
| `403`       | `FORBIDDEN`             | Request origin not permitted by widget allowlist            |
| `404`       | `NOT_FOUND`             | Requested entity does not exist within the tenant scope     |
| `409`       | `CONFLICT`              | Resource conflict or email already registered               |
| `409`       | `IDEMPOTENCY_CONFLICT`  | Reused idempotency key with mismatching payload             |
| `413`       | `PAYLOAD_TOO_LARGE`     | Request entity exceeds the 16 KB boundary limit             |
| `429`       | `RATE_LIMIT_EXCEEDED`   | Request threshold exceeded; includes `Retry-After` header   |
| `500`       | `INTERNAL_SERVER_ERROR` | Unhandled server exception; returns opaque `requestId` only |

---

## 17. Observability, Logging & Tracing

1. **Request Tracing**:
   - Every incoming HTTP request is assigned a UUID `x-request-id` header (generated if not provided by proxy).
   - The `requestId` is attached to Express `res.locals` and included in all server log lines and error responses.
2. **Structured JSON Logging**:
   - Application events are emitted in structured JSON format (`timestamp`, `level`, `requestId`, `tenantId`, `event`, `durationMs`).
3. **Audit Events**:
   - `AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILED`
   - `WIDGET_CREATED`, `WIDGET_MODIFIED`, `WIDGET_DELETED`
   - `SUBMISSION_INGESTED`, `SUBMISSION_RATE_LIMITED`, `SUBMISSION_SPAM_DROPPED`
   - `JOB_EXECUTED`, `JOB_RETRY_SCHEDULED`, `JOB_FAILED_PERMANENTLY`
4. **Data Redaction & Sanitization**:
   - Loggers strictly filter sensitive fields: passwords, JWT tokens, credit cards, and full PII from visitor payloads are never emitted to stdout or log aggregators.

---

## 18. Behavioral Test Strategy & FlyRank Probes

Phase 2 implementation will be validated against automated behavioral integration tests executing against the live Express server and PostgreSQL instance:

### Core FlyRank Behavioral Probes

- **Probe 1: Valid Cross-Origin Submission**:
  - Test fires cross-origin `POST /api/v1/public/submissions` with valid headers and data.
  - Verifies HTTP `201 Created`.
  - Verifies record is durably stored in PostgreSQL.
  - Verifies submission is immediately queryable via `GET /api/v1/dashboard/submissions`.
- **Probe 2: Malformed & Oversized Submissions**:
  - Test fires payload exceeding 16 KB -> Verifies HTTP `413 Payload Too Large`.
  - Test fires payload missing required email field -> Verifies HTTP `400 Bad Request`.
  - Verifies zero records are created in PostgreSQL.
- **Probe 3: Rate Limiting Burst & Recovery**:
  - Test fires 70 rapid consecutive submissions from the same simulated IP.
  - Verifies requests 1-60 return `201 Created`.
  - Verifies requests 61-70 return `429 Too Many Requests` with a valid `Retry-After` header.
  - Verifies normal requests succeed once the rate-limit window resets.
- **Probe 4: Geo Provider Fallback & Graceful Degradation**:
  - Test simulates Provider A outage -> Verifies automatic failover to Provider B; lead stored with `geo_provider = 'provider_b'`.
  - Test simulates both Provider A and B outage -> Verifies HTTP `201 Created`; lead stored with `geo_provider = 'none'`.
- **Probe 5: Background Side Effects & Retry Durability**:
  - Test configures a simulated failing webhook endpoint.
  - Submission returns `201 Created` immediately.
  - Worker attempts delivery, catches failure, increments `attempts = 1`, and schedules backoff `run_at`.
  - Submission record remains completely intact and unaffected.
- **Probe 6: Honeypot Anti-Spam Trap**:
  - Test submits a payload with `_hp_title: "spam website link"`.
  - Verifies HTTP `400 Bad Request`.
  - Verifies no lead is stored in the database.

### Additional Contract Test Suites

- **Tenant Isolation**: Verifies Tenant A token cannot view, mutate, or delete Tenant B widgets or submissions.
- **Idempotency Replay**: Verifies sending the same `Idempotency-Key` twice returns the original record without duplicating database rows or queuing duplicate jobs.
- **CORS Preflight**: Verifies `OPTIONS` queries against unauthorized origins receive `403` / omitted allow headers.

---

## 19. Phase 2 Implementation Order

Implementation during Phase 2 will proceed strictly in the following sequential order:

1. **Database Schema & Migrations**: Create SQL migration scripts for `tenants`, `users`, `widgets`, `submissions`, `jobs`, `job_failures`, and corresponding indexes.
2. **Database Client & Connection Pool**: Configure PostgreSQL connection pooling using `pg` / `kysely` / `slonik` with health checks.
3. **Authentication & Token Module**: Implement user registration, password hashing (`argon2id` / `bcrypt`), login, and JWT signing/verification.
4. **Tenant Isolation Middleware**: Implement tenant context resolution middleware extracting `tenantId` from authenticated sessions.
5. **Widget Management CRUD**: Implement `POST, GET, PATCH, DELETE /api/v1/widgets` with Zod boundary validation and tenant scoping.
6. **Embed Snippet Generation**: Implement URL generator returning the `<script>` tag snippet.
7. **Public Widget Delivery**: Implement `GET /widget.js` and `GET /api/v1/public/widgets/:id/config` with caching headers.
8. **Public Submission Gateway**: Implement `POST /api/v1/public/submissions` router and controller.
9. **CORS Middleware**: Implement dynamic cross-origin matching against widget `allowed_origins`.
10. **Payload Size Guard**: Enforce strict 16 KB body limit on public ingestion routes.
11. **Schema Validation**: Connect Zod validation schemas for dynamic widget data parsing.
12. **In-Memory Rate Limiting**: Implement sliding-window rate limiters for IP and Widget scopes with `429` responses.
13. **Honeypot Filter**: Add middleware rejecting non-empty `_hp_title` parameters.
14. **Idempotency Engine**: Implement database-backed duplicate key checking using `idx_submissions_widget_idempotency`.
15. **Geo Provider Abstraction**: Implement `IGeoProvider` interface with Provider A and Provider B adapters.
16. **Geo Fallback Pipeline**: Implement sequential fallback logic with 500ms abort timeouts and nil-degradation.
17. **Atomic Persistence**: Implement transactional database insert for `submissions` and pending `jobs`.
18. **Background Job Runner**: Implement lightweight polling worker using `FOR UPDATE SKIP LOCKED`.
19. **Retry & Dead-Letter Logic**: Implement exponential backoff retry scheduling and `job_failures` logging.
20. **Dashboard APIs**: Implement aggregated reporting endpoints (`/api/v1/dashboard/submissions`, `/stats`, `/geo`).
21. **Automated Behavioral Probes**: Implement Vitest + Supertest integration suites covering Probes 1 through 6.
22. **Evidence & Documentation**: Capture test run logs and document verification outcomes in `BUILDLOG.md`.

---

## 20. Explicit Non-Goals & System Constraints

To maintain a lean, robust, and reviewable architecture for the capstone, the following are **explicitly excluded** from the core implementation:

- **No Paid Infrastructure**: Must run entirely on $0/free tooling on a local machine.
- **No Real CDN or Domain**: Widget delivery is validated via local HTTP origins; no Cloudflare or AWS CloudFront required.
- **No Kubernetes / Distributed Orchestration**: System runs via simple Docker Compose and Node.js process managers.
- **No Microservices**: Kept as a well-modularized monolith within a single Express service.
- **No Redis / Kafka / RabbitMQ**: Job queuing and caching are fulfilled natively via PostgreSQL (`SKIP LOCKED`) and in-memory caches, avoiding additional infrastructure complexity.
- **No Complex Frontend Frameworks**: The customer embed and host test sites will be vanilla HTML/JS; no heavy React/Next.js dependencies for the embed.
- **No Third-Party CAPTCHA Services**: Replaced with effective, zero-friction honeypot fields to eliminate external API billing and privacy blockers.
- **No Realtime WebSockets**: Dashboard metrics operate via standard paginated HTTP REST queries.
- **No Advanced Targeting or AI Form Builders**: The core capstone prioritizes bulletproof reliability, isolation, and behavioral correctness over exploratory stretch features.

---

## Phase 2B Implementation Notes

### Widget Domain Architecture & Design Decisions

1. **Database Schema (`widgets`)**:
   - `id`: UUID Primary Key (`gen_random_uuid()`).
   - `tenant_id`: UUID Foreign Key referencing `tenants(id) ON DELETE CASCADE`.
   - `name`: VARCHAR(255) NOT NULL.
   - `is_active`: BOOLEAN NOT NULL DEFAULT true.
   - `allowed_origins`: TEXT[] NOT NULL DEFAULT '{}'.
   - `fields_config`: JSONB NOT NULL DEFAULT '[]'.
   - `theme_config`: JSONB NOT NULL DEFAULT '{}'.
   - `version`: INTEGER NOT NULL DEFAULT 1.
   - Timestamps: `created_at`, `updated_at`.
   - Index: `idx_widgets_tenant_id` for efficient tenant-scoped filtering.

2. **Tenant Scoping & Deletion Policy**:
   - All authenticated mutations and queries (`POST`, `GET`, `PATCH`, `DELETE`) are strictly parameterized with `tenant_id` extracted from verified JWT claims. A client can never supply or override `tenantId`.
   - Cross-tenant queries return `404 NOT_FOUND` rather than revealing resource existence.
   - Deletion (`DELETE /api/v1/widgets/:id`) implements **soft deactivation** (`is_active = false, updated_at = NOW()`). This preserves historical integrity for future submissions, metrics, and background jobs tied to the widget ID while immediately rendering the public configuration endpoint inactive (`404 NOT_FOUND`).

3. **Versioning & Cache Revalidation**:
   - Updates (`PATCH /api/v1/widgets/:id`) that modify `name`, `fields`, `theme`, `allowedOrigins`, or `isActive` automatically increment `version = version + 1`.
   - The public configuration endpoint (`GET /api/v1/public/widgets/:id/config`) generates an ETag formatted as `W/"<widget_id>-v<version>"`.
   - Clients supplying an `If-None-Match` header matching the current ETag receive HTTP `304 Not Modified` with zero response body, eliminating unnecessary network payload transfer.
   - Cache-Control is set to `public, max-age=300, stale-while-revalidate=60` for public config, with `Vary: Origin, Accept-Encoding`.

4. **Origin Validation & CORS**:
   - `allowed_origins` entries are strictly validated via Zod: must be valid `http://` or `https://` origins (protocol + host + optional port), with no wildcard `*` allowed, and paths stripped/normalized.
   - The public configuration endpoint checks the incoming request `Origin` header against the widget's `allowed_origins`.
   - If origin is matched, `Access-Control-Allow-Origin: <origin>` is returned. If unauthorized, HTTP `403 FORBIDDEN` is returned and CORS headers are omitted.

5. **Client Script Delivery & XSS Defense**:
   - `GET /widget.js?id=<widgetId>` validates the `id` as a UUID to prevent path traversal or filesystem probing.
   - The embedded JavaScript dynamically builds DOM elements using standard DOM APIs (`document.createElement`, `element.textContent`, `element.setAttribute`) and avoids `innerHTML` completely to eliminate XSS risks from tenant-configured field labels or values.
   - Scoped container `div[data-flyrank-widget="<id>"]` isolates CSS rules from host page styles.

---

## Phase 2C-1 Implementation Notes

### Hardened Lead Submission Architecture & Design Decisions

1. **Database Schema (`submissions`)**:
   - `id`: UUID Primary Key (`gen_random_uuid()`).
   - `tenant_id`: UUID Foreign Key referencing `tenants(id) ON DELETE CASCADE`.
   - `widget_id`: UUID Foreign Key referencing `widgets(id) ON DELETE CASCADE`.
   - `idempotency_key`: TEXT NULL.
   - `payload`: JSONB NOT NULL storing validated lead fields.
   - `ip_address`: TEXT NULL.
   - `user_agent`: TEXT NULL.
   - `origin`: TEXT NULL.
   - `geo_country`, `geo_city`, `geo_provider`: TEXT NULL (intentionally deferred to Phase 2D).
   - `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW().
   - **Partial Unique Index**: `idx_submissions_widget_idempotency` ON `(widget_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.
   - Auxiliary Indexes: `idx_submissions_tenant_id`, `idx_submissions_widget_id`, `idx_submissions_created_at`, `idx_submissions_tenant_created`.

2. **Public Submission Gateway & CORS**:
   - Route: `POST /api/v1/public/submissions` and `OPTIONS /api/v1/public/submissions`.
   - Dynamic per-widget CORS: The server resolves the target `widgetId`, verifies active status, and matches the client's `Origin` header against `widget.allowed_origins`.
   - Disallowed origins receive HTTP `403 FORBIDDEN` and zero CORS allow headers. Wildcard `Access-Control-Allow-Origin: *` is strictly prohibited.
   - Tenant isolation: The submission's `tenant_id` is derived exclusively from the widget owner in PostgreSQL; caller-supplied tenant identifiers are completely ignored.

3. **Dynamic Field Validation**:
   - The incoming `data` payload is validated against `widget.fieldsConfig`.
   - Required fields are strictly enforced (missing/blank returns `400 VALIDATION_ERROR`).
   - Field types (`text`, `email`, `textarea`) are verified, with email addresses checked for RFC-compliant formatting.
   - Unconfigured/unknown fields in `data` are rejected to prevent parameter pollution.

4. **16 KB Body Size Limit**:
   - The global JSON parser and error handler enforce a strict 16 KB request body limit.
   - Payloads exceeding 16 KB are intercepted and return HTTP `413 PAYLOAD_TOO_LARGE` with the standard error response envelope.

5. **Atomic Idempotency Engine**:
   - Driven by the HTTP request header `Idempotency-Key`.
   - Safe race condition handling: Persists via `INSERT ... ON CONFLICT (widget_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`.
   - **New Key**: Creates submission row and returns HTTP `201 Created`.
   - **Identical Replay**: Detects conflict, verifies that incoming payload deeply matches the existing submission payload, and replays the original success response (`{ status: "success", submissionId, ... , idempotentReplay: true }`) with zero duplicate database rows.
   - **Conflicting Payload**: If the same key is reused with differing field values, returns HTTP `409 IDEMPOTENCY_CONFLICT`.
   - **Scope Independence**: The same `Idempotency-Key` used across distinct widgets operates independently.
   - **Omitted Key**: Submissions without an idempotency key succeed normally, creating independent rows.
