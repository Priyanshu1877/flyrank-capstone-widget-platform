import type { PoolClient } from 'pg';
import { query, getClient } from '../../shared/db.js';
import type { Job, CreateJobParams, JobFailure, RecordJobFailureParams } from './job.types.js';

interface JobRow {
  id: string;
  tenant_id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  available_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

interface JobFailureRow {
  id: string;
  job_id: string;
  tenant_id: string;
  attempt: number;
  error_code: string | null;
  error_message: string;
  failed_at: Date;
}

const mapRowToJob = (row: JobRow): Job => ({
  id: row.id,
  tenantId: row.tenant_id,
  jobType: row.job_type,
  status: row.status as Job['status'],
  payload: row.payload,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  availableAt: row.available_at,
  lockedAt: row.locked_at,
  lockedBy: row.locked_by,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
});

const mapRowToJobFailure = (row: JobFailureRow): JobFailure => ({
  id: row.id,
  jobId: row.job_id,
  tenantId: row.tenant_id,
  attempt: row.attempt,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  failedAt: row.failed_at,
});

export class JobRepository {
  /**
   * Inserts a new background job. Supports transactional outbox inserts via PoolClient.
   */
  async insert(params: CreateJobParams, client?: PoolClient): Promise<Job> {
    const text = `
      INSERT INTO jobs (
        tenant_id,
        job_type,
        status,
        payload,
        attempts,
        max_attempts,
        available_at
      )
      VALUES ($1, $2, 'pending', $3, 0, $4, $5)
      RETURNING id, tenant_id, job_type, status, payload, attempts, max_attempts,
                available_at, locked_at, locked_by, last_error, created_at, updated_at, completed_at;
    `;
    const values = [
      params.tenantId,
      params.jobType,
      JSON.stringify(params.payload),
      params.maxAttempts ?? 3,
      params.availableAt ?? new Date(),
    ];

    const res = client
      ? await client.query<JobRow>(text, values)
      : await query<JobRow>(text, values);

    return mapRowToJob(res.rows[0]);
  }

  /**
   * Safely claims the next eligible job using PostgreSQL row-level locking (FOR UPDATE SKIP LOCKED).
   * Eligible jobs:
   * 1. Status 'pending' with available_at <= NOW()
   * 2. Status 'processing' where locked_at is older than staleTimeoutMs (recovering stale/crashed workers)
   *
   * Increments attempts count, locks the row to workerId, sets status to 'processing', and commits.
   */
  async claimNextJob(
    workerId: string,
    staleTimeoutMs = 300_000,
    externalClient?: PoolClient,
    tenantId?: string,
  ): Promise<Job | null> {
    const client = externalClient ?? (await getClient());
    const shouldManageTransaction = !externalClient;

    try {
      if (shouldManageTransaction) {
        await client.query('BEGIN');
      }

      // Find and lock the next eligible job
      const selectText = `
        SELECT id
        FROM jobs
        WHERE ((status = 'pending' AND available_at <= NOW())
           OR (status = 'processing' AND locked_at < NOW() - ($1 || ' milliseconds')::interval))
          AND ($2::uuid IS NULL OR tenant_id = $2)
        ORDER BY available_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1;
      `;
      const selectRes = await client.query<{ id: string }>(selectText, [
        staleTimeoutMs,
        tenantId || null,
      ]);

      if (selectRes.rows.length === 0) {
        if (shouldManageTransaction) {
          await client.query('COMMIT');
        }
        return null;
      }

      const jobId = selectRes.rows[0].id;

      // Update to processing and increment attempts
      const updateText = `
        UPDATE jobs
        SET status = 'processing',
            locked_at = NOW(),
            locked_by = $1,
            attempts = attempts + 1,
            updated_at = NOW()
        WHERE id = $2
        RETURNING id, tenant_id, job_type, status, payload, attempts, max_attempts,
                  available_at, locked_at, locked_by, last_error, created_at, updated_at, completed_at;
      `;
      const updateRes = await client.query<JobRow>(updateText, [workerId, jobId]);

      if (shouldManageTransaction) {
        await client.query('COMMIT');
      }

      return mapRowToJob(updateRes.rows[0]);
    } catch (err) {
      if (shouldManageTransaction) {
        await client.query('ROLLBACK');
      }
      throw err;
    } finally {
      if (shouldManageTransaction) {
        client.release();
      }
    }
  }

  /**
   * Marks a job as completed.
   */
  async markCompleted(jobId: string, client?: PoolClient): Promise<void> {
    const text = `
      UPDATE jobs
      SET status = 'completed',
          completed_at = NOW(),
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
      WHERE id = $1;
    `;
    if (client) {
      await client.query(text, [jobId]);
    } else {
      await query(text, [jobId]);
    }
  }

  /**
   * Reschedules a job for retry after a failed attempt.
   */
  async scheduleRetry(
    jobId: string,
    availableAt: Date,
    lastError: string,
    client?: PoolClient,
  ): Promise<void> {
    const text = `
      UPDATE jobs
      SET status = 'pending',
          available_at = $2,
          last_error = $3,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
      WHERE id = $1;
    `;
    const values = [jobId, availableAt, lastError];
    if (client) {
      await client.query(text, values);
    } else {
      await query(text, values);
    }
  }

  /**
   * Marks a job as permanently failed (dead-letter).
   */
  async markFailed(jobId: string, lastError: string, client?: PoolClient): Promise<void> {
    const text = `
      UPDATE jobs
      SET status = 'failed',
          last_error = $2,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
      WHERE id = $1;
    `;
    const values = [jobId, lastError];
    if (client) {
      await client.query(text, values);
    } else {
      await query(text, values);
    }
  }

  /**
   * Records an attempt failure audit record into job_failures.
   */
  async recordFailure(params: RecordJobFailureParams, client?: PoolClient): Promise<JobFailure> {
    const text = `
      INSERT INTO job_failures (
        job_id,
        tenant_id,
        attempt,
        error_code,
        error_message,
        failed_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id, job_id, tenant_id, attempt, error_code, error_message, failed_at;
    `;
    const values = [
      params.jobId,
      params.tenantId,
      params.attempt,
      params.errorCode || null,
      params.errorMessage,
    ];

    const res = client
      ? await client.query<JobFailureRow>(text, values)
      : await query<JobFailureRow>(text, values);

    return mapRowToJobFailure(res.rows[0]);
  }

  /**
   * Finds a job by ID.
   */
  async findById(jobId: string, client?: PoolClient): Promise<Job | null> {
    const text = `
      SELECT id, tenant_id, job_type, status, payload, attempts, max_attempts,
             available_at, locked_at, locked_by, last_error, created_at, updated_at, completed_at
      FROM jobs
      WHERE id = $1;
    `;
    const res = client
      ? await client.query<JobRow>(text, [jobId])
      : await query<JobRow>(text, [jobId]);

    return res.rows.length ? mapRowToJob(res.rows[0]) : null;
  }

  /**
   * Retrieves all failure audit records for a job.
   */
  async findFailuresByJobId(jobId: string, client?: PoolClient): Promise<JobFailure[]> {
    const text = `
      SELECT id, job_id, tenant_id, attempt, error_code, error_message, failed_at
      FROM job_failures
      WHERE job_id = $1
      ORDER BY attempt ASC;
    `;
    const res = client
      ? await client.query<JobFailureRow>(text, [jobId])
      : await query<JobFailureRow>(text, [jobId]);

    return res.rows.map(mapRowToJobFailure);
  }
}

export const jobRepository = new JobRepository();
