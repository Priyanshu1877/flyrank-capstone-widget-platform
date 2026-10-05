export type WidgetFieldType = 'text' | 'email' | 'textarea';

export interface WidgetField {
  name: string;
  type: WidgetFieldType;
  label: string;
  required: boolean;
}

export interface WidgetTheme {
  primaryColor: string;
  buttonText: string;
}

export interface Widget {
  id: string;
  tenantId: string;
  name: string;
  isActive: boolean;
  allowedOrigins: string[];
  fieldsConfig: WidgetField[];
  themeConfig: WidgetTheme;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicWidgetConfig {
  widgetId: string;
  name: string;
  isActive: boolean;
  fields: WidgetField[];
  theme: WidgetTheme;
  version: number;
}
