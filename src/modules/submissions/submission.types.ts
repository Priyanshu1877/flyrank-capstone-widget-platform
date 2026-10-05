export interface Submission {
  id: string;
  tenantId: string;
  widgetId: string;
  idempotencyKey: string | null;
  payload: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  origin: string | null;
  geoCountry: string | null;
  geoCity: string | null;
  geoProvider: string | null;
  createdAt: Date;
}

export interface CreateSubmissionDto {
  widgetId: string;
  data: Record<string, unknown>;
  _hp_title?: string;
}

export interface InsertSubmissionParams {
  tenantId: string;
  widgetId: string;
  idempotencyKey?: string | null;
  payload: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  origin?: string | null;
}

export interface SubmissionResult {
  status: 'success';
  submissionId: string;
  createdAt: string;
  receivedAt: string;
  idempotentReplay?: boolean;
}
