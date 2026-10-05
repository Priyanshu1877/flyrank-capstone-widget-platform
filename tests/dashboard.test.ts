import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, closePool } from '../src/shared/db.js';
import { widgetRepository } from '../src/modules/widgets/widget.repository.js';
import { jobRepository } from '../src/modules/jobs/job.repository.js';

describe('Phase 3A: Dashboard & Lead Management Backend API', () => {
  const seed = `dash_${Date.now()}`;
  let tokenA: string;
  let tenantAId: string;
  let tokenB: string;
  let tenantBId: string;

  let widgetA1Id: string;
  let widgetA2Id: string;
  let widgetBId: string;

  let submissionA1Id: string;
  let submissionA2Id: string;
  let submissionBId: string;

  let jobAId: string;
  let jobBId: string;

  beforeAll(async () => {
    // 1. Register Tenant A
    const resA = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: `Tenant Alpha ${seed}`,
        email: `alpha-${seed}@corp.com`,
        password: 'Password123!',
      });
    expect(resA.status).toBe(201);
    tokenA = resA.body.data.token;
    tenantAId = resA.body.data.tenant.id;

    // 2. Register Tenant B
    const resB = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: `Tenant Beta ${seed}`,
        email: `beta-${seed}@corp.com`,
        password: 'Password123!',
      });
    expect(resB.status).toBe(201);
    tokenB = resB.body.data.token;
    tenantBId = resB.body.data.tenant.id;

    // 3. Create Widgets for Tenant A
    const widgetA1 = await widgetRepository.create(tenantAId, {
      name: 'Alpha Widget 1',
      isActive: true,
      allowedOrigins: ['http://localhost:5000'],
      fields: [
        { name: 'name', type: 'text', label: 'Name', required: true },
        { name: 'email', type: 'email', label: 'Email', required: true },
      ],
      theme: { primaryColor: '#2563eb', buttonText: 'Submit' },
    });
    widgetA1Id = widgetA1.id;

    const widgetA2 = await widgetRepository.create(tenantAId, {
      name: 'Alpha Widget 2',
      isActive: true,
      allowedOrigins: ['http://localhost:5000'],
      fields: [{ name: 'email', type: 'email', label: 'Email', required: true }],
      theme: { primaryColor: '#10b981', buttonText: 'Subscribe' },
    });
    widgetA2Id = widgetA2.id;

    // 4. Create Widget for Tenant B
    const widgetB = await widgetRepository.create(tenantBId, {
      name: 'Beta Widget',
      isActive: true,
      allowedOrigins: ['http://localhost:5000'],
      fields: [{ name: 'email', type: 'email', label: 'Email', required: true }],
      theme: { primaryColor: '#f59e0b', buttonText: 'Join' },
    });
    widgetBId = widgetB.id;

    // 5. Seed Submissions directly into DB for precise timestamp control
    // Tenant A - Submission 1 (Created now)
    const subA1Res = await query<{ id: string }>(
      `INSERT INTO submissions (
        tenant_id, widget_id, payload, geo_country, geo_city, geo_provider, origin, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id;`,
      [
        tenantAId,
        widgetA1Id,
        JSON.stringify({ name: 'Alice Alpha', email: 'alice@alpha.test' }),
        'US',
        'San Francisco',
        'provider_a',
        'http://localhost:5000',
      ],
    );
    submissionA1Id = subA1Res.rows[0].id;

    // Tenant A - Submission 2 (Created 2 days ago, under widget A2)
    const subA2Res = await query<{ id: string }>(
      `INSERT INTO submissions (
        tenant_id, widget_id, payload, geo_country, geo_city, geo_provider, origin, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - INTERVAL '2 days') RETURNING id;`,
      [
        tenantAId,
        widgetA2Id,
        JSON.stringify({ email: 'bob@alpha.test' }),
        'CA',
        'Toronto',
        'provider_b',
        'http://localhost:5000',
      ],
    );
    submissionA2Id = subA2Res.rows[0].id;

    // Tenant B - Submission (Created now, under widget B)
    const subBRes = await query<{ id: string }>(
      `INSERT INTO submissions (
        tenant_id, widget_id, payload, geo_country, geo_city, geo_provider, origin, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id;`,
      [
        tenantBId,
        widgetBId,
        JSON.stringify({ email: 'charlie@beta.test' }),
        'GB',
        'London',
        'provider_a',
        'http://localhost:5000',
      ],
    );
    submissionBId = subBRes.rows[0].id;

    // 6. Seed background jobs for Tenant A and Tenant B
    const jobA = await jobRepository.insert({
      tenantId: tenantAId,
      jobType: 'submission.side_effect',
      payload: { submissionId: submissionA1Id },
    });
    jobAId = jobA.id;

    const jobB = await jobRepository.insert({
      tenantId: tenantBId,
      jobType: 'submission.side_effect',
      payload: { submissionId: submissionBId },
    });
    jobBId = jobB.id;
  });

  afterAll(async () => {
    await query('DELETE FROM job_failures WHERE tenant_id IN ($1, $2);', [tenantAId, tenantBId]);
    await query('DELETE FROM jobs WHERE tenant_id IN ($1, $2);', [tenantAId, tenantBId]);
    await query('DELETE FROM submissions WHERE tenant_id IN ($1, $2);', [tenantAId, tenantBId]);
    await query('DELETE FROM widgets WHERE tenant_id IN ($1, $2);', [tenantAId, tenantBId]);
    await query('DELETE FROM users WHERE email LIKE $1;', [`%${seed}%`]);
    await query('DELETE FROM tenants WHERE id IN ($1, $2);', [tenantAId, tenantBId]);
    await closePool();
  });

  // =========================================================================
  // 1. Authentication & Authorization
  // =========================================================================
  describe('Authentication & Authorization', () => {
    it('1. should reject unauthenticated request with HTTP 401', async () => {
      const res = await request(app).get('/api/v1/dashboard/submissions');
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('2. should reject invalid bearer token with HTTP 401', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions')
        .set('Authorization', 'Bearer invalid.token.payload');
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('3. should allow authenticated request with valid token', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toBeDefined();
    });
  });

  // =========================================================================
  // 2. Pagination & Sorting
  // =========================================================================
  describe('Pagination & Limits', () => {
    it('4. should return default pagination metadata (page=1, limit=20)', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(20);
      expect(res.body.pagination.total).toBe(2);
      expect(res.body.pagination.totalPages).toBe(1);
      expect(res.body.data).toHaveLength(2);
    });

    it('5. should support custom pagination parameters', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?page=1&limit=1')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(1);
      expect(res.body.pagination.total).toBe(2);
      expect(res.body.pagination.totalPages).toBe(2);
      expect(res.body.data).toHaveLength(1);
    });

    it('6. should reject page < 1 with HTTP 400', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?page=0')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('7. should reject negative page with HTTP 400', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?page=-5')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('8. should reject non-integer page with HTTP 400', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?page=abc')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('9. should reject limit < 1 with HTTP 400', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?limit=0')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('10. should reject limit > 100 with HTTP 400', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?limit=101')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('11. should accept maximum limit = 100 with HTTP 200', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?limit=100')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(100);
    });
  });

  // =========================================================================
  // 3. Sorting Whitelist
  // =========================================================================
  describe('Sorting', () => {
    it('12. should default to created_at DESC (newest first)', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].id).toBe(submissionA1Id);
      expect(res.body.data[1].id).toBe(submissionA2Id);
    });

    it('13. should support sorting by created_at_asc (oldest first)', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?sort=created_at_asc')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].id).toBe(submissionA2Id);
      expect(res.body.data[1].id).toBe(submissionA1Id);
    });

    it('14. should reject unwhitelisted sort parameter with HTTP 400', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?sort=email_asc')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // 4. Widget Filtering & Tenant Scoping
  // =========================================================================
  describe('Widget Filtering', () => {
    it('15. should filter submissions by owned widgetId', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/submissions?widgetId=${widgetA1Id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(submissionA1Id);
      expect(res.body.data[0].widgetId).toBe(widgetA1Id);
      expect(res.body.pagination.total).toBe(1);
    });

    it('16. should reject malformed widgetId with HTTP 400', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?widgetId=not-a-valid-uuid')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('17. should return safe 404 when filtering by foreign-tenant widgetId (prevent leak)', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/submissions?widgetId=${widgetBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toBe('Widget not found');
    });
  });

  // =========================================================================
  // 5. Date Range Filtering
  // =========================================================================
  describe('Date Range Filtering', () => {
    it('18. should filter submissions with valid from and to range', async () => {
      const tomorrow = new Date(Date.now() + 86400000).toISOString();
      const oneDayAgo = new Date(Date.now() - 86400000).toISOString();

      const res = await request(app)
        .get(
          `/api/v1/dashboard/submissions?from=${encodeURIComponent(oneDayAgo)}&to=${encodeURIComponent(tomorrow)}`,
        )
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(submissionA1Id);
    });

    it('19. should reject malformed date with HTTP 400', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?from=invalid-date')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('20. should reject when from is later than to with HTTP 400', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?from=2026-05-10&to=2026-05-01')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // 6. Cross-Tenant Isolation
  // =========================================================================
  describe('Cross-Tenant Isolation (Submissions)', () => {
    it('21. should ensure Tenant A cannot see Tenant B submissions in listing', async () => {
      const resA = await request(app)
        .get('/api/v1/dashboard/submissions')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(resA.status).toBe(200);
      const idsA = resA.body.data.map((s: { id: string }) => s.id);
      expect(idsA).toContain(submissionA1Id);
      expect(idsA).toContain(submissionA2Id);
      expect(idsA).not.toContain(submissionBId);
    });

    it('22. should ensure Tenant B cannot see Tenant A submissions in listing', async () => {
      const resB = await request(app)
        .get('/api/v1/dashboard/submissions')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(resB.status).toBe(200);
      const idsB = resB.body.data.map((s: { id: string }) => s.id);
      expect(idsB).toContain(submissionBId);
      expect(idsB).not.toContain(submissionA1Id);
      expect(idsB).not.toContain(submissionA2Id);
    });

    it('23. should return 404 when Tenant A requests Tenant B submission by ID (no leak)', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/submissions/${submissionBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toBe('Submission not found');
    });

    it('24. should return 404 when Tenant B requests Tenant A submission by ID (no leak)', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/submissions/${submissionA1Id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // =========================================================================
  // 7. Submission Detail
  // =========================================================================
  describe('Submission Detail Endpoint', () => {
    it('25. should retrieve submission detail with expected safe fields for owner', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/submissions/${submissionA1Id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      const sub = res.body.data;
      expect(sub.id).toBe(submissionA1Id);
      expect(sub.submissionId).toBe(submissionA1Id);
      expect(sub.widgetId).toBe(widgetA1Id);
      expect(sub.widgetName).toBe('Alpha Widget 1');
      expect(sub.payload).toEqual({ name: 'Alice Alpha', email: 'alice@alpha.test' });
      expect(sub.geoCountry).toBe('US');
      expect(sub.geoCity).toBe('San Francisco');
      expect(sub.geoProvider).toBe('provider_a');
      expect(sub.origin).toBe('http://localhost:5000');
      expect(sub.createdAt).toBeDefined();

      // Ensure sensitive/internal fields are not leaked
      expect(sub.ip_address).toBeUndefined();
      expect(sub.ipAddress).toBeUndefined();
      expect(sub.password).toBeUndefined();
      expect(sub.token).toBeUndefined();
    });

    it('26. should return 400 for malformed submission ID', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions/invalid-uuid-123')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('27. should return 404 for non-existent submission ID', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // =========================================================================
  // 8. Aggregate Statistics
  // =========================================================================
  describe('Submission Statistics', () => {
    it('28. should calculate aggregate stats strictly for Tenant A', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions/stats')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      const stats = res.body.data;
      expect(stats.totalSubmissions).toBe(2);
      expect(stats.today).toBe(1); // subA1 is today, subA2 is 2 days ago
      expect(stats.thisWeek).toBeGreaterThanOrEqual(1);
      expect(stats.thisMonth).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(stats.byWidget)).toBe(true);

      const w1 = stats.byWidget.find((w: { widgetId: string }) => w.widgetId === widgetA1Id);
      const w2 = stats.byWidget.find((w: { widgetId: string }) => w.widgetId === widgetA2Id);
      expect(w1.count).toBe(1);
      expect(w2.count).toBe(1);
    });

    it('29. should calculate aggregate stats strictly for Tenant B without Tenant A data', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions/stats')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      const stats = res.body.data;
      expect(stats.totalSubmissions).toBe(1);
      expect(stats.today).toBe(1);
      expect(stats.byWidget).toHaveLength(1);
      expect(stats.byWidget[0].widgetId).toBe(widgetBId);
      expect(stats.byWidget[0].count).toBe(1);
    });

    it('30. should support widget-scoped statistics for owned widget', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/submissions/stats?widgetId=${widgetA1Id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const stats = res.body.data;
      expect(stats.totalSubmissions).toBe(1);
      expect(stats.byWidget).toHaveLength(1);
      expect(stats.byWidget[0].widgetId).toBe(widgetA1Id);
    });

    it('31. should return safe 404 when requesting statistics for foreign widgetId', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/submissions/stats?widgetId=${widgetBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // =========================================================================
  // 9. Operational Jobs Visibility
  // =========================================================================
  describe('Background Jobs Visibility', () => {
    it('32. should list background jobs belonging strictly to Tenant A', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/jobs')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);

      const jobIds = res.body.data.map((j: { id: string }) => j.id);
      expect(jobIds).toContain(jobAId);
      expect(jobIds).not.toContain(jobBId);

      const jobItem = res.body.data.find((j: { id: string }) => j.id === jobAId);
      expect(jobItem.jobType).toBe('submission.side_effect');
      expect(jobItem.status).toBe('pending');
      expect(jobItem.attempts).toBe(0);
      expect(jobItem.maxAttempts).toBe(3);
      expect(jobItem.createdAt).toBeDefined();

      // Ensure sensitive internal job payloads or internal database states are not exposed
      expect(jobItem.payload).toBeUndefined();
    });

    it('33. should ensure Tenant B only sees Tenant B background jobs', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/jobs')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      const jobIds = res.body.data.map((j: { id: string }) => j.id);
      expect(jobIds).toContain(jobBId);
      expect(jobIds).not.toContain(jobAId);
    });
  });

  // =========================================================================
  // 10. Dashboard Widgets List
  // =========================================================================
  describe('Dashboard Widgets List', () => {
    it('34. should list widgets belonging strictly to Tenant A', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/widgets')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      const widgetIds = res.body.data.map((w: { id: string }) => w.id);
      expect(widgetIds).toContain(widgetA1Id);
      expect(widgetA2Id).toBeDefined();
      expect(widgetIds).toContain(widgetA2Id);
      expect(widgetIds).not.toContain(widgetBId);
    });

    it('35. should list widgets belonging strictly to Tenant B', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/widgets')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      const widgetIds = res.body.data.map((w: { id: string }) => w.id);
      expect(widgetIds).toContain(widgetBId);
      expect(widgetIds).not.toContain(widgetA1Id);
      expect(widgetIds).not.toContain(widgetA2Id);
    });
  });

  // =========================================================================
  // 11. Security & Injection Protection
  // =========================================================================
  describe('Security & Injection Prevention', () => {
    it('36. should reject SQL injection attempt in page parameter with 400', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?page=1%20OR%201=1')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('37. should reject SQL injection attempt in sort parameter with 400', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?sort=created_at;DROP%20TABLE%20submissions')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('38. should reject SQL injection attempt in from date parameter with 400', async () => {
      const res = await request(app)
        .get("/api/v1/dashboard/submissions?from=2026-01-01'%20OR%20'1'='1")
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('39. should reject SQL injection attempt in widgetId parameter with 400', async () => {
      const res = await request(app)
        .get("/api/v1/dashboard/submissions?widgetId=00000000-0000-0000-0000-000000000000'--")
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
