-- Migration: 002_widget_domain.sql
-- Description: Create widgets table with foreign keys, indexes, and defaults

CREATE TABLE IF NOT EXISTS widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_origins TEXT[] NOT NULL DEFAULT '{}',
  fields_config JSONB NOT NULL DEFAULT '[]',
  theme_config JSONB NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for tenant-scoped widget queries
CREATE INDEX IF NOT EXISTS idx_widgets_tenant_id ON widgets(tenant_id);
