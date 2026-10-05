import { query } from '../../shared/db.js';
import type {
  DashboardSubmission,
  DashboardStats,
  DashboardJobItem,
  DashboardWidgetItem,
  ListSubmissionsFilter,
} from './dashboard.types.js';

interface SubmissionDetailRow {
  id: string;
  widget_id: string;
  widget_name: string;
  payload: Record<string, unknown>;
  geo_country: string | null;
  geo_city: string | null;
  geo_provider: string | null;
  origin: string | null;
  created_at: Date;
}

interface StatsAggregateRow {
  total_submissions: number;
  today: number;
  this_week: number;
  this_month: number;
}

interface WidgetStatsRow {
  widget_id: string;
  widget_name: string;
  count: number;
}

interface JobRow {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  available_at: Date;
  created_at: Date;
  completed_at: Date | null;
  last_error: string | null;
}

interface WidgetRow {
  id: string;
  name: string;
  is_active: boolean;
  version: number;
  allowed_origins: string[];
  created_at: Date;
  updated_at: Date;
}

export class DashboardRepository {
  /**
   * Retrieves paginated submissions strictly scoped to tenantId.
   */
  async listSubmissions(
    tenantId: string,
    filter: ListSubmissionsFilter,
  ): Promise<DashboardSubmission[]> {
    const conditions: string[] = ['s.tenant_id = $1'];
    const values: unknown[] = [tenantId];
    let idx = 2;

    if (filter.widgetId) {
      conditions.push(`s.widget_id = $${idx++}`);
      values.push(filter.widgetId);
    }

    if (filter.from) {
      conditions.push(`s.created_at >= $${idx++}`);
      values.push(filter.from);
    }

    if (filter.to) {
      conditions.push(`s.created_at < $${idx++}`);
      values.push(filter.to);
    }

    const sortOrder = filter.sort === 'created_at_asc' || filter.sort === 'asc' ? 'ASC' : 'DESC';

    const offset = (filter.page - 1) * filter.limit;
    values.push(filter.limit);
    const limitIdx = idx++;
    values.push(offset);
    const offsetIdx = idx;

    const text = `
      SELECT
        s.id,
        s.widget_id,
        w.name AS widget_name,
        s.payload,
        s.geo_country,
        s.geo_city,
        s.geo_provider,
        s.origin,
        s.created_at
      FROM submissions s
      INNER JOIN widgets w ON s.widget_id = w.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.created_at ${sortOrder}
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const res = await query<SubmissionDetailRow>(text, values);

    return res.rows.map((row) => ({
      id: row.id,
      submissionId: row.id,
      widgetId: row.widget_id,
      widgetName: row.widget_name,
      payload: row.payload,
      geoCountry: row.geo_country,
      geoCity: row.geo_city,
      geoProvider: row.geo_provider,
      origin: row.origin,
      createdAt: row.created_at.toISOString(),
    }));
  }

  /**
   * Counts submissions matching the active filters strictly within tenant context.
   */
  async countSubmissions(
    tenantId: string,
    filter: Pick<ListSubmissionsFilter, 'widgetId' | 'from' | 'to'>,
  ): Promise<number> {
    const conditions: string[] = ['s.tenant_id = $1'];
    const values: unknown[] = [tenantId];
    let idx = 2;

    if (filter.widgetId) {
      conditions.push(`s.widget_id = $${idx++}`);
      values.push(filter.widgetId);
    }

    if (filter.from) {
      conditions.push(`s.created_at >= $${idx++}`);
      values.push(filter.from);
    }

    if (filter.to) {
      conditions.push(`s.created_at < $${idx}`);
      values.push(filter.to);
    }

    const text = `
      SELECT COUNT(*)::int AS count
      FROM submissions s
      WHERE ${conditions.join(' AND ')};
    `;

    const res = await query<{ count: number }>(text, values);
    return res.rows[0].count;
  }

  /**
   * Retrieves single submission detail by ID strictly scoped to tenant.
   */
  async getSubmissionById(
    submissionId: string,
    tenantId: string,
  ): Promise<DashboardSubmission | null> {
    const text = `
      SELECT
        s.id,
        s.widget_id,
        w.name AS widget_name,
        s.payload,
        s.geo_country,
        s.geo_city,
        s.geo_provider,
        s.origin,
        s.created_at
      FROM submissions s
      INNER JOIN widgets w ON s.widget_id = w.id
      WHERE s.id = $1 AND s.tenant_id = $2;
    `;
    const res = await query<SubmissionDetailRow>(text, [submissionId, tenantId]);

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return {
      id: row.id,
      submissionId: row.id,
      widgetId: row.widget_id,
      widgetName: row.widget_name,
      payload: row.payload,
      geoCountry: row.geo_country,
      geoCity: row.geo_city,
      geoProvider: row.geo_provider,
      origin: row.origin,
      createdAt: row.created_at.toISOString(),
    };
  }

  /**
   * Computes aggregated submission metrics strictly within tenant context.
   */
  async getStats(tenantId: string, widgetId?: string): Promise<DashboardStats> {
    const aggregateText = `
      SELECT
        COUNT(*)::int AS total_submissions,
        COUNT(*) FILTER (WHERE s.created_at >= CURRENT_DATE)::int AS today,
        COUNT(*) FILTER (WHERE s.created_at >= DATE_TRUNC('week', NOW()))::int AS this_week,
        COUNT(*) FILTER (WHERE s.created_at >= DATE_TRUNC('month', NOW()))::int AS this_month
      FROM submissions s
      WHERE s.tenant_id = $1
        AND ($2::uuid IS NULL OR s.widget_id = $2);
    `;
    const aggRes = await query<StatsAggregateRow>(aggregateText, [tenantId, widgetId || null]);
    const agg = aggRes.rows[0];

    const byWidgetText = `
      SELECT
        w.id AS widget_id,
        w.name AS widget_name,
        COUNT(s.id)::int AS count
      FROM widgets w
      LEFT JOIN submissions s ON s.widget_id = w.id AND s.tenant_id = $1
      WHERE w.tenant_id = $1
        AND ($2::uuid IS NULL OR w.id = $2)
      GROUP BY w.id, w.name
      ORDER BY count DESC, w.name ASC;
    `;
    const widgetRes = await query<WidgetStatsRow>(byWidgetText, [tenantId, widgetId || null]);

    return {
      totalSubmissions: agg.total_submissions,
      today: agg.today,
      thisWeek: agg.this_week,
      thisMonth: agg.this_month,
      byWidget: widgetRes.rows.map((row) => ({
        widgetId: row.widget_id,
        widgetName: row.widget_name,
        count: row.count,
      })),
    };
  }

  /**
   * Retrieves background jobs for the tenant with optional status filter.
   */
  async listJobs(
    tenantId: string,
    page: number,
    limit: number,
    status?: string,
  ): Promise<DashboardJobItem[]> {
    const offset = (page - 1) * limit;
    const text = `
      SELECT
        id,
        job_type,
        status,
        attempts,
        max_attempts,
        available_at,
        created_at,
        completed_at,
        last_error
      FROM jobs
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR status = $2)
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4;
    `;
    const res = await query<JobRow>(text, [tenantId, status || null, limit, offset]);

    return res.rows.map((row) => ({
      id: row.id,
      jobType: row.job_type,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      availableAt: row.available_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      completedAt: row.completed_at ? row.completed_at.toISOString() : null,
      lastError: row.last_error,
    }));
  }

  /**
   * Counts background jobs matching status filter for tenant.
   */
  async countJobs(tenantId: string, status?: string): Promise<number> {
    const text = `
      SELECT COUNT(*)::int AS count
      FROM jobs
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR status = $2);
    `;
    const res = await query<{ count: number }>(text, [tenantId, status || null]);
    return res.rows[0].count;
  }

  /**
   * Lists safe widget metadata belonging strictly to the tenant.
   */
  async listWidgets(tenantId: string): Promise<DashboardWidgetItem[]> {
    const text = `
      SELECT id, name, is_active, version, allowed_origins, created_at, updated_at
      FROM widgets
      WHERE tenant_id = $1
      ORDER BY created_at DESC;
    `;
    const res = await query<WidgetRow>(text, [tenantId]);

    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      isActive: row.is_active,
      version: row.version,
      allowedOrigins: row.allowed_origins,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }
}

export const dashboardRepository = new DashboardRepository();
