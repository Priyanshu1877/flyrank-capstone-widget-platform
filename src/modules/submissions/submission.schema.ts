import { z } from 'zod';
import type { WidgetField } from '../widgets/widget.types.js';
import { ValidationError } from '../../shared/errors.js';

export const baseSubmissionSchema = z.object({
  widgetId: z.string().uuid('Invalid widget ID format'),
  data: z.record(z.string(), z.unknown()),
  _hp_title: z.string().optional(),
});

export type BaseSubmissionInput = z.infer<typeof baseSubmissionSchema>;

export interface FieldValidationErrorDetail {
  field: string;
  message: string;
}

/**
 * Validates dynamic submission data against the widget's configured fields.
 * Enforces:
 * - Presence of required fields
 * - Expected field types (text, email, textarea)
 * - Rejection of unconfigured/unknown fields
 * - Rejection of malformed/empty values where required
 */
export function validateSubmissionData(
  fieldsConfig: WidgetField[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const errors: FieldValidationErrorDetail[] = [];
  const allowedFieldNames = new Set(fieldsConfig.map((f) => f.name));

  // 1. Reject unknown / unconfigured fields
  for (const submittedKey of Object.keys(data)) {
    if (!allowedFieldNames.has(submittedKey)) {
      errors.push({
        field: `data.${submittedKey}`,
        message: `Field '${submittedKey}' is not configured for this widget`,
      });
    }
  }

  // 2. Validate configured fields
  const validatedPayload: Record<string, unknown> = {};

  for (const field of fieldsConfig) {
    const rawValue = data[field.name];

    // Check presence for required fields
    const isMissing =
      rawValue === undefined ||
      rawValue === null ||
      (typeof rawValue === 'string' && rawValue.trim() === '');

    if (field.required && isMissing) {
      errors.push({
        field: `data.${field.name}`,
        message: `Field '${field.label || field.name}' is required`,
      });
      continue;
    }

    if (isMissing) {
      // Optional field omitted
      continue;
    }

    // Type checking
    switch (field.type) {
      case 'text':
      case 'textarea': {
        if (typeof rawValue !== 'string') {
          errors.push({
            field: `data.${field.name}`,
            message: `Field '${field.label || field.name}' must be a string`,
          });
        } else {
          validatedPayload[field.name] = rawValue.trim();
        }
        break;
      }
      case 'email': {
        if (typeof rawValue !== 'string') {
          errors.push({
            field: `data.${field.name}`,
            message: `Field '${field.label || field.name}' must be a string`,
          });
        } else {
          const trimmed = rawValue.trim();
          const emailParsed = z.string().email().safeParse(trimmed);
          if (!emailParsed.success) {
            errors.push({
              field: `data.${field.name}`,
              message: `Field '${field.label || field.name}' must be a valid email address`,
            });
          } else {
            validatedPayload[field.name] = trimmed.toLowerCase();
          }
        }
        break;
      }
      default: {
        validatedPayload[field.name] = rawValue;
      }
    }
  }

  if (errors.length > 0) {
    throw new ValidationError('The submission payload failed validation checks.', errors);
  }

  return validatedPayload;
}

/**
 * Deep equality check for two payload objects independent of key insertion order.
 */
export function arePayloadsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeysDeep(a)) === JSON.stringify(sortKeysDeep(b));
}

function sortKeysDeep(val: unknown): unknown {
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(sortKeysDeep);
  }
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(val).sort()) {
    sorted[k] = sortKeysDeep((val as Record<string, unknown>)[k]);
  }
  return sorted;
}
