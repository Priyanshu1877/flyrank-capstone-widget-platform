# Embeddable Widget & Lead-Capture Platform

## Project Overview

The FlyRank Embeddable Widget & Lead-Capture Platform is a multi-tenant backend system designed to allow customers to generate embeddable lead capture forms via a single-line `<script>` tag. The platform is designed to securely accept submissions across origins, enforce validation and anti-spam controls, perform geo-enrichment with provider failover, persist records in PostgreSQL, and trigger asynchronous background side-effects.

## Current Status

**Phase 0 — Project Foundation**

The repository is currently at the foundational setup stage. No business logic (authentication, widget CRUD, submission handling, rate limiting, or background workers) has been implemented yet. This phase establishes the environment, directory layout, tooling, containerized database, and a baseline health check endpoint.

## Planned Architecture

The planned system comprises:

- **Tenant Management & Authentication**: Secure JWT-based access for tenant administration.
- **Widget Service**: Generation, customization, and public serving of lightweight embed snippets.
- **Submission Gateway**: Public cross-origin endpoint with validation, rate limiting, and honeypot spam protection.
- **Geo-Enrichment**: Asynchronous or synchronous IP geolocation resolution with multiple fallback providers.
- **Relational Storage**: PostgreSQL database structured for multi-tenant isolation and fast analytical reporting.
- **Async Processing**: Durable background task queues for alerts and webhook deliveries.

A formal architecture specification will be produced in **Phase 1: Design**. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Tech Stack

- **Runtime & Language**: Node.js (v20+) with TypeScript (strict mode)
- **Framework**: Express
- **Database**: PostgreSQL 16 (via Docker Compose)
- **Validation**: Zod
- **Testing**: Vitest & Supertest
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

### 4. Run Development Server

```bash
npm run dev
```

The server will start at `http://localhost:4000`.

### 5. Run Tests

```bash
npm test
```

### 6. Type Check, Lint, and Format

```bash
npm run typecheck
npm run lint
npm run format:check
```

### 7. Production Build and Run

```bash
npm run build
npm start
```

## Project Structure

```
flyrank-capstone-widget-platform/
├── src/
│   ├── config/         # Environment parsing and typed schema validation (Zod)
│   ├── middleware/     # Custom Express middleware (placeholder)
│   ├── modules/        # Modular feature domains (auth, widgets, submissions) (placeholder)
│   ├── providers/      # External integrations (e.g., Geo-IP providers) (placeholder)
│   ├── shared/         # Shared utilities, database connections, and types (placeholder)
│   ├── app.ts          # Express application initialization and route mounting
│   └── server.ts       # Server entrypoint and lifecycle listener
├── tests/              # Test suites (Vitest / Supertest)
│   └── health.test.ts  # Minimal health endpoint test
├── db/
│   ├── migrations/     # Database migration scripts (placeholder)
│   └── seed/           # Database seed scripts (placeholder)
├── docs/               # Architectural and project documentation
│   └── ARCHITECTURE.md # High-level architecture and phase roadmap
├── demo/               # Local test harness and sample consumer sites (placeholder)
├── docker-compose.yml  # Local PostgreSQL service definition
├── .env.example        # Reference environment variables
├── .gitignore          # Git exclusion rules
├── .prettierrc         # Prettier formatting configuration
├── eslint.config.mjs   # ESLint configuration
├── tsconfig.json       # Strict TypeScript configuration
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
| `POSTGRES_USER`        | PostgreSQL superuser username                                 | `postgres`                                                                   |
| `POSTGRES_PASSWORD`    | PostgreSQL password for development                           | `postgres_dev_password`                                                      |
| `POSTGRES_DB`          | PostgreSQL target database                                    | `flyrank_widgets`                                                            |
| `POSTGRES_PORT`        | PostgreSQL host port binding                                  | `5432`                                                                       |
| `DATABASE_URL`         | Full PostgreSQL connection string                             | `postgresql://postgres:postgres_dev_password@localhost:5432/flyrank_widgets` |
| `JWT_SECRET`           | Secret token used for signing JWTs                            | _(placeholder)_                                                              |

## Health Check

Verify that the application is running by querying the health endpoint:

```bash
curl http://localhost:4000/health
```

Expected HTTP 200 response:

```json
{
  "status": "ok"
}
```

## Capstone Scope

The planned platform capabilities will include:

1. Multi-tenant customer accounts and authentication.
2. Form builder and configuration management for embeddable widgets.
3. Delivery of a lightweight `<script>` embed payload.
4. Cross-origin lead submission handling.
5. Ingestion validation and anti-spam detection.
6. Rate limiting at IP and tenant tiers.
7. Geo-location IP enrichment with automatic provider fallback.
8. Persistence to PostgreSQL with transactional integrity.
9. Asynchronous background event dispatcher.
10. Customer analytics and submissions management dashboard.

## Limitations

This is **Phase 0**. No business logic, database migrations, authentication, submission pipelines, rate limiters, or frontend widgets have been built yet. All operational functionality is deferred to subsequent project phases.
