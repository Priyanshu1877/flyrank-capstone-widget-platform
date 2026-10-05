import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { widgetService } from './widget.service.js';

const router = Router();

// All widget management endpoints require authentication
router.use(requireAuth);

router.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.auth!.tenantId;
    const result = await widgetService.createWidget(tenantId, req.body);
    res.status(201).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.auth!.tenantId;
    const widgets = await widgetService.listWidgets(tenantId);
    res.status(200).json({
      status: 'success',
      data: widgets,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.auth!.tenantId;
    const widgetId = req.params.id as string;
    const result = await widgetService.getWidget(widgetId, tenantId);
    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.auth!.tenantId;
    const widgetId = req.params.id as string;
    const result = await widgetService.updateWidget(widgetId, tenantId, req.body);
    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.auth!.tenantId;
    const widgetId = req.params.id as string;
    await widgetService.deleteWidget(widgetId, tenantId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export const widgetRouter = router;
