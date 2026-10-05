import { z } from 'zod';

export const normalizeOrigin = (val: string): string => {
  return val.trim().replace(/\/+$/, '').toLowerCase();
};

export const isValidOrigin = (val: string): boolean => {
  if (val === '*' || val.includes('*')) return false;
  try {
    const normalized = normalizeOrigin(val);
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    // Ensure no path, query, or hash was specified
    return url.origin === normalized;
  } catch {
    return false;
  }
};

const originFieldSchema = z
  .string()
  .trim()
  .refine(isValidOrigin, {
    message:
      'Allowed origin must be a valid http or https origin (e.g., http://localhost:5000 or https://example.com) and cannot be wildcard (*)',
  })
  .transform(normalizeOrigin);

export const widgetFieldSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Field name cannot be empty')
    .max(50, 'Field name cannot exceed 50 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Field name must contain only letters, numbers, and underscores'),
  type: z.enum(['text', 'email', 'textarea'], {
    message: 'Field type must be text, email, or textarea',
  }),
  label: z
    .string()
    .trim()
    .min(1, 'Field label cannot be empty')
    .max(100, 'Field label cannot exceed 100 characters'),
  required: z.boolean().default(false),
});

export const widgetThemeSchema = z.object({
  primaryColor: z
    .string()
    .trim()
    .regex(
      /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
      'primaryColor must be a valid hex color code (e.g. #3b82f6 or #111827)',
    )
    .default('#111827'),
  buttonText: z
    .string()
    .trim()
    .min(1, 'buttonText cannot be empty')
    .max(50, 'buttonText cannot exceed 50 characters')
    .default('Submit'),
});

export const createWidgetSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Widget name cannot be empty')
    .max(100, 'Widget name cannot exceed 100 characters'),
  allowedOrigins: z
    .array(originFieldSchema)
    .min(1, 'At least one allowed origin is required')
    .max(20, 'Cannot specify more than 20 allowed origins'),
  fields: z
    .array(widgetFieldSchema)
    .min(1, 'Widget must contain at least one field')
    .max(20, 'Widget cannot contain more than 20 fields'),
  theme: widgetThemeSchema.default({
    primaryColor: '#111827',
    buttonText: 'Submit',
  }),
  isActive: z.boolean().default(true),
});

export const updateWidgetSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Widget name cannot be empty')
    .max(100, 'Widget name cannot exceed 100 characters')
    .optional(),
  allowedOrigins: z
    .array(originFieldSchema)
    .min(1, 'At least one allowed origin is required')
    .max(20, 'Cannot specify more than 20 allowed origins')
    .optional(),
  fields: z
    .array(widgetFieldSchema)
    .min(1, 'Widget must contain at least one field')
    .max(20, 'Widget cannot contain more than 20 fields')
    .optional(),
  theme: widgetThemeSchema.optional(),
  isActive: z.boolean().optional(),
});

export type CreateWidgetInput = z.infer<typeof createWidgetSchema>;
export type UpdateWidgetInput = z.infer<typeof updateWidgetSchema>;
