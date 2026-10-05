import { widgetRepository } from '../widgets/widget.repository.js';
import { normalizeOrigin } from '../widgets/widget.schema.js';
import {
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  ConflictError,
} from '../../shared/errors.js';
import {
  arePayloadsEqual,
  type BaseSubmissionInput,
  validateSubmissionData,
} from './submission.schema.js';
import { submissionRepository } from './submission.repository.js';
import type { SubmissionResult } from './submission.types.js';

export interface SubmissionRequestMeta {
  origin?: string;
  ip?: string;
  userAgent?: string;
  idempotencyKey?: string;
}

export class SubmissionService {
  /**
   * Orchestrates the public submission pipeline:
   * 1. Widget resolution & active state verification
   * 2. Origin validation against widget allowed_origins
   * 3. Dynamic schema validation against configured fields
   * 4. Idempotency handling (first-time, replay, or conflict)
   * 5. Persistence into PostgreSQL
   */
  async submitLead(
    input: BaseSubmissionInput,
    meta: SubmissionRequestMeta,
  ): Promise<{ result: SubmissionResult; matchedOrigin: string | null; isNew: boolean }> {
    // 1. Resolve widget
    const widget = await widgetRepository.findByIdPublic(input.widgetId);
    if (!widget || !widget.isActive) {
      throw new NotFoundError('Widget not found or inactive');
    }

    // 2. Origin validation
    let matchedOrigin: string | null = null;
    if (meta.origin) {
      const normalized = normalizeOrigin(meta.origin);
      if (!normalized || !widget.allowedOrigins.includes(normalized)) {
        throw new ForbiddenError('Origin not allowed for this widget');
      }
      matchedOrigin = normalized;
    }

    // 3. Dynamic field validation
    const validatedData = validateSubmissionData(widget.fieldsConfig, input.data);

    // 4. Idempotency handling
    const key = meta.idempotencyKey?.trim() || null;

    if (key) {
      // Attempt conflict-safe insert
      const inserted = await submissionRepository.insert({
        tenantId: widget.tenantId,
        widgetId: widget.id,
        idempotencyKey: key,
        payload: validatedData,
        ipAddress: meta.ip || null,
        userAgent: meta.userAgent || null,
        origin: matchedOrigin || meta.origin || null,
      });

      if (inserted) {
        return {
          result: {
            status: 'success',
            submissionId: inserted.id,
            createdAt: inserted.createdAt.toISOString(),
            receivedAt: inserted.createdAt.toISOString(),
          },
          matchedOrigin,
          isNew: true,
        };
      }

      // Record already exists with (widget_id, idempotency_key)
      const existing = await submissionRepository.findByWidgetAndIdempotencyKey(widget.id, key);

      if (!existing) {
        throw new ConflictError('Concurrent idempotency conflict occurred');
      }

      // Check if existing payload matches incoming payload
      const isSamePayload = arePayloadsEqual(existing.payload, validatedData);
      if (!isSamePayload) {
        throw new IdempotencyConflictError();
      }

      // Identical idempotent replay
      return {
        result: {
          status: 'success',
          submissionId: existing.id,
          createdAt: existing.createdAt.toISOString(),
          receivedAt: existing.createdAt.toISOString(),
          idempotentReplay: true,
        },
        matchedOrigin,
        isNew: false,
      };
    }

    // 5. Non-idempotent submission (no key)
    const inserted = await submissionRepository.insert({
      tenantId: widget.tenantId,
      widgetId: widget.id,
      idempotencyKey: null,
      payload: validatedData,
      ipAddress: meta.ip || null,
      userAgent: meta.userAgent || null,
      origin: matchedOrigin || meta.origin || null,
    });

    if (!inserted) {
      throw new Error('Failed to insert submission record');
    }

    return {
      result: {
        status: 'success',
        submissionId: inserted.id,
        createdAt: inserted.createdAt.toISOString(),
        receivedAt: inserted.createdAt.toISOString(),
      },
      matchedOrigin,
      isNew: true,
    };
  }

  /**
   * Preflight verification for OPTIONS /api/v1/public/submissions
   */
  async handlePreflight(
    origin?: string,
    widgetId?: string,
  ): Promise<{ matchedOrigin: string | null }> {
    if (!origin) {
      return { matchedOrigin: null };
    }

    const normalized = normalizeOrigin(origin);
    if (!normalized) {
      throw new ForbiddenError('Invalid origin header');
    }

    if (widgetId) {
      const widget = await widgetRepository.findByIdPublic(widgetId);
      if (!widget || !widget.isActive) {
        throw new NotFoundError('Widget not found or inactive');
      }
      if (!widget.allowedOrigins.includes(normalized)) {
        throw new ForbiddenError('Origin not allowed for this widget');
      }
      return { matchedOrigin: normalized };
    }

    // If widgetId is not in preflight parameters, verify if origin is allowed by any active widget
    const isAllowed = await widgetRepository.hasActiveWidgetWithOrigin(normalized);
    if (!isAllowed) {
      throw new ForbiddenError('Origin not allowed');
    }

    return { matchedOrigin: normalized };
  }
}

export const submissionService = new SubmissionService();
