# BUILDLOG

## Phase 0 — Project Foundation

**Date**: October 5, 2026

### Objective

Establish a clean, professional engineering foundation for the FlyRank Backend AI Engineering Capstone ("Embeddable Widget & Lead-Capture Platform") and prepare the project structure for Phase 1: Design.

### AI Assistance

Antigravity was utilized as an AI pair programming and development assistant during this phase to scaffold configuration, generate directory structures, configure tooling, draft documentation skeletons, and execute verification scripts. All architectural decisions, dependency selections, and configuration parameters are reviewed and governed by the developer.

### Work Completed

1. **Git Initialization & Security**:
   - Initialized Git repository on `main` branch.
   - Configured `.gitignore` to prevent tracking of `.env`, `node_modules`, `dist/`, logs, and OS/IDE metadata while allowing `.env.example`.
2. **Environment Variable Configuration**:
   - Created `.env.example` with safe placeholder configuration for development, PostgreSQL, CORS, and JWT.
   - Created `src/config/env.ts` with strict Zod schema validation.
3. **Containerized Database Setup**:
   - Configured `docker-compose.yml` for PostgreSQL 16 Alpine with container health check and persistent volume mounting.
4. **TypeScript & Node.js Tooling**:
   - Initialized `package.json` with ES module support (`"type": "module"`).
   - Configured strict `tsconfig.json` targeting `ES2022` and `NodeNext` resolution with strict null checks, unused variable warnings, and explicit boundary types.
   - Configured ESLint with flat config (`eslint.config.mjs`) and Prettier (`.prettierrc`).
5. **Express Application Architecture**:
   - Separated application factory (`src/app.ts`), configuration (`src/config/env.ts`), and HTTP server entrypoint (`src/server.ts`).
   - Implemented minimal `GET /health` endpoint returning HTTP 200 `{ "status": "ok" }`.
6. **Testing Setup**:
   - Configured Vitest (`vitest.config.ts`) and Supertest.
   - Created integration test suite (`tests/health.test.ts`) validating the `GET /health` endpoint.
7. **Directory Hierarchy**:
   - Created modular folder layout: `src/{config,middleware,modules,providers,shared}`, `tests/`, `db/{migrations,seed}`, `docs/`, `demo/`.
8. **Documentation & Manifests**:
   - Created `capstone.yaml` project manifest.
   - Created `docs/ARCHITECTURE.md` establishing Phase 0 baseline and planned components.
   - Created `README.md` with complete developer instructions, environment guide, and architecture scope.

### Developer Decisions

- **Runtime & Modules**: Configured native Node.js ES modules (`"type": "module"`) to align with modern JavaScript and TypeScript ecosystem standards.
- **Validation**: Chose Zod for runtime environment variable parsing to enforce early failure on misconfigured deployments.
- **Test Runner**: Selected Vitest for high-speed native ESM test execution and direct TypeScript compatibility without heavy compilation overhead.
- **Modular Directory Organization**: Established domain-separated directories (`modules/`, `providers/`, `middleware/`, `shared/`) upfront to maintain clean boundaries as business logic is added in subsequent phases.

### Verification

The following verification commands were executed and verified:

1. **Dependency Installation**:
   - `npm install express dotenv zod cors` -> Exit 0.
   - `npm install -D typescript tsx @types/node @types/express @types/cors vitest supertest @types/supertest prettier eslint @eslint/js typescript-eslint` -> Exit 0 (247 packages audited, 0 vulnerabilities).
2. **Type Checking**:
   - `npm run typecheck` (`tsc --noEmit`) -> Exit 0 (zero errors).
3. **Linting**:
   - `npm run lint` (`eslint .`) -> Exit 0 (zero errors, zero warnings).
4. **Code Formatting**:
   - `npm run format` (`prettier --write .`) -> Exit 0 (all files formatted).
5. **Automated Unit & Integration Testing**:
   - `npm test` (`vitest run`) -> Exit 0 (1 test file passed, 1 test passed in 476ms).
6. **Production Build**:
   - `npm run build` (`tsc`) -> Exit 0 (`dist/` directory generated with `app.js`, `server.js`, `config/env.js`).
7. **Database Configuration Validation**:
   - `docker compose config` -> Exit 0 (YAML schema and environment variables parsed successfully).
   - Docker Daemon Note: Docker Desktop installed locally; daemon requires interactive GUI launch by user on Windows host before container spin-up (`docker compose up -d`).
8. **Server Runtime & Health Endpoint**:
   - Started server via `node dist/server.js` on port 4000.
   - Executed `curl.exe -i http://localhost:4000/health`:
     - Status: `HTTP/1.1 200 OK`
     - Content-Type: `application/json; charset=utf-8`
     - Body: `{"status":"ok"}`
   - Terminated background server process cleanly.
9. **Git Security & Tracking Check**:
   - Tested `.env` ignore behavior: `.env` was confirmed ignored by Git (`git status --ignored`).
   - Verified no secrets or private credentials exist in any tracked files.

### Known Limitations

- No business logic, tenant authentication, widget configuration, submission ingestion, rate limiting, or background workers have been implemented in Phase 0.
- Database tables and migrations have not yet been created; these will be designed during Phase 1.

---

## Phase 1 — Design

**Date**: October 5, 2026

### Objective

Establish the authoritative technical design specification, multi-tenancy model, relational database schema, index strategy, REST API contracts, submission ingestion pipeline, security boundaries, and behavioral test strategy in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) to serve as the strict contract for Phase 2 implementation.

### AI Assistance

Antigravity was utilized as an AI pair programming and development assistant during this phase to formulate architectural specifications, compose system ASCII diagrams, design relational database schemas and index strategies, specify RESTful API contracts, and draft behavioral test scenarios corresponding to the FlyRank probes. All architectural specifications, data boundaries, and design decisions are reviewed and approved by the developer.

### Decisions Made & Architecture Decisions

1. **Multi-Tenant Scoping**:
   - Formulated a shared-process, shared-database multi-tenant architecture using logical `tenant_id` row-level discrimination.
   - Mandatory repository boundary enforcement: every read, mutation, and delete operation across `widgets` and `submissions` must include `WHERE tenant_id = req.user.tenantId`.
   - Cross-tenant access attempts return `404 Not Found` rather than `403 Forbidden` to prevent object existence enumeration.
2. **Relational Database Design**:
   - Defined PostgreSQL schema covering 6 core tables: `tenants`, `users`, `widgets`, `submissions`, `jobs`, and `job_failures`.
   - Selected UUIDv4 for non-enumerable primary keys across all entities.
   - Defined specialized indexing strategies: composite index `(tenant_id, created_at DESC)` for high-performance dashboard pagination, partial unique index `(widget_id, idempotency_key)` for duplicate prevention, and partial index `(queue, run_at) WHERE status = 'pending'` for lock-free background job polling (`FOR UPDATE SKIP LOCKED`).
3. **Widget Lifecycle & Embed Model**:
   - Defined script delivery via `<script src="http://localhost:4000/widget.js?id=..."></script>` with immutable asset caching (`Cache-Control: public, max-age=31536000, immutable`).
   - Designed dynamic widget configuration fetching with ETag-based HTTP 304 validation and Shadow DOM/CSS namespace isolation to prevent host site style collisions.
4. **Public Ingestion Pipeline**:
   - Structured a 9-step ingestion pipeline: Origin/CORS check -> 16 KB payload size guard -> Zod schema validation -> In-memory sliding-window rate limiting -> Honeypot trap check (`_hp_title`) -> Idempotency evaluation -> Geo enrichment -> Atomic PostgreSQL persistence -> Background job dispatch.
5. **CORS & Preflight Policy**:
   - Prohibited wildcard `Access-Control-Allow-Origin: *` on submission endpoints; enforced dynamic allowlist matching against tenant-configured `widget.allowed_origins`.
6. **Geo Enrichment Fallback**:
   - Designed a strategy pattern with sequential failover: Provider A -> Provider B -> Graceful Nil Degradation (`geo_country = null`).
   - Added strict 500ms abort timeouts on external calls; guaranteed that geo failures never abort or block lead submission persistence.
7. **Asynchronous Background Jobs**:
   - Designed a database-backed Transactional Outbox pattern (`jobs` table) with row locking (`FOR UPDATE SKIP LOCKED`).
   - Defined exponential backoff retries (30s, 120s, 600s) up to 3 attempts, with permanent failures routed to `job_failures` dead-letter audit log.
8. **FlyRank Behavioral Probes Specification**:
   - Formulated test requirements directly targeting the core probes: valid cross-origin submission, malformed/oversized rejection (413/400), rate limit burst & recovery (429), geo provider fallback & degradation, background webhook failure & retry durability, and honeypot rejection.
9. **Explicit Non-Goals**:
   - Explicitly excluded paid infrastructure, real CDNs, Kubernetes, microservices, Redis, Kafka, heavy frontend frameworks, third-party CAPTCHAs, and unnecessary AI features to keep the capstone maintainable and explainable.

### Verification Performed

1. **Document Internal Consistency**:
   - Verified that entity relationships (`users` -> `tenants` -> `widgets` -> `submissions`) match API contracts and repository filtering semantics.
   - Verified that all six tables have defined columns, types, primary keys, foreign keys, and indexes.
   - Verified that all 6 FlyRank behavioral probes are addressed with specific failure and success semantics.
2. **Codebase Health Checks**:
   - `npm run typecheck` (`tsc --noEmit`) -> Exit 0 (zero errors).
   - `npm run lint` (`eslint .`) -> Exit 0 (zero errors, zero warnings).
   - `npm test` (`vitest run`) -> Exit 0 (1 test file passed, 1 test passed).
   - `npm run build` (`tsc`) -> Exit 0 (`dist/` build verified).

### Known Limitations

- Architecture and design phase only.
- No business logic, migrations, database tables, widget rendering scripts, submission endpoints, or background workers have been implemented yet.

---

## Phase 2A — Database, Authentication & Tenant Isolation

**Date**: October 5, 2026

### Objective

Implement the relational database foundation, SQL migration pipeline, PostgreSQL connection pool, tenants and users schema, password hashing, user registration with transaction rollback, authentication with anti-enumeration login, stateless JWT bearer token authentication, request ID tracing, and strict repository-level tenant isolation.

### AI Assistance

Antigravity was used as an AI pair programming and development assistant to write the database migration runner, author migration SQL, scaffold repository abstractions, implement authentication services, configure security middleware, and construct automated Vitest integration test suites. All dependencies, cryptographic implementations, and database queries were reviewed and verified.

### Implementation Decisions

1. **Dependency Selection**:
   - `pg` & `@types/pg`: Added as the official, lightweight PostgreSQL client pool. Provides direct parameterized queries and transaction control without heavy ORM overhead.
   - `bcryptjs` & `@types/bcryptjs`: Selected for secure password hashing with 10 salt rounds. Pure JavaScript implementation avoids native C++ compilation toolchain issues on Windows.
   - `jsonwebtoken` & `@types/jsonwebtoken`: Added for standard stateless JWT generation and verification.
2. **PostgreSQL Port Remapping**:
   - During initial verification, discovered that a native Windows PostgreSQL service was running locally on port 5432.
   - To avoid port collision without interfering with host services, remapped the Docker container's exposed host port to `5433` (container port remains `5432`) and updated `DATABASE_URL` and `POSTGRES_PORT` in `.env` and `.env.example`.
3. **Migration System**:
   - Implemented a lightweight, deterministic TypeScript migration runner (`db/migrate.ts`) that records applied migrations in a `schema_migrations` table and applies SQL files inside transactions.
   - Created `db/migrations/001_identity_domain.sql` defining `tenants` and `users` tables with UUIDv4 primary keys, timestamps, unique constraints, and foreign key cascades.
4. **Registration Transaction Integrity**:
   - Implemented `POST /api/v1/auth/register` with atomic transaction boundaries (`BEGIN` -> create tenant -> hash password -> create user -> `COMMIT`).
   - Verified that any downstream failure in user creation triggers an immediate `ROLLBACK`, guaranteeing zero orphan tenant records.
5. **Security & Anti-Enumeration**:
   - `password_hash` is stripped from all domain and API responses.
   - Login endpoint (`POST /api/v1/auth/login`) returns an identical generic `401 Unauthorized` ("Invalid email or password") regardless of whether the email was registered, preventing account enumeration.
6. **Tenant Context & Repository Isolation**:
   - Created `requireAuth` middleware verifying Bearer tokens and attaching `{ userId, tenantId, role }` to `req.auth`.
   - Created `UserRepository` with `findByIdAndTenant(id, tenantId)` requiring `WHERE id = $1 AND tenant_id = $2`, preventing cross-tenant access.

### Verification Performed

1. **Docker Compose & Database**:
   - `docker compose config` -> Exit 0.
   - `docker compose ps` -> `flyrank_postgres` container healthy and listening on port 5433.
2. **Database Migration Runner**:
   - `npm run db:migrate` -> Applied `001_identity_domain.sql` successfully.
   - Second execution verified migration idempotency (0 new migrations applied).
   - Inspected tables in PostgreSQL: `schema_migrations`, `tenants`, `users` created.
3. **Type Checking & Linting**:
   - `npm run typecheck` (`tsc --noEmit`) -> Exit 0 (zero errors).
   - `npm run lint` (`eslint .`) -> Exit 0 (zero errors, zero warnings).
4. **Automated Integration Test Suite**:
   - `npm test` (`vitest run`):
     - `tests/health.test.ts` (1 test passed)
     - `tests/db.test.ts` (2 tests passed)
     - `tests/auth.test.ts` (13 tests passed, including transaction rollback test)
     - `tests/tenant-isolation.test.ts` (5 tests passed, validating User A / User B isolation)
     - Total: **4 test files, 21 tests passed (100% pass rate)**.
5. **Live Manual API Verification**:
   - Tested `POST /api/v1/auth/register` with `Invoke-RestMethod`: Status 201, safe user and tenant returned, token generated.
   - Tested `POST /api/v1/auth/login`: Status 200, JWT returned, password_hash excluded.
   - Tested `GET /api/v1/auth/me` with Bearer token: Status 200, correct tenant context resolved.
   - Tested `GET /api/v1/auth/me` without token: Status 401 with standard error envelope.
6. **Git Security Check**:
   - `git status --ignored`: Confirmed `.env` is ignored by Git and never staged.
   - Scanned diff for credentials, tokens, or plaintext passwords — zero secrets present.

### Known Limitations

- Phase 2A only covers database foundation, authentication, and tenant isolation.
- Widgets, public submissions, widget.js, rate limiting, geo enrichment, background workers, and dashboard APIs are not yet implemented.

---

## Phase 2B — Widget Management & Delivery

**Date**: October 5, 2026

### Objective

Implement tenant-scoped widget management CRUD, automatic version tracking, soft deactivation, dynamic embed snippet generation, public widget delivery (`GET /widget.js`), public configuration endpoint (`GET /api/v1/public/widgets/:id/config`) with origin allowlist CORS and ETag 304 revalidation, safe DOM rendering (XSS prevention), and comprehensive automated integration testing.

### AI Assistance

Antigravity was used as an AI pair programming and development assistant to write the database migration (`002_widget_domain.sql`), author repository abstractions (`widget.repository.ts`), Zod validation schemas (`widget.schema.ts`), business logic services (`widget.service.ts`), routes (`widget.routes.ts`, `widget-delivery.routes.ts`), embed loader script generator (`widget-loader.ts`), demo harness (`demo/index.html`), and automated integration test suites (`tests/widget-crud.test.ts`, `tests/widget-delivery.test.ts`). All code was reviewed, validated, and verified.

### Implementation Decisions

1. **Database Schema (`db/migrations/002_widget_domain.sql`)**:
   - Created `widgets` table with UUIDv4 primary key (`gen_random_uuid()`), foreign key to `tenants(id) ON DELETE CASCADE`, `name` (VARCHAR), `is_active` (BOOLEAN DEFAULT true), `allowed_origins` (TEXT[] DEFAULT '{}'), `fields_config` (JSONB DEFAULT '[]'), `theme_config` (JSONB DEFAULT '{}'), `version` (INTEGER DEFAULT 1), and timestamps.
   - Added index `idx_widgets_tenant_id` for efficient tenant-scoped filtering.
2. **Tenant Scoping & Security**:
   - All authenticated repository operations require `tenant_id` alongside `widgetId` (`WHERE id = $1 AND tenant_id = $2`). The client can never supply or override `tenantId`; it is strictly extracted from the verified JWT payload.
   - Operations against non-existent widgets or widgets belonging to another tenant return HTTP `404 NOT_FOUND` with generic error messages, completely preventing entity enumeration.
3. **Soft Deactivation vs Hard Deletion**:
   - Deleting a widget (`DELETE /api/v1/widgets/:id`) performs a soft deactivation (`is_active = false, updated_at = NOW()`).
   - Rationale: Preserves foreign key integrity and audit trails for future submission records, analytics, and asynchronous worker tasks tied to the widget ID while immediately revoking public configuration delivery (`404 NOT_FOUND`).
4. **Versioning & Cache Revalidation**:
   - Modifying a widget (`PATCH /api/v1/widgets/:id`) automatically increments `version = version + 1`.
   - The public configuration endpoint computes a deterministic weak ETag: `W/"<id>-v<version>"`.
   - Incoming `If-None-Match` headers are revalidated. If matching, the server returns HTTP `304 Not Modified` with zero body bytes, minimizing bandwidth.
5. **Origin Allowlist & CORS**:
   - Widget `allowed_origins` are strictly validated via Zod: must be valid `http://` or `https://` origins (protocol + host + optional port), rejecting paths and prohibiting wildcard `*`.
   - The public configuration endpoint inspects the client `Origin` header. If matched against `allowed_origins`, it returns `Access-Control-Allow-Origin: <origin>`. If unmatched or disallowed, it returns HTTP `403 FORBIDDEN` and omits CORS allow headers.
6. **Safe DOM Rendering (XSS Protection)**:
   - The embeddable `widget.js` script dynamically creates DOM elements using native browser DOM APIs (`document.createElement`, `element.textContent`, `element.setAttribute`).
   - Unsafe `innerHTML` is never used, guaranteeing that malicious user or tenant configuration cannot execute arbitrary JavaScript on host websites.
7. **Scoped CSS Isolation**:
   - All CSS styles in `widget.js` are prefixed with container selector `div[data-flyrank-widget="<id>"]` to ensure the widget coexists harmoniously with host website typography and styles without leaking globally.
8. **Embed Snippet Generation**:
   - Configured `WIDGET_BASE_URL` in environment variables (`http://localhost:4000` default) to ensure embed snippets are dynamic and configurable across environments without code changes.

### Database Changes

- Applied `db/migrations/002_widget_domain.sql` using `npm run db:migrate`.
- Created `widgets` table and `idx_widgets_tenant_id` index.

### Problems & Fixes

1. **Parallel Test Race Conditions**:
   - Initial parallel runs of `tests/widget-crud.test.ts` and `tests/widget-delivery.test.ts` had a test cleanup race condition where global tenant cleanup purged test records created by concurrently executing test suites.
   - **Fix**: Updated all test suites to use unique, namespaced email and widget prefixes (`w_crud_` and `w_del_`) and scoped the `afterAll` cleanup strictly to tenants matching their respective test prefixes.
2. **Windows CLI ETag Header Quoting**:
   - In Windows PowerShell, `curl.exe` strips outer quotes from HTTP request headers (sending `If-None-Match: W/widget-id-v1` instead of `If-None-Match: W/"widget-id-v1"`).
   - **Fix**: Enhanced the server ETag revalidation check to support both exact header string equality and normalized entity-tag matching (stripping weak prefix `W/` and quotes), adhering strictly to RFC HTTP caching specifications.

### Verification Performed

1. **Database Migration**:
   - `npm run db:migrate` -> Applied `002_widget_domain.sql` successfully.
2. **Type Checking & Linting**:
   - `npm run typecheck` (`tsc --noEmit`) -> Exit 0 (zero errors).
   - `npm run lint` (`eslint .`) -> Exit 0 (zero errors, zero warnings).
   - `npm run format:check` (`prettier --check .`) -> Exit 0 (all files formatted).
3. **Automated Integration Test Suite**:
   - `npm test` (`vitest run`):
     - `tests/health.test.ts` (1 test passed)
     - `tests/db.test.ts` (2 tests passed)
     - `tests/auth.test.ts` (13 tests passed)
     - `tests/tenant-isolation.test.ts` (5 tests passed)
     - `tests/widget-crud.test.ts` (15 tests passed)
     - `tests/widget-delivery.test.ts` (11 tests passed)
     - Total: **6 test files, 47 tests passed (100% pass rate)**.
4. **Production Build**:
   - `npm run build` (`tsc`) -> Exit 0 (`dist/` generated with zero errors).
5. **Live Manual End-to-End Verification**:
   - Registered tenant and authenticated to obtain Bearer JWT.
   - Created widget with custom fields and theme (`POST /api/v1/widgets` -> 201 Created).
   - Retrieved widget by ID (`GET /api/v1/widgets/:id` -> 200 OK).
   - Listed tenant widgets (`GET /api/v1/widgets` -> 200 OK).
   - Updated widget (`PATCH /api/v1/widgets/:id` -> 200 OK, version incremented from 1 to 2).
   - Verified cross-tenant isolation (Tenant B token querying Tenant A widget -> 404 NOT_FOUND).
   - Verified public delivery (`GET /widget.js?id=<id>` -> 200 OK, JavaScript loader returned with UUID validation).
   - Verified public config with allowed origin (`GET /api/v1/public/widgets/:id/config` with `Origin: http://localhost:5000` -> 200 OK, ETag returned).
   - Verified ETag revalidation (`If-None-Match: <etag>` -> 304 Not Modified).
   - Verified disallowed origin (`Origin: http://malicious-site.com` -> 403 Forbidden).
   - Verified soft deactivation (`DELETE /api/v1/widgets/:id` -> 200 OK, public config subsequently returns 404 Not Found).
6. **Git Security & Secret Audit**:
   - Confirmed `.env` is ignored by Git and never staged.
   - Scanned diff for credentials, tokens, or private data — zero secrets present.

### Known Limitations

- Phase 2B only implements widget management and delivery.
- Public lead submissions, submission ingestion pipeline, rate limiting, honeypot traps, geo-location enrichment, background workers, and dashboard APIs are deferred to subsequent phases.

---

## Phase 2C-1 — Hardened Lead Submission

**Date**: October 5, 2026

### Objective

Implement the hardened lead submission pipeline: database schema migration for `submissions`, public submission API (`POST /api/v1/public/submissions`), CORS preflight (`OPTIONS`), dynamic per-widget origin allowlist validation, dynamic schema validation against `widget.fieldsConfig`, 16 KB payload size boundary guard, database-backed atomic idempotency duplicate prevention, and comprehensive automated integration testing.

### AI Assistance

Antigravity was utilized as an AI pair programming and development assistant during this phase to author the SQL migration (`003_submissions_domain.sql`), construct domain types (`submission.types.ts`), validation schemas (`submission.schema.ts`), repository abstractions (`submission.repository.ts`), service orchestration (`submission.service.ts`), router controllers (`submission.routes.ts`), and 20 automated integration tests (`tests/submissions.test.ts`). All code was reviewed, validated, and verified.

### Implementation Decisions

1. **Database Schema (`db/migrations/003_submissions_domain.sql`)**:
   - Created `submissions` table with UUIDv4 primary key (`gen_random_uuid()`), foreign keys to `tenants(id) ON DELETE CASCADE` and `widgets(id) ON DELETE CASCADE`.
   - Included `idempotency_key` (TEXT NULL), `payload` (JSONB NOT NULL), `ip_address`, `user_agent`, `origin`, `geo_country`, `geo_city`, `geo_provider` (all NULL for now), and `created_at`.
   - Created partial unique index `idx_submissions_widget_idempotency` ON `(widget_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.
   - Added query indexes for `tenant_id`, `widget_id`, `created_at DESC`, and composite `(tenant_id, created_at DESC)`.
2. **Atomic Idempotency Engine & Race Condition Defense**:
   - Request `Idempotency-Key` header drives duplicate prevention.
   - Insert statement uses `INSERT ... ON CONFLICT (widget_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`.
   - **First Request**: Row is created and returned with HTTP `201 Created`.
   - **Identical Replay**: If `(widget_id, idempotency_key)` exists, the server retrieves the original row, performs a deep key-order-agnostic payload comparison, and replays the original success response (`{ status: "success", submissionId, ... , idempotentReplay: true }`) with zero duplicate database rows.
   - **Conflicting Payload**: If the same key is reused with differing payload values, the server returns HTTP `409 IDEMPOTENCY_CONFLICT`.
   - **Scope Independence**: The same `Idempotency-Key` across distinct widgets operates independently.
   - **Concurrent Safety**: Concurrent identical requests resolve safely at the PostgreSQL index level; exactly one row is persisted.
3. **Dynamic CORS & Origin Allowlist**:
   - The server inspects the requesting `Origin` and compares it against the resolved widget's `allowed_origins`.
   - Allowed origins receive `Access-Control-Allow-Origin: <origin>` and appropriate CORS headers.
   - Disallowed origins are rejected with HTTP `403 FORBIDDEN` and CORS headers are omitted. Wildcard `*` is prohibited.
   - `OPTIONS /api/v1/public/submissions` handles browser preflight requests.
4. **Dynamic Field Validation**:
   - Incoming `data` fields are validated against `widget.fieldsConfig`.
   - Required fields are enforced; empty strings/missing keys are rejected with HTTP `400 VALIDATION_ERROR`.
   - Field types (`text`, `email`, `textarea`) are verified; emails are validated using Zod's RFC-compliant parser.
   - Unknown or unconfigured fields are rejected to prevent parameter pollution.
5. **16 KB Payload Size Guard**:
   - The body parser limits incoming requests to 16 KB.
   - Handled via `errorHandler` mapping `entity.too.large` / status 413 to HTTP `413 PAYLOAD_TOO_LARGE`.
6. **Server-Authoritative Tenant Isolation**:
   - Submissions derive `tenant_id` solely from the database widget record (`widget.tenantId`).
   - Any client-supplied `tenant_id` in request body or headers is ignored and cannot overwrite the owning tenant.
7. **Privacy & Information Protection**:
   - Public submission responses contain only safe identifiers (`submissionId`, `createdAt`, `receivedAt`).
   - Internal database details, tenant IDs, IP addresses, and user-agent strings are excluded from API responses.

### Database Changes

- Applied `db/migrations/003_submissions_domain.sql` using `npm run db:migrate`.
- Created `submissions` table and 5 indexes including `idx_submissions_widget_idempotency`.

### Verification Performed

1. **Database Migration**:
   - `npm run db:migrate` -> Applied `003_submissions_domain.sql` successfully.
2. **Type Checking & Linting**:
   - `npm run typecheck` (`tsc --noEmit`) -> Exit 0 (zero errors).
   - `npm run lint` (`eslint .`) -> Exit 0 (zero errors, zero warnings).
   - `npm run format:check` (`prettier --check .`) -> Exit 0 (all files formatted).
3. **Automated Integration Test Suite**:
   - `npm test` (`vitest run`):
     - `tests/health.test.ts` (1 test passed)
     - `tests/db.test.ts` (2 tests passed)
     - `tests/auth.test.ts` (13 tests passed)
     - `tests/tenant-isolation.test.ts` (5 tests passed)
     - `tests/widget-crud.test.ts` (15 tests passed)
     - `tests/widget-delivery.test.ts` (11 tests passed)
     - `tests/submissions.test.ts` (20 tests passed)
     - Total: **7 test files, 67 tests passed (100% pass rate)** in 1.35s.
4. **Production Build**:
   - `npm run build` (`tsc`) -> Exit 0 (`dist/` generated successfully).
5. **Live Manual End-to-End Verification (Probes A through F)**:
   - Started backend server on port 4000.
   - **A. Valid cross-origin submission**: `POST` from `http://localhost:5000` -> HTTP 201 Created, `Access-Control-Allow-Origin: http://localhost:5000`.
   - **B. Disallowed origin rejection**: `POST` from `http://malicious-site.com` -> HTTP 403 Forbidden, CORS headers omitted.
   - **C. First idempotent request**: `POST` with `Idempotency-Key` -> HTTP 201 Created with new `submissionId`.
   - **D. Repeated identical request**: Repeated with same key and payload -> HTTP 200 OK, same `submissionId`, `idempotentReplay: true`.
   - **E. Same key + changed payload**: Repeated with changed name -> HTTP 409 Conflict (`IDEMPOTENCY_CONFLICT`).
   - **F. Oversized request**: Payload exceeding 16 KB -> HTTP 413 Payload Too Large (`PAYLOAD_TOO_LARGE`).
6. **Git Security & Secret Audit**:
   - Confirmed `.env` is ignored by Git and never staged.
   - Scanned diff for credentials, tokens, or private data — zero secrets present.

### Known Limitations

- Phase 2C-1 implements lead submission persistence and idempotency.
- Rate limiting, honeypot spam protection, geo-location enrichment, background workers, and dashboard analytics are deferred to subsequent phases.

---

## [Phase 2C-2] - Abuse Protection, Honeypot & Geo Enrichment

**Date**: 2026-10-05  
**Scope**: Server-side IP rate limiting, honeypot bot trap, mock geo providers with timeout containment, failover chain, and graceful nil-degradation.

### Objectives & Summary

Implemented Phase 2C-2 to harden the public lead submission gateway against abusive bot traffic and high-volume flooding, and integrated a resilient geo-enrichment pipeline.

Key achievements:

1. **Server-Side IP Rate Limiting**:
   - Implemented an in-memory sliding-window rate limiter (`SlidingWindowRateLimiter`).
   - Default window: 60 seconds; threshold: 60 requests per client IP.
   - Enforced across all widget IDs for a given client IP, preventing attackers from bypassing limits by cycling widget IDs.
   - Returns HTTP `429 RATE_LIMIT_EXCEEDED` with a standard `Retry-After: <seconds>` header.
   - Positioned before expensive geo-enrichment and database persistence.
2. **Honeypot Bot Protection**:
   - Monitored top-level honeypot traps `_hp_title` and `_website` (hidden via CSS and omitted from configured fields).
   - If either trap contains a non-empty string, returns HTTP `400 SPAM_DETECTED` with an opaque error message (`"Submission rejected"`).
   - Zero database persistence to `submissions` table, zero geo provider invocation, and zero downstream side effects.
   - Honeypot fields cannot overwrite genuine lead payload attributes or internal table columns.
3. **Geo-Enrichment Abstraction & Failover**:
   - Defined `IGeoProvider` strategy interface with `lookup(ip: string): Promise<GeoLocation | null>`.
   - Implemented `MockGeoProviderA` as the primary deterministic mock provider (returning `country: "US"`, `city: "Austin"`, `provider: "provider_a"`).
   - Implemented `MockGeoProviderB` as the deterministic fallback provider (returning `country: "GB"`, `city: "London"`, `provider: "provider_b"`).
   - Implemented `GeoService` orchestrating the failover sequence:
     - Calls Provider A with a 500ms timeout guard (`Promise.race`).
     - If Provider A succeeds, uses Provider A data (`provider_a`). Provider B is not called.
     - If Provider A fails or times out, falls back to Provider B.
     - If Provider B succeeds, uses Provider B data (`provider_b`).
     - If Provider B also fails or times out, degrades gracefully to `null`.
4. **Graceful Nil-Degradation**:
   - Lead capture is treated as mission-critical; geo-enrichment is best-effort.
   - If both providers fail or time out, `geo_country`, `geo_city`, and `geo_provider` are stored as `NULL` in the PostgreSQL `submissions` table.
   - The endpoint still returns HTTP `201 Created` with valid submission metadata.
   - Zero internal provider exceptions, network traces, API keys, or stack traces are ever exposed to the client.
5. **Idempotency Ordering**:
   - Existing idempotent submissions replayed via `Idempotency-Key` bypass geo-enrichment entirely, avoiding redundant provider lookups.
6. **Reverse Proxy & IP Spoofing Hardening**:
   - Configured Express `trust proxy` setting (`loopback` in production, `true` in test runner).
   - Prevents arbitrary spoofing of `X-Forwarded-For` from untrusted networks.
   - Client IP addresses are never exposed in public API responses.

### Implementation Decisions

1. **In-Memory Rate Limiting vs. External Store**:
   - In accordance with capstone specifications, Redis or external infrastructure was not introduced.
   - In-memory sliding window provides accurate timestamp-based rate calculation without dependency overhead for single-process deployments.
2. **Provider Mock Realism Without Fake Production Secrets**:
   - No external network calls or fake third-party API keys were added. Deterministic in-memory mock providers simulate success, failure, and timeout conditions cleanly and reliably.
3. **500ms Timeout Guard**:
   - Wrapped provider lookups in `executeWithTimeout` using `Promise.race` and `setTimeout` to guarantee that slow third-party geo services can never stall the submission request or exhaust server connections.
4. **Pipeline Execution Sequence**:
   - Enforced: `Request ID` → `16 KB Limit` → `Widget Resolution` → `CORS/Origin Check` → `Dynamic Field Validation` → `Rate Limiting` → `Honeypot Trap Check` → `Idempotency Replay` → `Geo Enrichment` → `PostgreSQL Persistence` → `201 Created`.

### AI Assistance Used

- Assisted in drafting the `SlidingWindowRateLimiter` sliding-window timestamp pruning logic.
- Assisted in architecting `GeoService` failover sequence with `Promise.race` timeout containment.
- Assisted in generating the 17 integration tests in `tests/abuse-and-geo.test.ts`.

### Verification Performed

1. **Automated Integration Test Suite**:
   - `npm test` (`vitest run`):
     - `tests/health.test.ts` (1 test passed)
     - `tests/db.test.ts` (2 tests passed)
     - `tests/auth.test.ts` (13 tests passed)
     - `tests/tenant-isolation.test.ts` (5 tests passed)
     - `tests/widget-crud.test.ts` (15 tests passed)
     - `tests/widget-delivery.test.ts` (11 tests passed)
     - `tests/submissions.test.ts` (20 tests passed)
     - `tests/abuse-and-geo.test.ts` (17 tests passed)
     - Total: **8 test files, 84 tests passed (100% pass rate)** in 1.49s.
2. **Type Checking & Code Quality**:
   - `npm run typecheck` (`tsc --noEmit`) -> Exit 0 (zero errors).
   - `npm run lint` (`eslint .`) -> Exit 0 (zero errors, zero warnings).
   - `npm run format:check` (`prettier --check .`) -> Exit 0 (all files formatted).
3. **Production Build**:
   - `npm run build` (`tsc`) -> Exit 0 (`dist/` generated successfully).
4. **Live Manual End-to-End Verification (Probes A through G)**:
   - **Probe A (Normal submission succeeds)**: Status 201 Created.
   - **Probe B (Repeated rapid submissions hit 429)**: Exceeded 5 reqs -> HTTP 429 `RATE_LIMIT_EXCEEDED` with `Retry-After: 60`.
   - **Probe C (Honeypot submission detected)**: Non-empty `_hp_title` -> HTTP 400 `SPAM_DETECTED`, zero DB record created.
   - **Probe D (Provider A success)**: Database row persisted with `geo_country = 'US'`, `geo_city = 'Austin'`, `geo_provider = 'provider_a'`.
   - **Probe E (Provider A failure + Provider B success)**: Provider A failed; fallback to Provider B succeeded; database row persisted with `geo_country = 'GB'`, `geo_city = 'London'`, `geo_provider = 'provider_b'`.
   - **Probe F (Provider A + B failure)**: Both providers failed; submission still succeeded with HTTP 201 Created; database row persisted with `geo_country = NULL`, `geo_city = NULL`, `geo_provider = NULL`.
   - **Probe G (Idempotent replay skips geo)**: Initial submission invoked geo lookup once; identical idempotent replay returned HTTP 200 OK with zero additional geo lookups (total geo lookups remained 1).
5. **Security & Secret Audit**:
   - `.env` confirmed untracked and excluded.
   - No sensitive IP or provider credentials leaked in API responses.

### Known Limitations

- In-memory rate limiting state is local to the Node.js process and does not synchronize across distributed replicas (Redis or API Gateway limiter required for clustered production).
- Geo providers are deterministic mocks; real external geo APIs will be configured in a future production deployment phase.
- Transactional outbox (`jobs` table), background worker processing, and dashboard analytics are deferred to subsequent phases.

---

## [Phase 2C-3] - Background Jobs, Transactional Outbox & Reliable Side Effects

**Date**: 2026-10-05  
**Scope**: Transactional outbox persistence, PostgreSQL persistent job queue, worker process with `FOR UPDATE SKIP LOCKED`, exponential backoff retry scheduling, dead-letter recording, and stale-lock recovery.

### Objectives & Summary

Implemented Phase 2C-3 to establish reliable, decoupled side-effect execution for public lead submissions using PostgreSQL as the persistent queuing system.

Key achievements:

1. **Database Migration (`004_jobs_domain.sql`)**:
   - Created `jobs` table with UUID primary key, tenant foreign key with cascade delete, `job_type`, `status` with check constraint (`pending`, `processing`, `completed`, `failed`), `payload` JSONB, `attempts`, `max_attempts` (default 3), `available_at`, `locked_at`, `locked_by`, `last_error`, `created_at`, `updated_at`, `completed_at`.
   - Created `job_failures` table for immutable attempt audit history (`id`, `job_id`, `tenant_id`, `attempt`, `error_code`, `error_message`, `failed_at`).
   - Added performance indexes for claiming (`idx_jobs_claim`), tenant scoping, lock inspection, and failure history.
2. **Transactional Outbox Architecture**:
   - Extended `SubmissionRepository` with `createWithJob` to atomically insert both the submission row and corresponding outbox job (`job_type: 'submission.side_effect'`) within the _exact same_ PostgreSQL transaction (`BEGIN ... INSERT ... COMMIT`).
   - If either operation fails, both are rolled back.
   - Idempotent replays returning existing submissions schedule zero duplicate jobs.
   - Rejections before persistence (CORS, validation, rate limiting, honeypot) schedule zero jobs.
   - Payload minimization: only `{ submissionId, widgetId, jobType }` is stored in the job payload; personal lead fields are never duplicated.
3. **Safe Worker Claiming (`FOR UPDATE SKIP LOCKED`)**:
   - Implemented `JobWorker` with safe row-level locking via `SELECT ... FOR UPDATE SKIP LOCKED` inside a short-lived transaction.
   - Each worker claims a job, assigns its unique identifier (`locked_by`), sets `status = 'processing'`, increments `attempts`, and commits _before_ executing the job handler.
   - Prevents duplicate claims between concurrent workers without holding database locks open during job processing.
4. **Retry Scheduling & Exponential Backoff**:
   - Centralized backoff schedule:
     - **Attempt 1 failure**: retries in **30 seconds** (`available_at = NOW() + 30s`).
     - **Attempt 2 failure**: retries in **120 seconds** (`available_at = NOW() + 120s`).
     - **Attempt 3 failure**: retries in **600 seconds** (`available_at = NOW() + 600s`).
     - **Attempt 4 failure**: retries exhausted (`attempts > max_attempts`); marked permanently `failed` (dead-letter state).
   - Every failure records an immutable row in `job_failures`.
5. **Stale Lock Recovery**:
   - Jobs stuck in `status = 'processing'` due to a crashed worker process become eligible for re-claiming once `locked_at < NOW() - staleTimeoutMs` (default 5 minutes).
6. **Side-Effect Handler Abstraction**:
   - Defined `IJobHandler` and `JobHandlerRegistry`.
   - Implemented `SubmissionSideEffectHandler` for `submission.side_effect` with configurable test hooks (`success`, `transient_failure`, `permanent_failure`). No external email or webhook providers were called.
7. **Graceful Shutdown & Observability**:
   - Added signal handlers for `SIGINT` and `SIGTERM` in `src/workers/job-worker.ts`.
   - Added `"worker": "tsx src/workers/job-worker.ts"` script to `package.json`.
   - Error messages are sanitized before storage in `job_failures` and logs (tokens and passwords redacted).

### Implementation Decisions

1. **PostgreSQL as Job Queue vs. External Brokers**:
   - Fully adhered to the capstone requirement to use PostgreSQL. No Redis, BullMQ, RabbitMQ, or Kafka infrastructure was introduced.
2. **Transaction Separation During Handler Execution**:
   - Committed the claiming transaction before executing the job handler. Holding database transactions open during potentially slow side effects degrades connection pool throughput.
3. **Tenant-Scoped Worker Claiming**:
   - `claimNextJob` supports an optional `tenantId` filter, enabling both global workers and tenant-isolated worker pools.
4. **Payload Minimization**:
   - Avoided copying sensitive user lead inputs into `jobs.payload` to preserve privacy and prevent database bloat.

### AI Assistance Used

- Assisted in drafting the `FOR UPDATE SKIP LOCKED` claim query and migration schema.
- Assisted in architecting the retry backoff calculator and worker poll loop.
- Assisted in generating the 18 comprehensive tests in `tests/jobs-and-worker.test.ts`.

### Verification Performed

1. **Automated Migration**:
   - Applied `db/migrations/004_jobs_domain.sql` using `npm run db:migrate`.
2. **Automated Integration Test Suite**:
   - `npm test` (`vitest run`):
     - `tests/health.test.ts` (1 test passed)
     - `tests/db.test.ts` (2 tests passed)
     - `tests/auth.test.ts` (13 tests passed)
     - `tests/tenant-isolation.test.ts` (5 tests passed)
     - `tests/widget-crud.test.ts` (15 tests passed)
     - `tests/widget-delivery.test.ts` (11 tests passed)
     - `tests/submissions.test.ts` (20 tests passed)
     - `tests/abuse-and-geo.test.ts` (17 tests passed)
     - `tests/jobs-and-worker.test.ts` (18 tests passed)
     - Total: **9 test files, 102 tests passed (100% pass rate)** in 1.60s.
3. **Type Checking & Code Quality**:
   - `npm run typecheck` (`tsc --noEmit`) -> Exit 0 (zero errors).
   - `npm run lint` (`eslint .`) -> Exit 0 (zero errors, zero warnings).
   - `npm run format:check` (`prettier --check .`) -> Exit 0 (all files formatted).
4. **Production Build**:
   - `npm run build` (`tsc`) -> Exit 0 (`dist/` generated cleanly).
5. **Live Manual End-to-End Verification (Probes A through J)**:
   - **Probe A, B, C**: Public lead submission created both `submissions` row and `jobs` row (`status = 'pending'`, `attempts = 0`).
   - **Probe D, E**: Worker executed job and transitioned status to `'completed'` with `completed_at` populated.
   - **Probe F, G, H**: Transient failure caused job status to remain `'pending'`, `available_at` was scheduled +30s in future, and a failure record was created in `job_failures`.
   - **Probe I**: When `available_at` elapsed, worker re-claimed the job and succeeded (`status = 'completed'`).
   - **Probe J**: Permanent failure was retried across 4 attempts; upon exhausting `max_attempts` (3), job transitioned to `'failed'` and all 4 attempt records were preserved in `job_failures`.
6. **Security & Secret Audit**:
   - Confirmed `.env` remains untracked and excluded from git.
   - Zero secrets or bearer tokens stored in `jobs` or `job_failures`.

### Known Limitations

- Real external email, SMS, and webhook integrations are intentionally deferred to future production deployment phases.
- Dashboard frontend UI and visual chart components are deferred to Phase 3B.

---

## Phase 3A — Dashboard & Lead Management Backend

**Date**: October 5, 2026

### Objective

Implement backend/API-only dashboard and lead management capabilities for authenticated customer tenants:

1. Paginated, sorted, and filtered lead submission listing (`GET /api/v1/dashboard/submissions`).
2. Single submission detail inspection with safe field exposure (`GET /api/v1/dashboard/submissions/:id`).
3. High-performance SQL aggregate submission metrics (`GET /api/v1/dashboard/submissions/stats`).
4. Operational background job visibility (`GET /api/v1/dashboard/jobs`).
5. Tenant-scoped widget listing (`GET /api/v1/dashboard/widgets`).
6. Comprehensive test suite demonstrating strict tenant isolation, anti-leakage 404 behavior, and SQL injection prevention.

### Work Completed

1. **Dashboard Module Architecture (`src/modules/dashboard/`)**:
   - `dashboard.types.ts`: Defined strongly-typed interfaces for `DashboardSubmission`, `PaginationMeta`, `DashboardSubmissionsListResponse`, `DashboardStats`, `DashboardJobItem`, `DashboardJobsListResponse`, `DashboardWidgetItem`, and `ListSubmissionsFilter`.
   - `dashboard.schema.ts`: Defined Zod schemas (`listSubmissionsQuerySchema`, `statsQuerySchema`, `listJobsQuerySchema`, `idParamSchema`) enforcing integer boundaries on `page` (>= 1) and `limit` (1-100), sort whitelist (`created_at_desc`, `created_at_asc`), ISO date validation, and UUID format verification.
   - `dashboard.repository.ts`: Implemented `DashboardRepository` utilizing parameterized SQL queries strictly filtered by `s.tenant_id = $1` at the query root:
     - `listSubmissions`: Computes paginated lead submissions with join to `widgets` for `widget_name`.
     - `countSubmissions`: Parameterized count query for pagination metadata.
     - `getSubmissionById`: Parameterized query ensuring `s.id = $1 AND s.tenant_id = $2`.
     - `getStats`: High-performance single-query SQL aggregation using `COUNT(*)::int`, `COUNT(*) FILTER (...)` for today, this week, and this month, plus per-widget left join aggregation.
     - `listJobs` and `countJobs`: Parameterized operational job queries scoped strictly to tenant.
     - `listWidgets`: Returns safe widget metadata for tenant.
   - `dashboard.service.ts`: Implemented `DashboardService` validating query filters, verifying widget ownership before filtering/aggregating, validating date coherence (`from <= to`), and calculating `totalPages`.
   - `dashboard.routes.ts`: Mounted authenticated router protected by `requireAuth` middleware. Route `/submissions/stats` mounted before `/submissions/:id` to prevent route shadowing.
2. **Express App Integration (`src/app.ts`)**:
   - Mounted `dashboardRouter` under `/api/v1/dashboard`.
3. **Automated Test Suite (`tests/dashboard.test.ts`)**:
   - Implemented 39 automated integration tests covering:
     - Authentication required (401 on missing or invalid token).
     - Default and custom pagination (`page`, `limit`), capping limit at 100, rejecting `page < 1`, `limit < 1`, `limit > 100`, and non-integers (400).
     - Sorting safe whitelist (`created_at_desc` default, `created_at_asc`, rejecting unwhitelisted sort with 400).
     - Widget filtering for owned widgets, returning 404 Not Found for foreign tenant widgets (anti-leakage).
     - Date filtering with half-open intervals (`from`, `to`), rejecting malformed dates and inverted ranges (`from > to`) with 400.
     - Strict cross-tenant isolation: Tenant A cannot see Tenant B submissions, cannot retrieve Tenant B submission by ID (returns safe 404), cannot view Tenant B jobs, and cannot view Tenant B widgets.
     - Submission detail returns safe fields (`id`, `submissionId`, `widgetId`, `widgetName`, `payload`, `geoCountry`, `geoCity`, `geoProvider`, `origin`, `createdAt`).
     - Privacy audit: Confirmed visitor IP addresses and user agents are excluded from responses.
     - Aggregate statistics: SQL aggregations verified for tenant accuracy, cross-tenant isolation, and widget-scoped filters.
     - Operational background job visibility: verified tenant scoping and omission of internal payload/error secrets.
     - Security & SQL injection prevention: verified injection strings in `page`, `sort`, `from`, and `widgetId` are safely rejected with 400.

### Developer Decisions

1. **Backend/API Only Scope**:
   - Strictly preserved scope: zero frontend, React, or chart components built. The API returns pure structured JSON.
2. **Tenant Scoping at the Database Query Level**:
   - In accordance with architectural principles, tenant checks are enforced directly in PostgreSQL query `WHERE` clauses (`s.tenant_id = $tenantId`), avoiding any risk of post-query filtering leaks.
3. **Safe 404 Anti-Leakage Behavior**:
   - If Tenant A attempts to fetch a submission ID or filter by a widget ID belonging to Tenant B, the API returns a generic `404 NOT_FOUND` rather than `403 FORBIDDEN`. This completely prevents malicious callers from enumerating the existence of foreign tenant assets.
4. **Visitor Privacy Design**:
   - While client IP and user-agent are stored for abuse mitigation and rate-limiting, they are intentionally excluded from dashboard lead responses to comply with GDPR/CCPA data minimization guidelines.
5. **In-Database Aggregations**:
   - Statistics queries leverage PostgreSQL `FILTER (WHERE ...)` and `DATE_TRUNC` aggregations, eliminating memory bloat and scaling efficiently without requiring a separate analytics data store.

### AI Assistance Used

- Antigravity was used as an AI pair programming assistant to scaffold Zod schemas, design parameterized SQL queries for dashboard filtering, build `dashboard.routes.ts`, implement the 39 tests in `tests/dashboard.test.ts`, and run manual verification probes.

### Verification Performed

1. **Automated Integration Test Suite**:
   - `npm test` (`vitest run`):
     - `tests/health.test.ts` (1 test passed)
     - `tests/db.test.ts` (2 tests passed)
     - `tests/auth.test.ts` (13 tests passed)
     - `tests/tenant-isolation.test.ts` (5 tests passed)
     - `tests/widget-crud.test.ts` (15 tests passed)
     - `tests/widget-delivery.test.ts` (11 tests passed)
     - `tests/submissions.test.ts` (20 tests passed)
     - `tests/abuse-and-geo.test.ts` (17 tests passed)
     - `tests/jobs-and-worker.test.ts` (18 tests passed)
     - `tests/dashboard.test.ts` (39 tests passed)
     - Total: **10 test files, 141 tests passed (100% pass rate)**.
2. **Type Checking & Code Quality**:
   - `npm run typecheck` (`tsc --noEmit`) -> Exit 0 (zero errors).
   - `npm run lint` (`eslint .`) -> Exit 0 (zero errors, zero warnings).
   - `npm run format:check` (`prettier --check .`) -> Exit 0 (all files formatted).
3. **Production Build**:
   - `npm run build` (`tsc`) -> Exit 0 (`dist/` generated cleanly).
4. **Live Manual End-to-End Verification (Probes A through I)**:
   - **Probe A**: Registered & logged in as Tenant A.
   - **Probe B**: Created and listed Tenant A submissions (received expected payload and pagination).
   - **Probe C**: Registered & logged in as Tenant B.
   - **Probe D**: Verified Tenant B cannot see Tenant A data (count = 0).
   - **Probe E & F**: Requested Tenant A submission ID as Tenant B -> received safe HTTP 404 `NOT_FOUND` ("Submission not found").
   - **Probe G**: Verified pagination (`page=1, limit=10, total=1, totalPages=1`).
   - **Probe H**: Verified widget filtering (owned widget succeeded; foreign widget returned HTTP 404).
   - **Probe I**: Verified aggregate statistics (Tenant A total=1, today=1; Tenant B total=0, today=0).
