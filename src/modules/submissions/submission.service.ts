import { widgetRepository } from '../widgets/widget.repository.js';
import { normalizeOrigin } from '../widgets/widget.schema.js';
import {
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  ConflictError,
  RateLimitExceededError,
  SpamDetectedError,
} from '../../shared/errors.js';
import {
  arePayloadsEqual,
  type BaseSubmissionInput,
  validateSubmissionData,
} from './submission.schema.js';
import { submissionRepository } from './submission.repository.js';
import type { SubmissionResult } from './submission.types.js';
import { submissionRateLimiter } from './rate-limiter.js';
import { geoService } from '../../providers/geo/geo.service.js';
import type { GeoLocation } from '../../providers/geo/geo.types.js';

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
   * 4. Rate limiting (per-IP sliding window, before expensive work)
   * 5. Honeypot anti-spam trap check (_hp_title or _website)
   * 6. Idempotency evaluation (replay skips geo enrichment & insert)
   * 7. Geo enrichment (Provider A -> Provider B fallback -> nil degradation)
   * 8. Persistence into PostgreSQL
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

    // 4. Rate limiting (per-client IP, enforced before expensive enrichment)
    const clientIp = meta.ip || '127.0.0.1';
    const rateLimit = submissionRateLimiter.consume(clientIp);
    if (!rateLimit.allowed) {
      throw new RateLimitExceededError('Too many requests', rateLimit.retryAfterSeconds);
    }

    // 5. Honeypot anti-spam check (_hp_title or _website)
    const honeypotValue =
      input._hp_title ||
      input._website ||
      (typeof input.data?._hp_title === 'string' ? input.data._hp_title : undefined) ||
      (typeof input.data?._website === 'string' ? input.data._website : undefined);

    if (typeof honeypotValue === 'string' && honeypotValue.trim().length > 0) {
      console.warn(
        `[AntiSpam] Honeypot triggered for widget ${widget.id} from IP ${clientIp}. Suppressing submission.`,
      );
      throw new SpamDetectedError('Submission rejected');
    }

    // 6. Idempotency handling
    const key = meta.idempotencyKey?.trim() || null;

    if (key) {
      // Check if submission already exists with this key before executing geo enrichment
      const existing = await submissionRepository.findByWidgetAndIdempotencyKey(widget.id, key);

      if (existing) {
        // Compare payload
        const isSamePayload = arePayloadsEqual(existing.payload, validatedData);
        if (!isSamePayload) {
          throw new IdempotencyConflictError();
        }

        // Replay previous submission: zero duplicate insert, zero geo enrichment
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
    }

    // 7. Geo enrichment (Provider A -> Provider B fallback -> null)
    // Non-critical dependency: failures must never abort lead submission
    const geoData: GeoLocation | null = await geoService.lookup(clientIp).catch(() => null);

    // 8. Persistence into PostgreSQL
    if (key) {
      const inserted = await submissionRepository.insert({
        tenantId: widget.tenantId,
        widgetId: widget.id,
        idempotencyKey: key,
        payload: validatedData,
        ipAddress: meta.ip || null,
        userAgent: meta.userAgent || null,
        origin: matchedOrigin || meta.origin || null,
        geoCountry: geoData?.country || null,
        geoCity: geoData?.city || null,
        geoProvider: geoData?.provider || null,
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

      // Handled race condition: record was inserted concurrently
      const raceExisting = await submissionRepository.findByWidgetAndIdempotencyKey(widget.id, key);

      if (!raceExisting) {
        throw new ConflictError('Concurrent idempotency conflict occurred');
      }

      if (!arePayloadsEqual(raceExisting.payload, validatedData)) {
        throw new IdempotencyConflictError();
      }

      return {
        result: {
          status: 'success',
          submissionId: raceExisting.id,
          createdAt: raceExisting.createdAt.toISOString(),
          receivedAt: raceExisting.createdAt.toISOString(),
          idempotentReplay: true,
        },
        matchedOrigin,
        isNew: false,
      };
    }

    // Non-idempotent submission (no key)
    const inserted = await submissionRepository.insert({
      tenantId: widget.tenantId,
      widgetId: widget.id,
      idempotencyKey: null,
      payload: validatedData,
      ipAddress: meta.ip || null,
      userAgent: meta.userAgent || null,
      origin: matchedOrigin || meta.origin || null,
      geoCountry: geoData?.country || null,
      geoCity: geoData?.city || null,
      geoProvider: geoData?.provider || null,
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
