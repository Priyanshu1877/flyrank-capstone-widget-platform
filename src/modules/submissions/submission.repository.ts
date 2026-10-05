import type { PoolClient } from 'pg';
import { query } from '../../shared/db.js';
import type { InsertSubmissionParams, Submission } from './submission.types.js';

interface SubmissionRow {
  id: string;
  tenant_id: string;
  widget_id: string;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  origin: string | null;
  geo_country: string | null;
  geo_city: string | null;
  geo_provider: string | null;
  created_at: Date;
}

const mapRowToSubmission = (row: SubmissionRow): Submission => ({
  id: row.id,
  tenantId: row.tenant_id,
  widgetId: row.widget_id,
  idempotencyKey: row.idempotency_key,
  payload: row.payload,
  ipAddress: row.ip_address,
  userAgent: row.user_agent,
  origin: row.origin,
  geoCountry: row.geo_country,
  geoCity: row.geo_city,
  geoProvider: row.geo_provider,
  createdAt: row.created_at,
});

export class SubmissionRepository {
  /**
   * Attempts to insert a submission.
   * If (widget_id, idempotency_key) already exists, ON CONFLICT DO NOTHING returns null,
   * guaranteeing race-condition safety at the database level.
   */
  async insert(params: InsertSubmissionParams, client?: PoolClient): Promise<Submission | null> {
    const text = `
      INSERT INTO submissions (
        tenant_id,
        widget_id,
        idempotency_key,
        payload,
        ip_address,
        user_agent,
        origin,
        geo_country,
        geo_city,
        geo_provider
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (widget_id, idempotency_key) WHERE idempotency_key IS NOT NULL
      DO NOTHING
      RETURNING id, tenant_id, widget_id, idempotency_key, payload, ip_address, user_agent, origin, geo_country, geo_city, geo_provider, created_at;
    `;
    const values = [
      params.tenantId,
      params.widgetId,
      params.idempotencyKey || null,
      JSON.stringify(params.payload),
      params.ipAddress || null,
      params.userAgent || null,
      params.origin || null,
      params.geoCountry || null,
      params.geoCity || null,
      params.geoProvider || null,
    ];

    const res = client
      ? await client.query<SubmissionRow>(text, values)
      : await query<SubmissionRow>(text, values);

    if (res.rows.length === 0) {
      return null;
    }

    return mapRowToSubmission(res.rows[0]);
  }

  async findByWidgetAndIdempotencyKey(
    widgetId: string,
    idempotencyKey: string,
    client?: PoolClient,
  ): Promise<Submission | null> {
    const text = `
      SELECT id, tenant_id, widget_id, idempotency_key, payload, ip_address, user_agent, origin, geo_country, geo_city, geo_provider, created_at
      FROM submissions
      WHERE widget_id = $1 AND idempotency_key = $2;
    `;
    const values = [widgetId, idempotencyKey];

    const res = client
      ? await client.query<SubmissionRow>(text, values)
      : await query<SubmissionRow>(text, values);

    if (res.rows.length === 0) {
      return null;
    }

    return mapRowToSubmission(res.rows[0]);
  }

  async findById(id: string, client?: PoolClient): Promise<Submission | null> {
    const text = `
      SELECT id, tenant_id, widget_id, idempotency_key, payload, ip_address, user_agent, origin, geo_country, geo_city, geo_provider, created_at
      FROM submissions
      WHERE id = $1;
    `;
    const values = [id];

    const res = client
      ? await client.query<SubmissionRow>(text, values)
      : await query<SubmissionRow>(text, values);

    if (res.rows.length === 0) {
      return null;
    }

    return mapRowToSubmission(res.rows[0]);
  }
}

export const submissionRepository = new SubmissionRepository();
