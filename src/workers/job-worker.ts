import crypto from 'node:crypto';
import type { Job } from '../modules/jobs/job.types.js';
import { jobRepository } from '../modules/jobs/job.repository.js';
import { jobHandlerRegistry, type JobHandlerRegistry } from '../modules/jobs/job-handler.js';

export const RETRY_DELAYS_SECONDS = [30, 120, 600];

export function getNextRetryDelaySeconds(attempt: number): number | null {
  if (attempt >= 1 && attempt <= RETRY_DELAYS_SECONDS.length) {
    return RETRY_DELAYS_SECONDS[attempt - 1];
  }
  return null;
}

export function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/Bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [REDACTED]')
    .replace(/(password|secret|key|token)=([^&\s]+)/gi, '$1=[REDACTED]')
    .substring(0, 1000);
}

export interface JobWorkerOptions {
  workerId?: string;
  tenantId?: string;
  staleTimeoutMs?: number;
  pollIntervalMs?: number;
  registry?: JobHandlerRegistry;
}

export class JobWorker {
  readonly workerId: string;
  readonly tenantId?: string;
  private staleTimeoutMs: number;
  private pollIntervalMs: number;
  private registry: JobHandlerRegistry;
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(options: JobWorkerOptions = {}) {
    this.workerId = options.workerId ?? `worker-${crypto.randomUUID()}`;
    this.tenantId = options.tenantId;
    this.staleTimeoutMs = options.staleTimeoutMs ?? 300_000; // 5 minutes
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.registry = options.registry ?? jobHandlerRegistry;
  }

  setStaleTimeout(timeoutMs: number): void {
    this.staleTimeoutMs = timeoutMs;
  }

  setPollInterval(intervalMs: number): void {
    this.pollIntervalMs = intervalMs;
  }

  /**
   * Processes a single job if available.
   * Returns the processed job, or null if no job was claimed.
   */
  async runOnce(): Promise<Job | null> {
    const job = await jobRepository.claimNextJob(
      this.workerId,
      this.staleTimeoutMs,
      undefined,
      this.tenantId,
    );

    if (!job) {
      return null;
    }

    console.log(
      `[JobWorker] Worker ${this.workerId} claimed job ${job.id} (tenant: ${job.tenantId}, type: ${job.jobType}, attempt: ${job.attempts}/${job.maxAttempts})`,
    );

    const handler = this.registry.get(job.jobType);

    if (!handler) {
      const errorMsg = `No handler registered for job type '${job.jobType}'`;
      console.error(`[JobWorker] Job ${job.id} failed: ${errorMsg}`);
      await jobRepository.recordFailure({
        jobId: job.id,
        tenantId: job.tenantId,
        attempt: job.attempts,
        errorCode: 'HANDLER_NOT_FOUND',
        errorMessage: sanitizeErrorMessage(errorMsg),
      });
      await jobRepository.markFailed(job.id, errorMsg);
      return job;
    }

    try {
      await handler.handle(job);
      await jobRepository.markCompleted(job.id);
      console.log(`[JobWorker] Job ${job.id} completed successfully on attempt ${job.attempts}`);
    } catch (err) {
      const rawError = (err as Error).message || 'Unknown processing error';
      const safeError = sanitizeErrorMessage(rawError);

      console.warn(`[JobWorker] Job ${job.id} failed attempt ${job.attempts}: ${safeError}`);

      // 1. Record the failed attempt in job_failures
      await jobRepository.recordFailure({
        jobId: job.id,
        tenantId: job.tenantId,
        attempt: job.attempts,
        errorCode: 'EXECUTION_FAILED',
        errorMessage: safeError,
      });

      // 2. Check retry policy (Attempt 1 -> 30s, Attempt 2 -> 120s, Attempt 3 -> 600s, Attempt 4 -> failed)
      const retryDelaySec = getNextRetryDelaySeconds(job.attempts);

      if (retryDelaySec !== null && job.attempts <= job.maxAttempts) {
        const availableAt = new Date(Date.now() + retryDelaySec * 1000);
        await jobRepository.scheduleRetry(job.id, availableAt, safeError);
        console.log(
          `[JobWorker] Job ${job.id} scheduled for retry (delay: ${retryDelaySec}s, availableAt: ${availableAt.toISOString()})`,
        );
      } else {
        await jobRepository.markFailed(job.id, safeError);
        console.error(
          `[JobWorker] Job ${job.id} permanently failed after ${job.attempts} attempts (exhausted max_attempts ${job.maxAttempts}). Marked as failed.`,
        );
      }
    }

    return job;
  }

  /**
   * Starts the polling worker loop.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[JobWorker] Worker ${this.workerId} started`);

    const poll = async () => {
      if (!this.isRunning) return;

      this.isProcessing = true;
      try {
        const processed = await this.runOnce();
        // If a job was processed, immediately look for more work without waiting
        if (processed && this.isRunning) {
          setImmediate(poll);
          return;
        }
      } catch (err) {
        console.error(`[JobWorker] Unexpected error in worker loop: ${(err as Error).message}`);
      } finally {
        this.isProcessing = false;
      }

      if (this.isRunning) {
        this.pollTimer = setTimeout(poll, this.pollIntervalMs);
      }
    };

    poll();
  }

  /**
   * Stops the worker cleanly.
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait briefly if currently executing a job
    let attempts = 0;
    while (this.isProcessing && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }

    console.log(`[JobWorker] Worker ${this.workerId} stopped cleanly`);
  }

  getStatus(): { isRunning: boolean; workerId: string } {
    return {
      isRunning: this.isRunning,
      workerId: this.workerId,
    };
  }
}

export const defaultWorker = new JobWorker();

// CLI runner if invoked directly
if (process.argv[1] && process.argv[1].endsWith('job-worker.ts')) {
  defaultWorker.start();

  const handleShutdown = async (signal: string) => {
    console.log(`[JobWorker] Received ${signal}. Initiating graceful shutdown...`);
    await defaultWorker.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}
