import { env } from '../../config/env.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.js';
import {
  createWidgetSchema,
  normalizeOrigin,
  updateWidgetSchema,
  type CreateWidgetInput,
  type UpdateWidgetInput,
} from './widget.schema.js';
import { widgetRepository } from './widget.repository.js';
import type { PublicWidgetConfig, Widget } from './widget.types.js';

export const generateEmbedSnippet = (widgetId: string): string => {
  const baseUrl = env.WIDGET_BASE_URL.replace(/\/+$/, '');
  return `<script src="${baseUrl}/widget.js?id=${widgetId}" async defer></script>`;
};

export class WidgetService {
  async createWidget(
    tenantId: string,
    rawInput: unknown,
  ): Promise<{ widget: Widget; embedSnippet: string }> {
    const parseResult = createWidgetSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      throw new ValidationError('Validation failed for widget creation', issues);
    }

    const input: CreateWidgetInput = parseResult.data;
    const widget = await widgetRepository.create(tenantId, input);

    return {
      widget,
      embedSnippet: generateEmbedSnippet(widget.id),
    };
  }

  async listWidgets(tenantId: string): Promise<Widget[]> {
    return widgetRepository.listByTenant(tenantId);
  }

  async getWidget(id: string, tenantId: string): Promise<{ widget: Widget; embedSnippet: string }> {
    const widget = await widgetRepository.findByIdAndTenant(id, tenantId);
    if (!widget) {
      throw new NotFoundError('Widget not found');
    }

    return {
      widget,
      embedSnippet: generateEmbedSnippet(widget.id),
    };
  }

  async updateWidget(
    id: string,
    tenantId: string,
    rawInput: unknown,
  ): Promise<{ widget: Widget; embedSnippet: string }> {
    const parseResult = updateWidgetSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      throw new ValidationError('Validation failed for widget update', issues);
    }

    const input: UpdateWidgetInput = parseResult.data;
    const widget = await widgetRepository.update(id, tenantId, input);
    if (!widget) {
      throw new NotFoundError('Widget not found');
    }

    return {
      widget,
      embedSnippet: generateEmbedSnippet(widget.id),
    };
  }

  async deleteWidget(id: string, tenantId: string): Promise<void> {
    const deleted = await widgetRepository.softDelete(id, tenantId);
    if (!deleted) {
      throw new NotFoundError('Widget not found');
    }
  }

  async getPublicConfig(
    id: string,
    requestOrigin?: string,
  ): Promise<{
    config: PublicWidgetConfig;
    etag: string;
    matchedOrigin: string | null;
  }> {
    const widget = await widgetRepository.findByIdPublic(id);
    if (!widget || !widget.isActive) {
      throw new NotFoundError('Widget not found or inactive');
    }

    // Origin validation
    let matchedOrigin: string | null = null;
    if (requestOrigin) {
      const normalized = normalizeOrigin(requestOrigin);
      const isAllowed = widget.allowedOrigins.some(
        (allowed) => normalizeOrigin(allowed) === normalized,
      );

      if (!isAllowed) {
        throw new ForbiddenError(
          `Origin '${requestOrigin}' is not authorized to access widget '${id}'`,
        );
      }
      matchedOrigin = normalized;
    }

    const config: PublicWidgetConfig = {
      widgetId: widget.id,
      name: widget.name,
      isActive: widget.isActive,
      fields: widget.fieldsConfig,
      theme: widget.themeConfig,
      version: widget.version,
    };

    const etag = `W/"${widget.id}-v${widget.version}"`;

    return {
      config,
      etag,
      matchedOrigin,
    };
  }
}

export const widgetService = new WidgetService();
