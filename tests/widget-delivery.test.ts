import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { closePool, query } from '../src/shared/db.js';

describe('Public Widget Delivery & Caching Domain', () => {
  const seed = `w_del_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  let token = '';
  let tenantId = '';
  let activeWidgetId = '';
  let inactiveWidgetId = '';

  beforeAll(async () => {
    // 1. Register Tenant
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: `Delivery Corp ${seed}`,
        email: `delivery-${seed}@corp.com`,
        password: 'Password123!',
      });
    token = regRes.body.data.token;
    tenantId = regRes.body.data.tenant.id;

    // 2. Create Active Widget with allowed origins
    const w1 = await request(app)
      .post('/api/v1/widgets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Newsletter Signup',
        allowedOrigins: ['http://localhost:5000', 'https://authorized-client.com'],
        fields: [
          { name: 'email', type: 'email', label: 'Email Address', required: true },
          { name: 'name', type: 'text', label: 'Your Name', required: false },
        ],
        theme: {
          primaryColor: '#3b82f6',
          buttonText: 'Subscribe Now',
        },
      });
    activeWidgetId = w1.body.data.widget.id;

    // 3. Create Inactive Widget
    const w2 = await request(app)
      .post('/api/v1/widgets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Disabled Form',
        allowedOrigins: ['http://localhost:5000'],
        fields: [{ name: 'feedback', type: 'textarea', label: 'Feedback' }],
        isActive: false,
      });
    inactiveWidgetId = w2.body.data.widget.id;
  });

  afterAll(async () => {
    await query('DELETE FROM widgets WHERE tenant_id = $1;', [tenantId]);
    await query('DELETE FROM users WHERE email LIKE $1;', [`%${seed}%`]);
    await query('DELETE FROM tenants WHERE id = $1;', [tenantId]);
    await closePool();
  });

  describe('GET /api/v1/public/widgets/:id/config', () => {
    it('should return 200 and config when requested from an authorized origin', async () => {
      const res = await request(app)
        .get(`/api/v1/public/widgets/${activeWidgetId}/config`)
        .set('Origin', 'http://localhost:5000');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5000');
      expect(res.body.data.widgetId).toBe(activeWidgetId);
      expect(res.body.data.name).toBe('Newsletter Signup');
      expect(res.body.data.fields).toHaveLength(2);
      expect(res.body.data.theme.primaryColor).toBe('#3b82f6');
      expect(res.body.data.version).toBe(1);

      // Verify NO private tenant information is leaked in public config
      expect(res.body.data.tenantId).toBeUndefined();
      expect(res.body.data.password_hash).toBeUndefined();
      expect(res.body.data.token).toBeUndefined();
      expect(res.body.data.secret).toBeUndefined();
    });

    it('should reject request from an unauthorized origin with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/public/widgets/${activeWidgetId}/config`)
        .set('Origin', 'https://malicious-site.com');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should return 404 Not Found for an inactive widget', async () => {
      const res = await request(app)
        .get(`/api/v1/public/widgets/${inactiveWidgetId}/config`)
        .set('Origin', 'http://localhost:5000');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 404 Not Found for a non-existent widget UUID', async () => {
      const fakeUuid = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .get(`/api/v1/public/widgets/${fakeUuid}/config`)
        .set('Origin', 'http://localhost:5000');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('ETag & Caching Protocol', () => {
    let initialETag = '';

    it('should return ETag header and Cache-Control on initial request', async () => {
      const res = await request(app)
        .get(`/api/v1/public/widgets/${activeWidgetId}/config`)
        .set('Origin', 'http://localhost:5000');

      expect(res.status).toBe(200);
      expect(res.headers['etag']).toBeDefined();
      expect(res.headers['cache-control']).toContain('public');
      initialETag = res.headers['etag'];
    });

    it('should return 304 Not Modified when client supplies matching If-None-Match header', async () => {
      const res = await request(app)
        .get(`/api/v1/public/widgets/${activeWidgetId}/config`)
        .set('Origin', 'http://localhost:5000')
        .set('If-None-Match', initialETag);

      expect(res.status).toBe(304);
      expect(res.text).toBe('');
    });

    it('should return updated 200 and a new ETag after the widget configuration is modified', async () => {
      // Modify widget configuration (increments version from 1 to 2)
      await request(app)
        .patch(`/api/v1/widgets/${activeWidgetId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Newsletter Signup V2',
          theme: { primaryColor: '#ef4444', buttonText: 'Join Today' },
        });

      // Request config again with prior ETag
      const res = await request(app)
        .get(`/api/v1/public/widgets/${activeWidgetId}/config`)
        .set('Origin', 'http://localhost:5000')
        .set('If-None-Match', initialETag);

      // Must NOT return 304; must return updated 200 with new version and new ETag
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Newsletter Signup V2');
      expect(res.body.data.version).toBe(2);
      expect(res.headers['etag']).toBeDefined();
      expect(res.headers['etag']).not.toBe(initialETag);
    });
  });

  describe('GET /widget.js (Embed Loader Delivery)', () => {
    it('should return 200 OK with application/javascript for a valid widget UUID', async () => {
      const res = await request(app).get(`/widget.js?id=${activeWidgetId}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/javascript');
      expect(res.headers['cache-control']).toContain('public');
      expect(res.text).toContain(activeWidgetId);
      expect(res.text).toContain('/api/v1/public/widgets/');
    });

    it('should reject request missing id query parameter (HTTP 400)', async () => {
      const res = await request(app).get('/widget.js');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });

    it('should reject arbitrary path traversal attacks in id parameter (HTTP 400)', async () => {
      const res = await request(app).get('/widget.js?id=../../../../etc/passwd');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });

    it('should verify script DOM rendering uses safe DOM manipulation rather than unsafe innerHTML', async () => {
      const res = await request(app).get(`/widget.js?id=${activeWidgetId}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('document.createElement');
      expect(res.text).toContain('textContent');
      // Verify no direct unsafe assignment of raw values into innerHTML
      expect(res.text).not.toContain('.innerHTML = config');
      expect(res.text).not.toContain('.innerHTML = field');
    });
  });
});
