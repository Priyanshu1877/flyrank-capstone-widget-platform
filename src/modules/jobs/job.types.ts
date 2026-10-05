export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job {
  id: string;
  tenantId: string;
  jobType: string;
  status: JobStatus;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface CreateJobParams {
  tenantId: string;
  jobType: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  availableAt?: Date;
}

export interface JobFailure {
  id: string;
  jobId: string;
  tenantId: string;
  attempt: number;
  errorCode: string | null;
  errorMessage: string;
  failedAt: Date;
}

export interface RecordJobFailureParams {
  jobId: string;
  tenantId: string;
  attempt: number;
  errorCode?: string | null;
  errorMessage: string;
}

export interface SubmissionSideEffectPayload {
  submissionId: string;
  widgetId: string;
  jobType: string;
}
