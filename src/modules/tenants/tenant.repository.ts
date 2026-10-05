import type { PoolClient } from 'pg';
import { query } from '../../shared/db.js';
import type { Tenant } from '../auth/auth.types.js';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
  updated_at: Date;
}

const mapRowToTenant = (row: TenantRow): Tenant => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class TenantRepository {
  async create(name: string, slug: string, client?: PoolClient): Promise<Tenant> {
    const text = `
      INSERT INTO tenants (name, slug)
      VALUES ($1, $2)
      RETURNING id, name, slug, created_at, updated_at;
    `;
    const params = [name, slug];
    const res = client
      ? await client.query<TenantRow>(text, params)
      : await query<TenantRow>(text, params);

    return mapRowToTenant(res.rows[0]);
  }

  async findById(id: string, client?: PoolClient): Promise<Tenant | null> {
    const text = `
      SELECT id, name, slug, created_at, updated_at
      FROM tenants
      WHERE id = $1;
    `;
    const params = [id];
    const res = client
      ? await client.query<TenantRow>(text, params)
      : await query<TenantRow>(text, params);

    if (res.rows.length === 0) return null;
    return mapRowToTenant(res.rows[0]);
  }

  async findBySlug(slug: string, client?: PoolClient): Promise<Tenant | null> {
    const text = `
      SELECT id, name, slug, created_at, updated_at
      FROM tenants
      WHERE slug = $1;
    `;
    const params = [slug];
    const res = client
      ? await client.query<TenantRow>(text, params)
      : await query<TenantRow>(text, params);

    if (res.rows.length === 0) return null;
    return mapRowToTenant(res.rows[0]);
  }
}

export const tenantRepository = new TenantRepository();
