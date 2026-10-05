# Architecture

## Status

Phase 0 — Initial foundation.

## Planned System

The FlyRank Embeddable Widget & Lead-Capture Platform is a multi-tenant backend system designed to power embeddable lead capture widgets across external websites. The platform enables customers to configure customizable forms, embed them via lightweight cross-origin script snippets, securely ingest visitor submissions, apply rate limiting and spam defenses, enrich submissions with geographic metadata via external fallback providers, persist submissions reliably in PostgreSQL, and orchestrate background processing asynchronously.

## Planned Components

The following components represent the future architecture of the platform. All components are currently **PLANNED** and will be formally designed in Phase 1:

- **Authentication**: Tenant registration, login, and secure stateless JWT session management. _(PLANNED)_
- **Widget Management**: CRUD operations for tenant widget configurations (fields, appearance, origins). _(PLANNED)_
- **Widget Delivery**: Fast, cache-friendly delivery of the embeddable script snippet and configuration payload to third-party host sites. _(PLANNED)_
- **Public Submission API**: CORS-enabled endpoint receiving visitor lead captures from external origins. _(PLANNED)_
- **Validation**: Schema-driven request payload validation using Zod. _(PLANNED)_
- **Rate Limiting**: IP and tenant-scoped submission rate limiting to prevent abuse. _(PLANNED)_
- **Spam Protection**: Honeypot detection, timestamp validation, and origin verification. _(PLANNED)_
- **Geo Enrichment**: IP geolocation resolution with primary and secondary provider fallback and test mocking. _(PLANNED)_
- **Persistence**: Relational data modeling in PostgreSQL with indexing, foreign keys, and multi-tenant scoping. _(PLANNED)_
- **Background Jobs**: Asynchronous processing with retry strategies for webhooks or notifications. _(PLANNED)_
- **Dashboard API**: Authenticated tenant APIs for viewing lead captures, statistics, and conversion analytics. _(PLANNED)_

## Phase 1

During Phase 1 (Design), the detailed system architecture will be established before any business implementation begins. This includes:

1. Entity relationship diagram and relational schema definitions.
2. API contract specifications and payload definitions.
3. Cross-origin embed and script isolation architecture.
4. Multi-tenancy isolation strategy.
5. Database indexing and query performance strategy.
6. Error handling, observability, and retry semantics.
7. Explicit architectural non-goals and system constraints.
