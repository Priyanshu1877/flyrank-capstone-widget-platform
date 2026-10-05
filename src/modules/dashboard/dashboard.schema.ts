import { z } from 'zod';

const isValidDateString = (val: string): boolean => {
  const parsed = Date.parse(val);
  return !isNaN(parsed);
};

export const listSubmissionsQuerySchema = z.object({
  page: z.coerce
    .number()
    .int('Page must be an integer')
    .min(1, 'Page must be greater than or equal to 1')
    .default(1),
  limit: z.coerce
    .number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be greater than or equal to 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  widgetId: z.string().uuid('Invalid widget ID format').optional(),
  sort: z
    .enum(['created_at_desc', 'created_at_asc', 'desc', 'asc'], {
      message: 'Invalid sort parameter. Permitted: created_at_desc, created_at_asc',
    })
    .default('created_at_desc'),
  from: z.string().refine(isValidDateString, { message: 'Invalid from date format' }).optional(),
  to: z.string().refine(isValidDateString, { message: 'Invalid to date format' }).optional(),
});

export const statsQuerySchema = z.object({
  widgetId: z.string().uuid('Invalid widget ID format').optional(),
});

export const listJobsQuerySchema = z.object({
  page: z.coerce
    .number()
    .int('Page must be an integer')
    .min(1, 'Page must be greater than or equal to 1')
    .default(1),
  limit: z.coerce
    .number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be greater than or equal to 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  status: z
    .enum(['pending', 'processing', 'completed', 'failed'], {
      message: 'Invalid status filter',
    })
    .optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});

export type ListSubmissionsQuery = z.infer<typeof listSubmissionsQuerySchema>;
export type StatsQuery = z.infer<typeof statsQuerySchema>;
export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;
