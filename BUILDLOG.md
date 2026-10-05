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
