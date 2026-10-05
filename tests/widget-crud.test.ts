import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { closePool, query } from '../src/shared/db.js';

describe('Widget Management Domain (/api/v1/widgets)', () => {
  const seed = `w_crud_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  let tokenA = '';
  let tenantAId = '';
  let tokenB = '';
  let tenantBId = '';
  let widgetAId = '';
  let widgetBId = '';

  beforeAll(async () => {
    // 1. Register Tenant A
    const resA = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: `Tenant Alpha ${seed}`,
        email: `alpha-${seed}@corp.com`,
        password: 'Password123!',
      });
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
    tokenB = resB.body.data.token;
    tenantBId = resB.body.data.tenant.id;
  });

  afterAll(async () => {
    await query('DELETE FROM widgets WHERE tenant_id IN ($1, $2);', [tenantAId, tenantBId]);
    await query('DELETE FROM users WHERE email LIKE $1;', [`%${seed}%`]);
    await query('DELETE FROM tenants WHERE id IN ($1, $2);', [tenantAId, tenantBId]);
    await closePool();
  });

  describe('Database Schema & Foreign Key Verification', () => {
    it('should verify widgets table exists in information_schema', async () => {
      const res = await query<{ table_name: string }>(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'widgets';
      `);
      expect(res.rows.length).toBe(1);
    });

    it('should verify widgets foreign key points to tenants table', async () => {
      const res = await query<{ constraint_name: string }>(`
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = 'widgets' AND constraint_type = 'FOREIGN KEY';
      `);
      expect(res.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Authenticated Widget CRUD Operations', () => {
    it('should reject unauthenticated widget creation with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/widgets')
        .send({
          name: 'Public Form',
          allowedOrigins: ['http://localhost:5000'],
          fields: [{ name: 'email', type: 'email', label: 'Email', required: true }],
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should create a new widget with initial version 1 and embed snippet (HTTP 201)', async () => {
      const res = await request(app)
        .post('/api/v1/widgets')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Contact Sales',
          allowedOrigins: ['http://localhost:5000', 'https://example.com'],
          fields: [
            { name: 'name', type: 'text', label: 'Full Name', required: true },
            { name: 'email', type: 'email', label: 'Business Email', required: true },
            { name: 'message', type: 'textarea', label: 'Inquiry', required: false },
          ],
          theme: {
            primaryColor: '#2563eb',
            buttonText: 'Send Inquiry',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.widget).toBeDefined();
      expect(res.body.data.widget.id).toBeDefined();
      expect(res.body.data.widget.tenantId).toBe(tenantAId);
      expect(res.body.data.widget.name).toBe('Contact Sales');
      expect(res.body.data.widget.version).toBe(1);
      expect(res.body.data.widget.isActive).toBe(true);
      expect(res.body.data.widget.fieldsConfig).toHaveLength(3);
      expect(res.body.data.embedSnippet).toContain(`/widget.js?id=${res.body.data.widget.id}`);

      widgetAId = res.body.data.widget.id;
    });

    it('should list all widgets belonging to Tenant A', async () => {
      const res = await request(app)
        .get('/api/v1/widgets')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      const found = res.body.data.find((w: { id: string }) => w.id === widgetAId);
      expect(found).toBeDefined();
    });

    it('should retrieve a single widget by ID for Tenant A', async () => {
      const res = await request(app)
        .get(`/api/v1/widgets/${widgetAId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.widget.id).toBe(widgetAId);
      expect(res.body.data.widget.tenantId).toBe(tenantAId);
      expect(res.body.data.embedSnippet).toBeDefined();
    });

    it('should update widget configuration and increment version from 1 to 2 (HTTP 200)', async () => {
      const res = await request(app)
        .patch(`/api/v1/widgets/${widgetAId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Contact Sales Updated',
          theme: {
            primaryColor: '#10b981',
            buttonText: 'Submit Now',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.widget.name).toBe('Contact Sales Updated');
      expect(res.body.data.widget.themeConfig.primaryColor).toBe('#10b981');
      expect(res.body.data.widget.themeConfig.buttonText).toBe('Submit Now');
      expect(res.body.data.widget.version).toBe(2);
    });

    it('should deactivate/soft-delete a widget (HTTP 204)', async () => {
      const res = await request(app)
        .delete(`/api/v1/widgets/${widgetAId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(204);

      // Verify in database that widget is deactivated (soft deleted)
      const dbCheck = await query<{ is_active: boolean }>(
        'SELECT is_active FROM widgets WHERE id = $1;',
        [widgetAId],
      );
      expect(dbCheck.rows[0].is_active).toBe(false);
    });
  });

  describe('Validation Guards', () => {
    it('should reject invalid field type (HTTP 400)', async () => {
      const res = await request(app)
        .post('/api/v1/widgets')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Invalid Field Form',
          allowedOrigins: ['http://localhost:5000'],
          fields: [{ name: 'age', type: 'number', label: 'Age' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject wildcard origin "*" (HTTP 400)', async () => {
      const res = await request(app)
        .post('/api/v1/widgets')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Wildcard Form',
          allowedOrigins: ['*'],
          fields: [{ name: 'name', type: 'text', label: 'Name' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid origin containing paths (HTTP 400)', async () => {
      const res = await request(app)
        .post('/api/v1/widgets')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Path Origin Form',
          allowedOrigins: ['https://example.com/blog/posts'],
          fields: [{ name: 'name', type: 'text', label: 'Name' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Tenant Isolation Boundaries for Widgets', () => {
    beforeAll(async () => {
      // Create a widget for Tenant B
      const res = await request(app)
        .post('/api/v1/widgets')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          name: 'Beta Confidential Form',
          allowedOrigins: ['http://localhost:5001'],
          fields: [{ name: 'feedback', type: 'textarea', label: 'Feedback' }],
        });
      widgetBId = res.body.data.widget.id;
    });

    it('should prevent Tenant A from retrieving Tenant B widget (safe 404)', async () => {
      const res = await request(app)
        .get(`/api/v1/widgets/${widgetBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('should prevent Tenant A from updating Tenant B widget (safe 404)', async () => {
      const res = await request(app)
        .patch(`/api/v1/widgets/${widgetBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Hacked by Tenant A' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');

      // Verify widget B name was not modified in database
      const check = await query<{ name: string }>('SELECT name FROM widgets WHERE id = $1;', [
        widgetBId,
      ]);
      expect(check.rows[0].name).toBe('Beta Confidential Form');
    });

    it('should prevent Tenant A from deleting Tenant B widget (safe 404)', async () => {
      const res = await request(app)
        .delete(`/api/v1/widgets/${widgetBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);

      // Verify widget B is still active
      const check = await query<{ is_active: boolean }>(
        'SELECT is_active FROM widgets WHERE id = $1;',
        [widgetBId],
      );
      expect(check.rows[0].is_active).toBe(true);
    });

    it('should verify Tenant A widget list NEVER contains Tenant B widget', async () => {
      const res = await request(app)
        .get('/api/v1/widgets')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const bInAList = res.body.data.some((w: { id: string }) => w.id === widgetBId);
      expect(bInAList).toBe(false);
    });
  });
});
