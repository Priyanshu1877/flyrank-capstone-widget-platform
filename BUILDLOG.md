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
