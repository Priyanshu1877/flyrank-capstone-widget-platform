import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, closePool } from '../src/shared/db.js';
import { widgetRepository } from '../src/modules/widgets/widget.repository.js';

describe('Phase 3B: Dashboard Frontend UI & Client Integration', () => {
  const seed = `dash_ui_${Date.now()}`;
  let token: string;
  let tenantId: string;
  let widgetId: string;
  let xssSubmissionId: string;

  beforeAll(async () => {
    // 1. Register tenant account
    const resAuth = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: `Dashboard Tenant ${seed}`,
        email: `tenant-${seed}@corp.test`,
        password: 'Password123!',
      });
    token = resAuth.body.data.token;
    tenantId = resAuth.body.data.tenant.id;

    // 2. Create Widget
    const widget = await widgetRepository.create(tenantId, {
      name: 'Sales Inquiries Widget',
      isActive: true,
      allowedOrigins: ['http://localhost:5000'],
      fields: [
        { name: 'name', type: 'text', label: 'Full Name', required: true },
        { name: 'notes', type: 'textarea', label: 'Notes', required: false },
      ],
      theme: { primaryColor: '#2563eb', buttonText: 'Submit Inquiry' },
    });
    widgetId = widget.id;

    // 3. Insert submission with potentially malicious XSS payload
    const subRes = await query<{ id: string }>(
      `INSERT INTO submissions (
        tenant_id, widget_id, payload, geo_country, geo_city, geo_provider, origin, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id;`,
      [
        tenantId,
        widgetId,
        JSON.stringify({
          name: '<script>alert("XSS")</script>',
          notes: '<img src=x onerror="alert(1)">',
        }),
        'US',
        'Seattle',
        'provider_a',
        'http://localhost:5000',
      ],
    );
    xssSubmissionId = subRes.rows[0].id;
  });

  afterAll(async () => {
    await query('DELETE FROM submissions WHERE tenant_id = $1;', [tenantId]);
    await query('DELETE FROM widgets WHERE tenant_id = $1;', [tenantId]);
    await query('DELETE FROM users WHERE email LIKE $1;', [`%${seed}%`]);
    await query('DELETE FROM tenants WHERE id = $1;', [tenantId]);
    await closePool();
  });

  // =========================================================================
  // 1. Static Asset & Route Delivery
  // =========================================================================
  describe('Dashboard Route & Asset Delivery', () => {
    it('1. should deliver dashboard HTML shell on GET /dashboard with HTTP 200', async () => {
      const res = await request(app).get('/dashboard');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('<!doctype html>');
      expect(res.text).toContain('FlyRank');
      expect(res.text).toContain('id="statsContainer"');
      expect(res.text).toContain('id="submissionsTbody"');
      expect(res.text).toContain('id="authModal"');
      expect(res.text).toContain('id="detailModal"');
    });

    it('2. should redirect GET / to /dashboard with HTTP 302', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe('/dashboard');
    });

    it('3. should serve dashboard stylesheet on GET /dashboard/dashboard.css with HTTP 200', async () => {
      const res = await request(app).get('/dashboard/dashboard.css');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/css');
      expect(res.text).toContain('--font-sans');
      expect(res.text).toContain('.stat-card');
      expect(res.text).toContain('.modal-backdrop');
    });

    it('4. should serve dashboard client script on GET /dashboard/dashboard.js with HTTP 200', async () => {
      const res = await request(app).get('/dashboard/dashboard.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('javascript');
      expect(res.text).toContain('createSafeTextElement');
      expect(res.text).toContain('loadSubmissions');
      expect(res.text).toContain('openSubmissionDetail');
    });
  });

  // =========================================================================
  // 2. Client Security & Anti-XSS Verification
  // =========================================================================
  describe('Safe Rendering & Anti-XSS Protection', () => {
    it('5. should verify dashboard script never uses dangerouslySetInnerHTML or innerHTML for user values', async () => {
      const res = await request(app).get('/dashboard/dashboard.js');
      expect(res.status).toBe(200);

      // Verify that dangerous HTML injection is not used for rendering user-controlled content
      expect(res.text).not.toContain('dangerouslySetInnerHTML');
      expect(res.text).toContain('textContent = text');
      expect(res.text).toContain('createSafeTextElement');
    });

    it('6. should deliver untrusted submission payload safely via API as structured data', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/submissions/${xssSubmissionId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.payload.name).toBe('<script>alert("XSS")</script>');
      expect(res.body.data.payload.notes).toBe('<img src=x onerror="alert(1)">');
    });
  });

  // =========================================================================
  // 3. API Contract Conformance for Frontend UI
  // =========================================================================
  describe('Frontend API Contract Conformance', () => {
    it('7. should fetch stats for overview cards', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions/stats')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalSubmissions).toBe(1);
      expect(res.body.data.today).toBe(1);
    });

    it('8. should fetch submissions list with pagination for table', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/submissions?page=1&limit=20&sort=created_at_desc')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(xssSubmissionId);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(20);
    });

    it('9. should fetch widgets list for filter dropdown and widget section', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/widgets')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(widgetId);
      expect(res.body.data[0].name).toBe('Sales Inquiries Widget');
    });

    it('10. should fetch jobs list for operations panel', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/jobs?page=1&limit=10')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
