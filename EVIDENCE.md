# EVIDENCE.md � Capstone Requirement Evidence Index

This document maps every requirement from the FlyRank "Embeddable Widget & Lead-Capture Platform"
capstone to **concrete, verifiable evidence** � automated tests, source files, BUILDLOG entries,
and live behavioral probes. All entries refer to files that exist in this repository.

---

## 1. Multi-Tenancy & Authentication

### REQ-AUTH-1: Tenant Registration with Atomic Transaction

**Evidence:**

- **Test file**: `tests/auth.test.ts` � `POST /api/v1/auth/register` suite (13 tests)
  - Test: `"creates tenant and user atomically"` � verifies that a single registration request creates exactly one tenant record and one user record inside a PostgreSQL transaction.
  - Test: `"rolls back tenant on user creation failure"` � injects a forced constraint violation during user creation and confirms zero orphan tenant rows are persisted.
- **Source**: `src/modules/auth/auth.service.ts` � `registerUser()` wraps tenant creation and user creation inside `BEGIN � COMMIT` / `ROLLBACK`.
- **Migration**: `db/migrations/001_identity_domain.sql` � `tenants` and `users` table definitions with foreign key `ON DELETE CASCADE`.
- **BUILDLOG**: Phase 2A � "Registration Transaction Integrity" decision.

### REQ-AUTH-2: Anti-Enumeration Login

**Evidence:**

- **Test file**: `tests/auth.test.ts`
  - Test: `"returns 401 for unknown email"` � same HTTP 401 / same body as wrong password test.
  - Test: `"returns 401 for wrong password"` � confirms identical error envelope regardless of whether email exists.
- **Source**: `src/modules/auth/auth.service.ts` � both branches (`userNotFound`, `passwordMismatch`) return the same generic `"Invalid email or password"` message.

### REQ-AUTH-3: Stateless JWT Bearer Authentication

**Evidence:**

- **Test file**: `tests/auth.test.ts` � `GET /api/v1/auth/me` tests: 401 on missing token, 401 on malformed token, 200 with correct token.
- **Test file**: `tests/tenant-isolation.test.ts` � verifies that Tenant B's JWT cannot access Tenant A's resources.
- **Source**: `src/middleware/auth.middleware.ts` � `requireAuth` middleware verifies signature and attaches `{ userId, tenantId, role }` to `req.auth`.

### REQ-AUTH-4: Strict Repository-Level Tenant Isolation

**Evidence:**

- **Test file**: `tests/tenant-isolation.test.ts` (5 tests)
  - Tests that Tenant B token querying Tenant A widget returns `404 NOT_FOUND`.
  - Tests that Tenant B cannot see Tenant A submissions via dashboard.
- **Source**: All repository files include mandatory `tenant_id` clause:
  - `src/modules/widgets/widget.repository.ts` � `WHERE id = \ AND tenant_id = \`
  - `src/modules/submissions/submission.repository.ts`
  - `src/modules/dashboard/dashboard.repository.ts`

---

## 2. Widget Management & Delivery

### REQ-WIDGET-1: Tenant-Scoped CRUD

**Evidence:**

- **Test file**: `tests/widget-crud.test.ts` (15 tests)
  - `POST /api/v1/widgets` � 201 Created with embed snippet.
  - `GET /api/v1/widgets` � lists only the requesting tenant's widgets.
  - `GET /api/v1/widgets/:id` � 404 for cross-tenant IDs.
  - `PATCH /api/v1/widgets/:id` � updates config fields.
  - `DELETE /api/v1/widgets/:id` � soft deactivation (is_active = false).
- **Migration**: `db/migrations/002_widget_domain.sql`

### REQ-WIDGET-2: Version Tracking on Update

**Evidence:**

- **Test file**: `tests/widget-crud.test.ts`
  - Test: `"increments version on PATCH"` � confirms `version` goes from 1 to 2 after a PATCH.
- **Source**: `src/modules/widgets/widget.repository.ts` � `UPDATE � SET version = version + 1` in update query.

### REQ-WIDGET-3: Public Widget Delivery (GET /widget.js)

**Evidence:**

- **Test file**: `tests/widget-delivery.test.ts` (11 tests)
  - `GET /widget.js?id=<uuid>` � 200 OK, Content-Type: application/javascript.
  - Test: verifies response is valid JavaScript loader code.
  - Test: `GET /widget.js` without `id` returns 400 Bad Request.
- **Source**: `src/modules/widgets/widget-loader.ts`

### REQ-WIDGET-4: Public Config Endpoint with ETag & Origin Allowlist

**Evidence:**

- **Test file**: `tests/widget-delivery.test.ts`
  - Test: `"returns 200 with ETag for allowed origin"`.
  - Test: `"returns 304 Not Modified on ETag revalidation"`.
  - Test: `"returns 403 for disallowed origin"`.
- **Source**: `src/modules/widgets/widget-delivery.routes.ts`

### REQ-WIDGET-5: XSS-Safe DOM Rendering in widget.js

**Evidence:**

- **Test file**: `tests/dashboard-frontend.test.ts`
  - Test: `"never uses innerHTML in dashboard.js"` � static analysis assertion on `public/dashboard/dashboard.js`.
- **Source**: `public/dashboard/dashboard.js` � uses exclusively `element.textContent`, `document.createTextNode`, and `document.createElement`; zero `innerHTML` on user-controlled data.
- **BUILDLOG**: Phase 3B � "Anti-XSS by Construction" decision; Final Hardening � "Dashboard UI Anti-XSS Hardening" fix.

---

## 3. Public Submission Pipeline

### REQ-SUB-1: Valid Cross-Origin Submission � 201 Created

**Evidence:**

- **Test file**: `tests/submissions.test.ts`
  - Test: `"returns 201 for valid submission from allowed origin"`.
  - Test: `"response includes submissionId, createdAt, receivedAt"`.
- **BUILDLOG**: Phase 2C-1 � Live manual probe A: HTTP 201 Created, Access-Control-Allow-Origin: http://localhost:5000.

### REQ-SUB-2: Per-Widget Origin Allowlist (CORS)

**Evidence:**

- **Test file**: `tests/submissions.test.ts`
  - Test: `"returns 403 for disallowed origin"`.
- **Test file**: `tests/widget-delivery.test.ts` � same mechanism on /config endpoint.
- **Source**: `src/modules/submissions/submission.service.ts` � `validateOrigin()` against `widget.allowedOrigins`.

### REQ-SUB-3: 16 KB Payload Size Guard � 413

**Evidence:**

- **Test file**: `tests/submissions.test.ts`
  - Test: `"returns 413 when body exceeds 16KB"`.
- **Source**: `src/app.ts` � `express.json({ limit: '16kb' })` body parser limit; `errorHandler` maps `entity.too.large` to `413 PAYLOAD_TOO_LARGE`.
- **BUILDLOG**: Phase 2C-1 � "16 KB Payload Size Guard" decision.

### REQ-SUB-4: Dynamic Field Schema Validation � 400

**Evidence:**

- **Test file**: `tests/submissions.test.ts`
  - Test: `"returns 400 for missing required field"`.
  - Test: `"returns 400 for unknown field in payload"`.
  - Test: `"returns 400 for invalid email field format"`.
- **Source**: `src/modules/submissions/submission.service.ts` � validates `data` payload against `widget.fieldsConfig` using Zod.

### REQ-SUB-5: Idempotency � 200 Replay / 409 Conflict

**Evidence:**

- **Test file**: `tests/submissions.test.ts`
  - Test: `"returns 200 with idempotentReplay=true on duplicate key+payload"`.
  - Test: `"returns 409 IDEMPOTENCY_CONFLICT on same key with different payload"`.
  - Test: `"same idempotency key for different widgets is independent"`.
- **Source**: `src/modules/submissions/submission.repository.ts` � `INSERT � ON CONFLICT � DO NOTHING` with partial unique index.
- **Migration**: `db/migrations/003_submissions_domain.sql` � `idx_submissions_widget_idempotency`.

### REQ-SUB-6: Server-Authoritative Tenant Resolution

**Evidence:**

- **Test file**: `tests/submissions.test.ts`
  - Test: `"tenant_id resolved from widget owner, not client body"`.
- **Source**: `src/modules/submissions/submission.service.ts` � `tenant_id` derived exclusively from `widget.tenantId` fetched from DB.

---

## 4. Abuse Protection

### REQ-ABUSE-1: IP-Based Rate Limiting � 429

**Evidence:**

- **Test file**: `tests/abuse-and-geo.test.ts` (17 tests)
  - Test: `"allows requests under rate limit threshold"`.
  - Test: `"returns 429 RATE_LIMIT_EXCEEDED after burst"`.
  - Test: `"response includes Retry-After header"`.
- **Source**: `src/modules/submissions/rate-limiter.ts` � in-memory sliding-window, 60 req/min per IP.

### REQ-ABUSE-2: Honeypot Spam Detection � 400

**Evidence:**

- **Test file**: `tests/abuse-and-geo.test.ts`
  - Test: `"returns 400 SPAM_DETECTED when _hp_title is non-empty"`.
  - Test: `"returns 400 SPAM_DETECTED when _website honeypot is filled"`.
  - Test: `"honeypot rejection does not insert any DB rows"`.
- **Source**: `src/modules/submissions/submission.service.ts` � checks `body._hp_title` and `body._website` before any DB operations.

---

## 5. Geo-Enrichment & Graceful Degradation

### REQ-GEO-1: Provider Failover (A to B to Null)

**Evidence:**

- **Test file**: `tests/abuse-and-geo.test.ts`
  - Test: `"geo enrichment uses Provider A on success"`.
  - Test: `"geo enrichment falls back to Provider B on Provider A failure"`.
  - Test: `"geo enrichment degrades to null when both providers fail"`.
  - Test: `"submission succeeds (201) even when geo enrichment fails"`.
- **Source**: `src/providers/geo/geo.service.ts` � sequential strategy with Promise.race timeout (500ms).
- **Source**: `src/providers/geo/mock-provider-a.ts`, `src/providers/geo/mock-provider-b.ts`

### REQ-GEO-2: Idempotent Replay Skips Geo

**Evidence:**

- **Test file**: `tests/abuse-and-geo.test.ts`
  - Test: `"idempotent replay does not call geo provider"`.

---

## 6. Background Jobs & Transactional Outbox

### REQ-JOBS-1: Atomic Submission + Job Creation

**Evidence:**

- **Test file**: `tests/jobs-and-worker.test.ts` (18 tests)
  - Test: `"creates a pending job in the same transaction as submission"`.
  - Test: `"if job insert fails, submission is also rolled back"`.
- **Source**: `src/modules/submissions/submission.service.ts` � BEGIN transaction, insert submission, insert job, COMMIT.

### REQ-JOBS-2: Safe Row Claiming with FOR UPDATE SKIP LOCKED

**Evidence:**

- **Test file**: `tests/jobs-and-worker.test.ts`
  - Test: `"worker claims job with FOR UPDATE SKIP LOCKED"`.
- **Source**: `src/workers/job-worker.ts` � polling query includes FOR UPDATE SKIP LOCKED.
- **Migration**: `db/migrations/004_jobs_domain.sql` � `idx_jobs_claim` partial index.

### REQ-JOBS-3: Exponential Backoff Retries

**Evidence:**

- **Test file**: `tests/jobs-and-worker.test.ts`
  - Test: `"schedules retry with exponential backoff delay (30s, 120s, 600s)"`.
- **Source**: `src/modules/jobs/job.repository.ts` � backoff schedule array [30, 120, 600] seconds.

### REQ-JOBS-4: Dead-Letter After Max Attempts

**Evidence:**

- **Test file**: `tests/jobs-and-worker.test.ts`
  - Test: `"marks job as failed and writes to job_failures after max attempts"`.
- **Source**: `src/workers/job-worker.ts` � after 4 total attempts, sets status = 'failed' and inserts into job_failures.

### REQ-JOBS-5: Stale Lock Recovery

**Evidence:**

- **Test file**: `tests/jobs-and-worker.test.ts`
  - Test: `"recovers stale processing jobs on worker startup"`.
- **Source**: `src/workers/job-worker.ts` � on startup, resets jobs stuck in status = 'processing' for > 5 minutes back to pending.

---

## 7. Dashboard Backend APIs

### REQ-DASH-1: Paginated Lead List

**Evidence:**

- **Test file**: `tests/dashboard.test.ts` (39 tests) � tests for page, limit (max 100), sort whitelist, widgetId filter, ISO from/to date range.
- **Source**: `src/modules/dashboard/dashboard.repository.ts`

### REQ-DASH-2: Aggregate Statistics (Single-Query SQL)

**Evidence:**

- **Test file**: `tests/dashboard.test.ts`
  - Test: `"returns totalSubmissions, today, thisWeek, thisMonth, byWidget"`.
- **Source**: `src/modules/dashboard/dashboard.repository.ts` � single SQL query using FILTER (WHERE ...) aggregates.

### REQ-DASH-3: Cross-Tenant 404 (No Object Enumeration)

**Evidence:**

- **Test file**: `tests/dashboard.test.ts`
  - Test: `"returns 404 for submission belonging to another tenant"`.
  - Test: `"returns 404 for non-existent submission ID"` � same HTTP response, preventing leakage.

### REQ-DASH-4: Job Queue Monitor

**Evidence:**

- **Test file**: `tests/dashboard.test.ts`
  - Test: `"returns paginated jobs for tenant"`.
  - Test: `"filters jobs by status"`.

---

## 8. Dashboard Frontend (SPA)

### REQ-FE-1: SPA Shell Served at /dashboard

**Evidence:**

- **Test file**: `tests/dashboard-frontend.test.ts`
  - Test: `"GET /dashboard returns 200 with HTML"`.
  - Test: `"GET / redirects to /dashboard with 302"`.
  - Test: `"serves dashboard.css"`.
  - Test: `"serves dashboard.js"`.

### REQ-FE-2: Anti-XSS Safe Rendering

**Evidence:**

- **Test file**: `tests/dashboard-frontend.test.ts`
  - Test: `"never uses innerHTML in dashboard.js"` � static source code analysis.
  - Test: `"malicious payload is rendered as plain text"` � verifies `<script>alert("XSS")</script>` appears as an inert text string.
- **Source**: `public/dashboard/dashboard.js` � `createSafeTextElement()` helper exclusively uses DOM textContent and createTextNode.
- **Live proof**: Browser probe Q (BUILDLOG Phase 3B) � submitted `<script>alert("XSS")</script>` via the demo harness and confirmed it rendered as plain text in the dashboard table and detail modal.

### REQ-FE-3: Widget Embed Snippet Copy

**Evidence:**

- **Test file**: `tests/dashboard-frontend.test.ts`
  - Test: `"GET /api/v1/dashboard/widgets returns widgets with embed snippet"`.
- **Source**: `public/dashboard/dashboard.js` � `copyToClipboard()` function triggered on widget card button click.

---

## 9. Security & Compliance

### REQ-SEC-1: No Wildcard CORS

**Evidence:**

- **Test file**: `tests/submissions.test.ts` � all allowed-origin tests verify exact-match echo, not *.
- **Source**: `src/modules/submissions/submission.service.ts` � explicit origin comparison; * is never produced.

### REQ-SEC-2: Password Hash Never Exposed in API Response

**Evidence:**

- **Test file**: `tests/auth.test.ts`
  - Test: `"register response does not contain password_hash"`.
  - Test: `"login response does not contain password_hash"`.
- **Source**: `src/modules/auth/auth.service.ts` � password_hash is stripped via destructuring before any response is serialized.

### REQ-SEC-3: .env Never Committed

**Evidence:**

- **`.gitignore`**: .env listed explicitly.
- **BUILDLOG**: Phase 0 � "Git Security & Tracking Check": git status --ignored confirmed .env is ignored.
- **BUILDLOG**: Every phase ends with "Git Security & Secret Audit" confirming zero secrets present.

### REQ-SEC-4: No SQL Injection

**Evidence:**

- **Source**: All repository files use parameterized queries exclusively (, , ... with pg Pool query(sql, params) pattern). No string interpolation into SQL.
  - `src/modules/widgets/widget.repository.ts`
  - `src/modules/submissions/submission.repository.ts`
  - `src/modules/dashboard/dashboard.repository.ts`

### REQ-SEC-5: Payload Privacy in Public Responses

**Evidence:**

- **Test file**: `tests/submissions.test.ts`
  - Test: `"submission response does not include ip_address or user_agent"`.
- **Test file**: `tests/dashboard.test.ts`
  - Test: `"submission detail does not expose visitor ip or user_agent"`.

---

## 10. Test Summary

| Test File                          | Tests   | Description                                 |
| ---------------------------------- | ------- | ------------------------------------------- |
| `tests/health.test.ts`             | 1       | Health endpoint                             |
| `tests/db.test.ts`                 | 2       | Database connectivity                       |
| `tests/auth.test.ts`               | 13      | Registration, login, JWT, anti-enumeration  |
| `tests/tenant-isolation.test.ts`   | 5       | Cross-tenant boundary enforcement           |
| `tests/widget-crud.test.ts`        | 15      | Widget CRUD, versioning, soft-delete        |
| `tests/widget-delivery.test.ts`    | 11      | Loader JS, config, ETag, origin allowlist   |
| `tests/submissions.test.ts`        | 20      | Full submission pipeline, idempotency, CORS |
| `tests/abuse-and-geo.test.ts`      | 17      | Rate limiting, honeypot, geo fallback       |
| `tests/jobs-and-worker.test.ts`    | 18      | Transactional outbox, retries, dead-letter  |
| `tests/dashboard.test.ts`          | 39      | All dashboard API endpoints                 |
| `tests/dashboard-frontend.test.ts` | 10      | SPA delivery, anti-XSS static analysis      |
| **Total**                          | **151** | **100% pass rate**                          |

Run: `npm test` to reproduce.

---

## 11. Verified Test Run Output

The following output was captured during Phase 3B verification (BUILDLOG line 770):

`Test Files  11 passed (11)
Tests       151 passed (151)
Duration    ~4.5s`

All 151 tests pass deterministically across multiple consecutive runs. Test suite is isolated
using per-test tenant namespacing and afterAll cleanup to prevent cross-suite interference.
