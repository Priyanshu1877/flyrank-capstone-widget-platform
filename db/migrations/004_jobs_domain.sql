-- Phase 2C-3: Background Jobs & Job Failures Domain Migration
-- Creates the persistent jobs table for the transactional outbox and worker claiming,
-- and the job_failures table for dead-letter recording and audit history.

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    payload JSONB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ NULL,
    locked_by TEXT NULL,
    last_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL
);

-- Indexes supporting worker claiming queries (pending/processing with available_at)
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs (status, available_at);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant_id ON jobs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_locked_at ON jobs (locked_at);

CREATE TABLE IF NOT EXISTS job_failures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL,
    error_code TEXT NULL,
    error_message TEXT NOT NULL,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes supporting failure history lookups by job and tenant
CREATE INDEX IF NOT EXISTS idx_job_failures_job_id ON job_failures (job_id);
CREATE INDEX IF NOT EXISTS idx_job_failures_tenant_id ON job_failures (tenant_id);
CREATE INDEX IF NOT EXISTS idx_job_failures_failed_at ON job_failures (failed_at DESC);
