import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, getClient } from '../src/shared/db.js';
import { tenantRepository } from '../src/modules/tenants/tenant.repository.js';
import { widgetRepository } from '../src/modules/widgets/widget.repository.js';
import { submissionRepository } from '../src/modules/submissions/submission.repository.js';
import { jobRepository } from '../src/modules/jobs/job.repository.js';
import { submissionSideEffectHandler } from '../src/modules/jobs/job-handler.js';
import {
  JobWorker,
  getNextRetryDelaySeconds,
  RETRY_DELAYS_SECONDS,
} from '../src/workers/job-worker.js';
import { submissionRateLimiter } from '../src/modules/submissions/rate-limiter.js';

describe('Phase 2C-3: Background Jobs, Transactional Outbox & Worker', () => {
  const prefix = `job_test_${Date.now()}`;
  let tenantId: string;
  let widgetId: string;
  let worker: JobWorker;

  beforeAll(async () => {
    // 1. Setup Tenant and Widget
    const tenant = await tenantRepository.create(`Job Tenant ${prefix}`, `tenant-${prefix}`);
    tenantId = tenant.id;

    const widget = await widgetRepository.create(tenantId, {
      name: 'Outbox Test Widget',
      isActive: true,
      allowedOrigins: ['https://client-site.com'],
      fields: [
        { name: 'name', type: 'text', label: 'Full Name', required: true },
        { name: 'email', type: 'email', label: 'Work Email', required: true },
      ],
      theme: { primaryColor: '#2563eb', buttonText: 'Submit Lead' },
    });
    widgetId = widget.id;
    worker = new JobWorker({
      workerId: `test-worker-${prefix}`,
      tenantId,
      pollIntervalMs: 50,
    });
  });

  beforeEach(async () => {
    submissionRateLimiter.reset();
    submissionSideEffectHandler.reset();
    await query('DELETE FROM jobs WHERE tenant_id = $1', [tenantId]);
  });

  afterAll(async () => {
    await worker.stop();
    // Cascade delete tenant removes widgets, submissions, jobs, and job_failures
    await query('DELETE FROM tenants WHERE id = $1', [tenantId]);
  });

  // =========================================================================
  // 1. TRANSACTIONAL OUTBOX & ATOMICITY
  // =========================================================================
  describe('Transactional Outbox Atomicity', () => {
    it('1. should create both submission and outbox job in the same transaction', async () => {
      const res = await request(app)
        .post('/api/v1/public/submissions')
        .set('Origin', 'https://client-site.com')
        .send({
          widgetId,
          data: { name: 'Alice Outbox', email: 'alice@example.com' },
        });

      expect(res.status).toBe(201);
      const submissionId = res.body.submissionId;
      expect(submissionId).toBeDefined();

      // Verify submission row
      const subRes = await query('SELECT * FROM submissions WHERE id = $1', [submissionId]);
      expect(subRes.rows.length).toBe(1);

      // Verify corresponding job row
      const jobRes = await query(
        "SELECT * FROM jobs WHERE payload->>'submissionId' = $1 AND job_type = 'submission.side_effect'",
        [submissionId],
      );
      expect(jobRes.rows.length).toBe(1);
      const job = jobRes.rows[0];
      expect(job.tenant_id).toBe(tenantId);
      expect(job.status).toBe('pending');
      expect(job.attempts).toBe(0);
      expect(job.max_attempts).toBe(3);
    });

    it('2. should rollback submission if job creation fails within the transaction', async () => {
      const client = await getClient();
      let caughtError = false;

      try {
        await client.query('BEGIN');
        // Insert submission
        const sub = await submissionRepository.insert(
          {
            tenantId,
            widgetId,
            idempotencyKey: null,
            payload: { name: 'Rollback Test', email: 'rollback@example.com' },
          },
          client,
        );
        expect(sub).toBeDefined();

        // Simulate failing job creation by violating foreign key constraint (non-existent tenant)
        await client.query(
          "INSERT INTO jobs (tenant_id, job_type, status, payload) VALUES ('00000000-0000-0000-0000-000000000000', 'fail.job', 'pending', '{}')",
        );
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK');
        caughtError = true;
      } finally {
        client.release();
      }

      expect(caughtError).toBe(true);

      // Verify submission was rolled back and does not exist in DB
      const checkSub = await query(
        "SELECT * FROM submissions WHERE payload->>'email' = 'rollback@example.com'",
      );
      expect(checkSub.rows.length).toBe(0);
    });

    it('3. should NOT create a second job on idempotent submission replay', async () => {
      const idempotencyKey = `idem-outbox-${Date.now()}`;

      // First submission
      const res1 = await request(app)
        .post('/api/v1/public/submissions')
        .set('Origin', 'https://client-site.com')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          widgetId,
          data: { name: 'Bob Idem', email: 'bob@example.com' },
        });

      expect(res1.status).toBe(201);
      const submissionId = res1.body.submissionId;

      // Check initial job count
      const jobsInitial = await query("SELECT * FROM jobs WHERE payload->>'submissionId' = $1", [
        submissionId,
      ]);
      expect(jobsInitial.rows.length).toBe(1);

      // Replay with identical key and payload
      const res2 = await request(app)
        .post('/api/v1/public/submissions')
        .set('Origin', 'https://client-site.com')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          widgetId,
          data: { name: 'Bob Idem', email: 'bob@example.com' },
        });

      expect(res2.status).toBe(200);
      expect(res2.body.idempotentReplay).toBe(true);

      // Check jobs count remains exactly 1
      const jobsReplay = await query("SELECT * FROM jobs WHERE payload->>'submissionId' = $1", [
        submissionId,
      ]);
      expect(jobsReplay.rows.length).toBe(1);
    });

    it('4. should derive job tenant_id strictly from authoritative widget context', async () => {
      const res = await request(app)
        .post('/api/v1/public/submissions')
        .set('Origin', 'https://client-site.com')
        .send({
          widgetId,
          data: { name: 'Charlie Tenant', email: 'charlie@example.com' },
        });

      const submissionId = res.body.submissionId;
      const job = await query("SELECT * FROM jobs WHERE payload->>'submissionId' = $1", [
        submissionId,
      ]);

      expect(job.rows[0].tenant_id).toBe(tenantId);
    });

    it('5. should NOT copy full lead payload into the jobs table (payload minimization)', async () => {
      const res = await request(app)
        .post('/api/v1/public/submissions')
        .set('Origin', 'https://client-site.com')
        .send({
          widgetId,
          data: { name: 'Private User', email: 'private@secret.com' },
        });

      const submissionId = res.body.submissionId;
      const jobRes = await query("SELECT * FROM jobs WHERE payload->>'submissionId' = $1", [
        submissionId,
      ]);
      const jobPayload = jobRes.rows[0].payload;

      // Verify minimal payload: contains IDs only, no lead fields
      expect(jobPayload.submissionId).toBe(submissionId);
      expect(jobPayload.widgetId).toBe(widgetId);
      expect(jobPayload.name).toBeUndefined();
      expect(jobPayload.email).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. SAFE JOB CLAIMING & WORKER EXECUTION
  // =========================================================================
  describe('Safe Job Claiming & Execution', () => {
    it('6. should claim a pending job and update status to processing with worker lock', async () => {
      const job = await jobRepository.insert({
        tenantId,
        jobType: 'submission.side_effect',
        payload: { submissionId: 'test-sub-1', widgetId },
      });

      expect(job.status).toBe('pending');
      expect(job.attempts).toBe(0);

      const claimed = await jobRepository.claimNextJob(
        worker.workerId,
        300_000,
        undefined,
        tenantId,
      );
      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(job.id);
      expect(claimed?.status).toBe('processing');
      expect(claimed?.lockedBy).toBe(worker.workerId);
      expect(claimed?.lockedAt).toBeDefined();
      expect(claimed?.attempts).toBe(1);

      // Clean up for other tests
      await jobRepository.markCompleted(job.id);
    });

    it('7. should process claimed job to completed status on successful handler execution', async () => {
      const job = await jobRepository.insert({
        tenantId,
        jobType: 'submission.side_effect',
        payload: { submissionId: 'test-sub-2', widgetId },
      });

      submissionSideEffectHandler.setMode('success');

      const processed = await worker.runOnce();
      expect(processed?.id).toBe(job.id);

      const updated = await jobRepository.findById(job.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.completedAt).not.toBeNull();
      expect(updated?.lockedAt).toBeNull();
      expect(updated?.lockedBy).toBeNull();
      expect(submissionSideEffectHandler.getExecutionCount()).toBe(1);
    });

    it('8. should NOT re-execute a completed job (idempotent processing)', async () => {
      const job = await jobRepository.insert({
        tenantId,
        jobType: 'submission.side_effect',
        payload: { submissionId: 'test-sub-3', widgetId },
      });

      await jobRepository.markCompleted(job.id);

      const claimAttempt = await jobRepository.claimNextJob(
        worker.workerId,
        300_000,
        undefined,
        tenantId,
      );
      // Job was completed, so it should not be claimed
      expect(claimAttempt?.id).not.toBe(job.id);
    });

    it('9. should prevent two concurrent workers from claiming the same job (SKIP LOCKED)', async () => {
      const job = await jobRepository.insert({
        tenantId,
        jobType: 'submission.side_effect',
        payload: { submissionId: 'test-sub-concurrent', widgetId },
      });

      // Run concurrent claims
      const [claim1, claim2] = await Promise.all([
        jobRepository.claimNextJob('worker-alpha', 300_000, undefined, tenantId),
        jobRepository.claimNextJob('worker-beta', 300_000, undefined, tenantId),
      ]);

      // Exactly one worker claims this job
      const claimedByWorker1 = claim1?.id === job.id;
      const claimedByWorker2 = claim2?.id === job.id;
      expect(claimedByWorker1 !== claimedByWorker2).toBe(true);

      // Cleanup
      await jobRepository.markCompleted(job.id);
    });

    it('10. should recover stale processing lock older than configured timeout', async () => {
      const job = await jobRepository.insert({
        tenantId,
        jobType: 'submission.side_effect',
        payload: { submissionId: 'test-stale-lock', widgetId },
      });

      // Manually set status to processing with a locked_at 10 minutes ago
      await query(
        "UPDATE jobs SET status = 'processing', locked_at = NOW() - INTERVAL '10 minutes', locked_by = 'crashed-worker' WHERE id = $1",
        [job.id],
      );

      // Worker with 5 minute stale timeout should claim the stale job
      const recovered = await jobRepository.claimNextJob(
        'recovering-worker',
        300_000,
        undefined,
        tenantId,
      );
      expect(recovered?.id).toBe(job.id);
      expect(recovered?.lockedBy).toBe('recovering-worker');

      // Cleanup
      await jobRepository.markCompleted(job.id);
    });
  });

  // =========================================================================
  // 3. RETRY POLICY & EXPONENTIAL BACKOFF
  // =========================================================================
  describe('Retry Policy, Backoff & Dead-Letter (job_failures)', () => {
    it('11. should calculate correct backoff delays for attempts 1, 2, 3 and exhaustion on attempt 4', () => {
      expect(getNextRetryDelaySeconds(1)).toBe(30);
      expect(getNextRetryDelaySeconds(2)).toBe(120);
      expect(getNextRetryDelaySeconds(3)).toBe(600);
      expect(getNextRetryDelaySeconds(4)).toBeNull(); // Exhausted
      expect(getNextRetryDelaySeconds(5)).toBeNull();
      expect(RETRY_DELAYS_SECONDS).toEqual([30, 120, 600]);
    });

    it('12. should schedule retry 1 at ~30 seconds and record in job_failures on attempt 1 failure', async () => {
      const job = await jobRepository.insert({
        tenantId,
        jobType: 'submission.side_effect',
        payload: { submissionId: 'sub-fail-1', widgetId },
      });

      submissionSideEffectHandler.setMode('transient_failure', 1);

      const beforeRun = Date.now();
      await worker.runOnce();

      const updated = await jobRepository.findById(job.id);
      expect(updated?.status).toBe('pending');
      expect(updated?.attempts).toBe(1);
      expect(updated?.lastError).toContain('Deterministic transient side effect failure');

      // Check available_at is ~30 seconds in future
      const scheduledDelayMs = updated!.availableAt.getTime() - beforeRun;
      expect(scheduledDelayMs).toBeGreaterThanOrEqual(28_000);
      expect(scheduledDelayMs).toBeLessThanOrEqual(35_000);

      // Check job_failures table
      const failures = await jobRepository.findFailuresByJobId(job.id);
      expect(failures.length).toBe(1);
      expect(failures[0].attempt).toBe(1);
      expect(failures[0].errorMessage).toContain('Deterministic transient side effect failure');
      expect(failures[0].tenantId).toBe(tenantId);
    });

    it('13. should schedule retry 2 at ~120 seconds on attempt 2 failure', async () => {
      const job = await jobRepository.insert({
        tenantId,
        jobType: 'submission.side_effect',
        payload: { submissionId: 'sub-fail-2', widgetId },
      });

      // Fast-forward to attempt 1 already completed and failed
      await query(
        "UPDATE jobs SET attempts = 1, status = 'pending', available_at = NOW() WHERE id = $1",
        [job.id],
      );

      submissionSideEffectHandler.setMode('transient_failure', 1);

      const beforeRun = Date.now();
      await worker.runOnce();

      const updated = await jobRepository.findById(job.id);
      expect(updated?.status).toBe('pending');
      expect(updated?.attempts).toBe(2);

      // Check available_at is ~120 seconds in future
      const scheduledDelayMs = updated!.availableAt.getTime() - beforeRun;
      expect(scheduledDelayMs).toBeGreaterThanOrEqual(118_000);
      expect(scheduledDelayMs).toBeLessThanOrEqual(125_000);
    });

    it('14. should schedule retry 3 at ~600 seconds on attempt 3 failure', async () => {
      const job = await jobRepository.insert({
        tenantId,
        jobType: 'submission.side_effect',
        payload: { submissionId: 'sub-fail-3', widgetId },
      });

      // Fast-forward to attempt 2 already failed
      await query(
        "UPDATE jobs SET attempts = 2, status = 'pending', available_at = NOW() WHERE id = $1",
        [job.id],
      );

      submissionSideEffectHandler.setMode('transient_failure', 1);

      const beforeRun = Date.now();
      await worker.runOnce();

      const updated = await jobRepository.findById(job.id);
      expect(updated?.status).toBe('pending');
      expect(updated?.attempts).toBe(3);

      // Check available_at is ~600 seconds in future
      const scheduledDelayMs = updated!.availableAt.getTime() - beforeRun;
      expect(scheduledDelayMs).toBeGreaterThanOrEqual(595_000);
      expect(scheduledDelayMs).toBeLessThanOrEqual(605_000);
    });

    it('15. should mark job as failed (dead-letter) after exceeding max attempts', async () => {
      const job = await jobRepository.insert({
        tenantId,
        jobType: 'submission.side_effect',
        payload: { submissionId: 'sub-fail-exhaust', widgetId },
        maxAttempts: 3,
      });

      // Fast-forward to attempt 3 already completed and now eligible for attempt 4
      await query(
        "UPDATE jobs SET attempts = 3, status = 'pending', available_at = NOW() WHERE id = $1",
        [job.id],
      );

      submissionSideEffectHandler.setMode('permanent_failure');

      await worker.runOnce();

      const updated = await jobRepository.findById(job.id);
      expect(updated?.status).toBe('failed');
      expect(updated?.attempts).toBe(4);
      expect(updated?.lastError).toContain('Deterministic permanent side effect failure');

      // Check failure audit record exists
      const failures = await jobRepository.findFailuresByJobId(job.id);
      expect(failures.length).toBeGreaterThanOrEqual(1);
      const lastFailure = failures[failures.length - 1];
      expect(lastFailure.attempt).toBe(4);
    });

    it('16. should continue worker execution after one job fails', async () => {
      // Create failing Job 1
      const job1 = await jobRepository.insert({
        tenantId,
        jobType: 'submission.side_effect',
        payload: { submissionId: 'fail-then-succeed-1', widgetId },
      });

      // Create succeeding Job 2
      const job2 = await jobRepository.insert({
        tenantId,
        jobType: 'submission.side_effect',
        payload: { submissionId: 'fail-then-succeed-2', widgetId },
      });

      // First run: fail Job 1
      submissionSideEffectHandler.setMode('permanent_failure');
      const processed1 = await worker.runOnce();
      expect(processed1?.id).toBe(job1.id);

      // Second run: succeed Job 2
      submissionSideEffectHandler.setMode('success');
      const processed2 = await worker.runOnce();
      expect(processed2?.id).toBe(job2.id);

      const updatedJob2 = await jobRepository.findById(job2.id);
      expect(updatedJob2?.status).toBe('completed');
    });
  });

  // =========================================================================
  // 4. END-TO-END CAPSTONE SCENARIO PROBES
  // =========================================================================
  describe('Capstone End-to-End Scenarios', () => {
    it('17. Behavioral Probe: Transient failure -> retry scheduled -> eventual success', async () => {
      // 1. Submit lead via public API
      const res = await request(app)
        .post('/api/v1/public/submissions')
        .set('Origin', 'https://client-site.com')
        .send({
          widgetId,
          data: { name: 'Retry Probe User', email: 'retry@example.com' },
        });

      expect(res.status).toBe(201);
      const subId = res.body.submissionId;

      // Find created outbox job
      const jobRows = await query("SELECT * FROM jobs WHERE payload->>'submissionId' = $1", [
        subId,
      ]);
      const jobId = jobRows.rows[0].id;

      // 2. Configure handler to fail once
      submissionSideEffectHandler.setMode('transient_failure', 1);

      // 3. Worker claims and fails attempt 1
      await worker.runOnce();

      let jobState = await jobRepository.findById(jobId);
      expect(jobState?.status).toBe('pending');
      expect(jobState?.attempts).toBe(1);

      // Verify failure recorded
      const failures = await jobRepository.findFailuresByJobId(jobId);
      expect(failures.length).toBe(1);
      expect(failures[0].attempt).toBe(1);

      // 4. Fast-forward available_at to simulate backoff elapsing
      await query('UPDATE jobs SET available_at = NOW() WHERE id = $1', [jobId]);

      // 5. Worker runs again and now succeeds
      await worker.runOnce();

      jobState = await jobRepository.findById(jobId);
      expect(jobState?.status).toBe('completed');
      expect(jobState?.completedAt).not.toBeNull();
    });

    it('18. Behavioral Probe: Permanent failure -> retry attempts exhausted -> dead-letter with audit history', async () => {
      // 1. Submit lead via public API
      const res = await request(app)
        .post('/api/v1/public/submissions')
        .set('Origin', 'https://client-site.com')
        .send({
          widgetId,
          data: { name: 'Dead Letter User', email: 'deadletter@example.com' },
        });

      const subId = res.body.submissionId;
      const jobRows = await query("SELECT * FROM jobs WHERE payload->>'submissionId' = $1", [
        subId,
      ]);
      const jobId = jobRows.rows[0].id;

      // 2. Handler configured for permanent failure
      submissionSideEffectHandler.setMode('permanent_failure');

      // Attempt 1
      await worker.runOnce();
      expect((await jobRepository.findById(jobId))?.attempts).toBe(1);

      // Advance clock & Attempt 2
      await query('UPDATE jobs SET available_at = NOW() WHERE id = $1', [jobId]);
      await worker.runOnce();
      expect((await jobRepository.findById(jobId))?.attempts).toBe(2);

      // Advance clock & Attempt 3
      await query('UPDATE jobs SET available_at = NOW() WHERE id = $1', [jobId]);
      await worker.runOnce();
      expect((await jobRepository.findById(jobId))?.attempts).toBe(3);

      // Advance clock & Attempt 4 (exhausts max_attempts = 3)
      await query('UPDATE jobs SET available_at = NOW() WHERE id = $1', [jobId]);
      await worker.runOnce();

      const finalState = await jobRepository.findById(jobId);
      expect(finalState?.status).toBe('failed');
      expect(finalState?.attempts).toBe(4);

      // Failure history preserved
      const failureAudit = await jobRepository.findFailuresByJobId(jobId);
      expect(failureAudit.length).toBe(4);
      expect(failureAudit.map((f) => f.attempt)).toEqual([1, 2, 3, 4]);
    });
  });
});
