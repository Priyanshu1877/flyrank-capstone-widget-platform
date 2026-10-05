import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { dashboardService } from './dashboard.service.js';

export const dashboardRouter: Router = Router();

// All dashboard management endpoints require authenticated tenant session
dashboardRouter.use(requireAuth);

/**
 * GET /api/v1/dashboard/submissions
 * Lists submissions belonging strictly to the authenticated tenant.
 * Supports pagination (page, limit), sorting (created_at_desc, created_at_asc),
 * widget filtering (widgetId), and date filtering (from, to).
 */
dashboardRouter.get(
  '/submissions',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.auth!.tenantId;
      const result = await dashboardService.listSubmissions(tenantId, req.query);
      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: result.pagination,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/dashboard/submissions/stats
 * Returns aggregated submission metrics for the tenant.
 * Note: Must be mounted before /submissions/:id to prevent route shadowing.
 */
dashboardRouter.get(
  '/submissions/stats',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.auth!.tenantId;
      const stats = await dashboardService.getStats(tenantId, req.query);
      res.status(200).json({
        status: 'success',
        data: stats,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/dashboard/submissions/:id
 * Retrieves single submission detail by ID strictly within tenant context.
 * Returns safe 404 for missing or foreign-tenant submissions.
 */
dashboardRouter.get(
  '/submissions/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.auth!.tenantId;
      const submissionId = req.params.id as string;
      const submission = await dashboardService.getSubmission(submissionId, tenantId);
      res.status(200).json({
        status: 'success',
        data: submission,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/dashboard/jobs
 * Lists operational background jobs belonging strictly to the tenant.
 */
dashboardRouter.get(
  '/jobs',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.auth!.tenantId;
      const result = await dashboardService.listJobs(tenantId, req.query);
      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: result.pagination,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/dashboard/widgets
 * Lists widgets belonging strictly to the authenticated tenant.
 */
dashboardRouter.get(
  '/widgets',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.auth!.tenantId;
      const result = await dashboardService.listWidgets(tenantId);
      res.status(200).json({
        status: 'success',
        data: result.data,
      });
    } catch (err) {
      next(err);
    }
  },
);
