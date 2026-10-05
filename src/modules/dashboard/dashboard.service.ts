import { widgetRepository } from '../widgets/widget.repository.js';
import { dashboardRepository } from './dashboard.repository.js';
import {
  listSubmissionsQuerySchema,
  statsQuerySchema,
  listJobsQuerySchema,
  idParamSchema,
} from './dashboard.schema.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import type {
  DashboardSubmissionsListResponse,
  DashboardSubmission,
  DashboardStats,
  DashboardJobsListResponse,
  DashboardWidgetsListResponse,
} from './dashboard.types.js';

export class DashboardService {
  /**
   * Lists submissions for the authenticated tenant with pagination, sorting, and filters.
   */
  async listSubmissions(
    tenantId: string,
    rawQuery: unknown,
  ): Promise<DashboardSubmissionsListResponse> {
    const parseResult = listSubmissionsQuerySchema.safeParse(rawQuery);

    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      throw new ValidationError('Validation failed', issues);
    }

    const { page, limit, widgetId, sort, from, to } = parseResult.data;

    // Verify widget ownership if filtering by widgetId
    if (widgetId) {
      const widget = await widgetRepository.findByIdAndTenant(widgetId, tenantId);
      if (!widget) {
        throw new NotFoundError('Widget not found');
      }
    }

    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;

    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      throw new ValidationError('Validation failed', [
        { field: 'from', message: 'From date cannot be after to date' },
      ]);
    }

    const filter = {
      widgetId,
      from: fromDate,
      to: toDate,
      sort,
      page,
      limit,
    };

    const [data, total] = await Promise.all([
      dashboardRepository.listSubmissions(tenantId, filter),
      dashboardRepository.countSubmissions(tenantId, {
        widgetId,
        from: fromDate,
        to: toDate,
      }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * Retrieves single submission detail by ID strictly within tenant context.
   */
  async getSubmission(submissionId: string, tenantId: string): Promise<DashboardSubmission> {
    const parseResult = idParamSchema.safeParse({ id: submissionId });
    if (!parseResult.success) {
      throw new ValidationError('Validation failed', [
        { field: 'id', message: parseResult.error.issues[0]?.message || 'Invalid ID' },
      ]);
    }

    const submission = await dashboardRepository.getSubmissionById(submissionId, tenantId);
    if (!submission) {
      throw new NotFoundError('Submission not found');
    }

    return submission;
  }

  /**
   * Computes aggregated submission statistics strictly for the tenant.
   */
  async getStats(tenantId: string, rawQuery: unknown): Promise<DashboardStats> {
    const parseResult = statsQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      throw new ValidationError('Validation failed', [
        { field: 'widgetId', message: parseResult.error.issues[0]?.message || 'Invalid widgetId' },
      ]);
    }

    const { widgetId } = parseResult.data;

    if (widgetId) {
      const widget = await widgetRepository.findByIdAndTenant(widgetId, tenantId);
      if (!widget) {
        throw new NotFoundError('Widget not found');
      }
    }

    return dashboardRepository.getStats(tenantId, widgetId);
  }

  /**
   * Lists background jobs for the authenticated tenant.
   */
  async listJobs(tenantId: string, rawQuery: unknown): Promise<DashboardJobsListResponse> {
    const parseResult = listJobsQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      throw new ValidationError('Validation failed', issues);
    }

    const { page, limit, status } = parseResult.data;

    const [data, total] = await Promise.all([
      dashboardRepository.listJobs(tenantId, page, limit, status),
      dashboardRepository.countJobs(tenantId, status),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * Lists widgets for the authenticated tenant.
   */
  async listWidgets(tenantId: string): Promise<DashboardWidgetsListResponse> {
    const widgets = await dashboardRepository.listWidgets(tenantId);
    return { data: widgets };
  }
}

export const dashboardService = new DashboardService();
