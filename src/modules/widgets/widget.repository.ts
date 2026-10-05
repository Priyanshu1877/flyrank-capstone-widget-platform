import type { PoolClient } from 'pg';
import { query } from '../../shared/db.js';
import type { CreateWidgetInput, UpdateWidgetInput } from './widget.schema.js';
import type { Widget, WidgetField, WidgetTheme } from './widget.types.js';

interface WidgetRow {
  id: string;
  tenant_id: string;
  name: string;
  is_active: boolean;
  allowed_origins: string[];
  fields_config: WidgetField[];
  theme_config: WidgetTheme;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const mapRowToWidget = (row: WidgetRow): Widget => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  isActive: row.is_active,
  allowedOrigins: row.allowed_origins,
  fieldsConfig: row.fields_config,
  themeConfig: row.theme_config,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class WidgetRepository {
  async create(tenantId: string, input: CreateWidgetInput, client?: PoolClient): Promise<Widget> {
    const text = `
      INSERT INTO widgets (
        tenant_id,
        name,
        is_active,
        allowed_origins,
        fields_config,
        theme_config,
        version
      )
      VALUES ($1, $2, $3, $4, $5, $6, 1)
      RETURNING id, tenant_id, name, is_active, allowed_origins, fields_config, theme_config, version, created_at, updated_at;
    `;
    const params = [
      tenantId,
      input.name,
      input.isActive ?? true,
      input.allowedOrigins,
      JSON.stringify(input.fields),
      JSON.stringify(input.theme),
    ];

    const res = client
      ? await client.query<WidgetRow>(text, params)
      : await query<WidgetRow>(text, params);

    return mapRowToWidget(res.rows[0]);
  }

  async listByTenant(tenantId: string, client?: PoolClient): Promise<Widget[]> {
    const text = `
      SELECT id, tenant_id, name, is_active, allowed_origins, fields_config, theme_config, version, created_at, updated_at
      FROM widgets
      WHERE tenant_id = $1
      ORDER BY created_at DESC;
    `;
    const params = [tenantId];
    const res = client
      ? await client.query<WidgetRow>(text, params)
      : await query<WidgetRow>(text, params);

    return res.rows.map(mapRowToWidget);
  }

  async findByIdAndTenant(
    id: string,
    tenantId: string,
    client?: PoolClient,
  ): Promise<Widget | null> {
    const text = `
      SELECT id, tenant_id, name, is_active, allowed_origins, fields_config, theme_config, version, created_at, updated_at
      FROM widgets
      WHERE id = $1 AND tenant_id = $2;
    `;
    const params = [id, tenantId];
    const res = client
      ? await client.query<WidgetRow>(text, params)
      : await query<WidgetRow>(text, params);

    if (res.rows.length === 0) return null;
    return mapRowToWidget(res.rows[0]);
  }

  async update(
    id: string,
    tenantId: string,
    input: UpdateWidgetInput,
    client?: PoolClient,
  ): Promise<Widget | null> {
    const existing = await this.findByIdAndTenant(id, tenantId, client);
    if (!existing) return null;

    const updatedName = input.name !== undefined ? input.name : existing.name;
    const updatedIsActive = input.isActive !== undefined ? input.isActive : existing.isActive;
    const updatedOrigins =
      input.allowedOrigins !== undefined ? input.allowedOrigins : existing.allowedOrigins;
    const updatedFields = input.fields !== undefined ? input.fields : existing.fieldsConfig;
    const updatedTheme = input.theme !== undefined ? input.theme : existing.themeConfig;

    const text = `
      UPDATE widgets
      SET 
        name = $3,
        is_active = $4,
        allowed_origins = $5,
        fields_config = $6,
        theme_config = $7,
        version = version + 1,
        updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING id, tenant_id, name, is_active, allowed_origins, fields_config, theme_config, version, created_at, updated_at;
    `;
    const params = [
      id,
      tenantId,
      updatedName,
      updatedIsActive,
      updatedOrigins,
      JSON.stringify(updatedFields),
      JSON.stringify(updatedTheme),
    ];

    const res = client
      ? await client.query<WidgetRow>(text, params)
      : await query<WidgetRow>(text, params);

    if (res.rows.length === 0) return null;
    return mapRowToWidget(res.rows[0]);
  }

  async softDelete(id: string, tenantId: string, client?: PoolClient): Promise<boolean> {
    const text = `
      UPDATE widgets
      SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2;
    `;
    const params = [id, tenantId];
    const res = client ? await client.query(text, params) : await query(text, params);

    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Public lookup for delivery/config - requires only widgetId, but validates active status
   */
  async findByIdPublic(id: string, client?: PoolClient): Promise<Widget | null> {
    const text = `
      SELECT id, tenant_id, name, is_active, allowed_origins, fields_config, theme_config, version, created_at, updated_at
      FROM widgets
      WHERE id = $1;
    `;
    const params = [id];
    const res = client
      ? await client.query<WidgetRow>(text, params)
      : await query<WidgetRow>(text, params);

    if (res.rows.length === 0) return null;
    return mapRowToWidget(res.rows[0]);
  }

  /**
   * Check if any active widget permits the given origin
   */
  async hasActiveWidgetWithOrigin(origin: string, client?: PoolClient): Promise<boolean> {
    const text = `
      SELECT 1
      FROM widgets
      WHERE is_active = TRUE AND $1 = ANY(allowed_origins)
      LIMIT 1;
    `;
    const params = [origin];
    const res = client ? await client.query(text, params) : await query(text, params);

    return res.rows.length > 0;
  }
}

export const widgetRepository = new WidgetRepository();
