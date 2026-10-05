-- Phase 2C-1: Submissions Domain Migration
-- Creates the submissions table and partial unique index for idempotency duplicate prevention.

CREATE TABLE IF NOT EXISTS submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    widget_id UUID NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
    idempotency_key TEXT NULL,
    payload JSONB NOT NULL,
    ip_address TEXT NULL,
    user_agent TEXT NULL,
    origin TEXT NULL,
    geo_country TEXT NULL,
    geo_city TEXT NULL,
    geo_provider TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique index ensuring that within a widget, an idempotency key cannot be inserted twice
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_widget_idempotency
ON submissions (widget_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

-- Indexes for tenant isolation, widget filtering, and timeline ordering
CREATE INDEX IF NOT EXISTS idx_submissions_tenant_id ON submissions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_submissions_widget_id ON submissions (widget_id);
CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_tenant_created ON submissions (tenant_id, created_at DESC);
