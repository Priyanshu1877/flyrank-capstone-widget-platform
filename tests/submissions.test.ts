import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { query } from '../src/shared/db.js';
import { tenantRepository } from '../src/modules/tenants/tenant.repository.js';
import { widgetRepository } from '../src/modules/widgets/widget.repository.js';

describe('Public Submissions Domain (Phase 2C-1)', () => {
  const prefix = `sub_${Date.now()}`;
  let tenantAId: string;
  let tenantBId: string;
  let widgetAId: string;
  let widgetBId: string;
  let inactiveWidgetId: string;

  beforeAll(async () => {
    // 1. Setup Tenant A and its active widget
    const tenantA = await tenantRepository.create(`Tenant A ${prefix}`, `tenant-a-${prefix}`);
    tenantAId = tenantA.id;

    const widgetA = await widgetRepository.create(tenantAId, {
      name: 'Widget A Lead Form',
      isActive: true,
      allowedOrigins: ['http://localhost:5000', 'https://tenant-a.com'],
      fields: [
        { name: 'name', type: 'text', label: 'Full Name', required: true },
        { name: 'email', type: 'email', label: 'Work Email', required: true },
        { name: 'notes', type: 'textarea', label: 'Notes', required: false },
      ],
      theme: { primaryColor: '#2563eb', buttonText: 'Submit' },
    });
    widgetAId = widgetA.id;

    // 2. Setup Tenant B and its active widget
    const tenantB = await tenantRepository.create(`Tenant B ${prefix}`, `tenant-b-${prefix}`);
    tenantBId = tenantB.id;

    const widgetB = await widgetRepository.create(tenantBId, {
      name: 'Widget B Lead Form',
      isActive: true,
      allowedOrigins: ['http://localhost:5000', 'https://tenant-b.com'],
      fields: [
        { name: 'name', type: 'text', label: 'Full Name', required: true },
        { name: 'email', type: 'email', label: 'Work Email', required: true },
      ],
      theme: { primaryColor: '#10b981', buttonText: 'Contact' },
    });
    widgetBId = widgetB.id;

    // 3. Setup inactive widget under Tenant A
    const inactiveWidget = await widgetRepository.create(tenantAId, {
      name: 'Inactive Widget Form',
      isActive: false,
      allowedOrigins: ['http://localhost:5000'],
      fields: [{ name: 'email', type: 'email', label: 'Email', required: true }],
      theme: { primaryColor: '#6b7280', buttonText: 'Submit' },
    });
    inactiveWidgetId = inactiveWidget.id;
  });

  afterAll(async () => {
    // Clean up test data scoped to this test suite's prefix
    await query(
      "DELETE FROM tenants WHERE slug LIKE 'tenant-a-' || $1 OR slug LIKE 'tenant-b-' || $1;",
      [prefix],
    );
  });

  // 1. Valid submission -> 201
  it('1. should accept a valid submission and return HTTP 201', async () => {
    const res = await request(app)
      .post('/api/v1/public/submissions')
      .set('Origin', 'https://tenant-a.com')
      .send({
        widgetId: widgetAId,
        data: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          notes: 'Looking for enterprise pricing',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.submissionId).toBeDefined();
    expect(res.body.createdAt).toBeDefined();
    expect(res.body.receivedAt).toBeDefined();
  });

  // 2. Submission is persisted in PostgreSQL
  it('2. should persist submission record durably in PostgreSQL', async () => {
    const res = await request(app)
      .post('/api/v1/public/submissions')
      .set('Origin', 'https://tenant-a.com')
      .send({
        widgetId: widgetAId,
        data: {
          name: 'DB Persistence Test',
          email: 'dbtest@example.com',
        },
      });

    expect(res.status).toBe(201);
    const submissionId = res.body.submissionId;

    const dbRes = await query<{
      id: string;
      tenant_id: string;
      widget_id: string;
      payload: { name: string; email: string };
      origin: string;
    }>('SELECT id, tenant_id, widget_id, payload, origin FROM submissions WHERE id = $1;', [
      submissionId,
    ]);

    expect(dbRes.rows.length).toBe(1);
    const row = dbRes.rows[0];
    expect(row.id).toBe(submissionId);
    expect(row.tenant_id).toBe(tenantAId);
    expect(row.widget_id).toBe(widgetAId);
    expect(row.payload.name).toBe('DB Persistence Test');
    expect(row.payload.email).toBe('dbtest@example.com');
    expect(row.origin).toBe('https://tenant-a.com');
  });

  // 3. Unknown widget -> 4xx (404)
  it('3. should reject submission for an unknown widget with HTTP 404', async () => {
    const randomUuid = '00000000-0000-4000-8000-000000000000';
    const res = await request(app)
      .post('/api/v1/public/submissions')
      .send({
        widgetId: randomUuid,
        data: { name: 'Test', email: 'test@example.com' },
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  // 4. Inactive widget -> 4xx (404)
  it('4. should reject submission for an inactive widget with HTTP 404', async () => {
    const res = await request(app)
      .post('/api/v1/public/submissions')
      .send({
        widgetId: inactiveWidgetId,
        data: { email: 'test@example.com' },
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  // 5. Allowed origin -> accepted with CORS header
  it('5. should accept submission from an allowed origin and return Access-Control-Allow-Origin', async () => {
    const res = await request(app)
      .post('/api/v1/public/submissions')
      .set('Origin', 'https://tenant-a.com')
      .send({
        widgetId: widgetAId,
        data: { name: 'Allowed Origin', email: 'origin@tenant-a.com' },
      });

    expect(res.status).toBe(201);
    expect(res.headers['access-control-allow-origin']).toBe('https://tenant-a.com');
  });

  // 6. Disallowed origin -> rejected with 403
  it('6. should reject submission from an unauthorized origin with HTTP 403 and omit CORS header', async () => {
    const res = await request(app)
      .post('/api/v1/public/submissions')
      .set('Origin', 'https://malicious-site.com')
      .send({
        widgetId: widgetAId,
        data: { name: 'Hacker', email: 'hacker@evil.com' },
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  // 7. OPTIONS preflight works correctly
  it('7. should handle OPTIONS preflight with allowed headers and methods', async () => {
    // Valid preflight for allowed origin
    const resAllowed = await request(app)
      .options('/api/v1/public/submissions')
      .set('Origin', 'https://tenant-a.com');

    expect(resAllowed.status).toBe(204);
    expect(resAllowed.headers['access-control-allow-origin']).toBe('https://tenant-a.com');
    expect(resAllowed.headers['access-control-allow-methods']).toContain('POST');
    expect(resAllowed.headers['access-control-allow-headers']).toContain('Idempotency-Key');

    // Preflight for disallowed origin
    const resDisallowed = await request(app)
      .options('/api/v1/public/submissions')
      .set('Origin', 'https://unauthorized-domain.com');

    expect(resDisallowed.status).toBe(403);
    expect(resDisallowed.headers['access-control-allow-origin']).toBeUndefined();
  });

  // 8. Missing required field -> rejected
  it('8. should reject submission when required field is missing with HTTP 400', async () => {
    const res = await request(app)
      .post('/api/v1/public/submissions')
      .send({
        widgetId: widgetAId,
        data: {
          name: 'Missing Email Person',
          // email is omitted
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((d: { field: string }) => d.field === 'data.email')).toBe(
      true,
    );
  });

  // 9. Invalid field type -> rejected
  it('9. should reject submission with invalid field type or invalid email with HTTP 400', async () => {
    const res = await request(app)
      .post('/api/v1/public/submissions')
      .send({
        widgetId: widgetAId,
        data: {
          name: 'John',
          email: 'not-a-valid-email-address',
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((d: { field: string }) => d.field === 'data.email')).toBe(
      true,
    );
  });

  // 10. Unknown field -> rejected
  it('10. should reject submission containing unconfigured/unknown fields with HTTP 400', async () => {
    const res = await request(app)
      .post('/api/v1/public/submissions')
      .send({
        widgetId: widgetAId,
        data: {
          name: 'Valid Name',
          email: 'valid@example.com',
          unknownFieldAttack: 'injected_value',
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(
      res.body.error.details.some((d: { field: string }) => d.field === 'data.unknownFieldAttack'),
    ).toBe(true);
  });

  // 11. Malformed payload -> rejected
  it('11. should reject malformed payload (e.g. data is not an object or malformed JSON) with HTTP 400', async () => {
    const res = await request(app).post('/api/v1/public/submissions').send({
      widgetId: widgetAId,
      data: 'this-should-be-an-object',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // 12. Payload larger than 16 KB -> 413
  it('12. should reject payloads exceeding 16 KB with HTTP 413 Payload Too Large', async () => {
    // Generate a payload exceeding 16 KB (16384 bytes)
    const largeNote = 'A'.repeat(17 * 1024); // 17 KB

    const res = await request(app)
      .post('/api/v1/public/submissions')
      .send({
        widgetId: widgetAId,
        data: {
          name: 'Large Payload Sender',
          email: 'large@example.com',
          notes: largeNote,
        },
      });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  // 13. First request with Idempotency-Key -> 201
  it('13. should successfully process the first request with an Idempotency-Key (HTTP 201)', async () => {
    const idempotencyKey = `idem-key-${Date.now()}-13`;

    const res = await request(app)
      .post('/api/v1/public/submissions')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        widgetId: widgetAId,
        data: {
          name: 'First Idempotent User',
          email: 'first-idem@example.com',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.submissionId).toBeDefined();
    expect(res.body.status).toBe('success');
  });

  // 14. Same widget + same key + same payload -> no duplicate, replayed result
  it('14. should return the existing submission without creating duplicates when same key and payload are sent', async () => {
    const idempotencyKey = `idem-key-${Date.now()}-14`;
    const payload = {
      widgetId: widgetAId,
      data: {
        name: 'Replay User',
        email: 'replay@example.com',
      },
    };

    // First attempt
    const res1 = await request(app)
      .post('/api/v1/public/submissions')
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res1.status).toBe(201);
    const submissionId = res1.body.submissionId;

    // Second attempt with exact same key and payload
    const res2 = await request(app)
      .post('/api/v1/public/submissions')
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect([200, 201]).toContain(res2.status);
    expect(res2.body.submissionId).toBe(submissionId);
    expect(res2.body.idempotentReplay).toBe(true);

    // Verify database row count for this idempotency key is exactly 1
    const countRes = await query<{ count: string }>(
      'SELECT count(*) FROM submissions WHERE widget_id = $1 AND idempotency_key = $2;',
      [widgetAId, idempotencyKey],
    );
    expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
  });

  // 15. Same widget + same key + different payload -> 409 Conflict
  it('15. should return HTTP 409 Conflict when the same key is reused with a different payload', async () => {
    const idempotencyKey = `idem-key-${Date.now()}-15`;

    // First request
    const res1 = await request(app)
      .post('/api/v1/public/submissions')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        widgetId: widgetAId,
        data: { name: 'Initial Payload', email: 'initial@example.com' },
      });
    expect(res1.status).toBe(201);

    // Second request with altered payload
    const res2 = await request(app)
      .post('/api/v1/public/submissions')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        widgetId: widgetAId,
        data: { name: 'Different Payload Name', email: 'initial@example.com' },
      });

    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  // 16. Same key on different widgets -> independent scopes
  it('16. should treat same Idempotency-Key on different widgets as independent scopes', async () => {
    const sharedKey = `shared-idem-key-${Date.now()}`;

    // Submit to Widget A
    const resA = await request(app)
      .post('/api/v1/public/submissions')
      .set('Idempotency-Key', sharedKey)
      .send({
        widgetId: widgetAId,
        data: { name: 'Widget A Submitter', email: 'wa@example.com' },
      });
    expect(resA.status).toBe(201);

    // Submit to Widget B with identical key
    const resB = await request(app)
      .post('/api/v1/public/submissions')
      .set('Idempotency-Key', sharedKey)
      .send({
        widgetId: widgetBId,
        data: { name: 'Widget B Submitter', email: 'wb@example.com' },
      });
    expect(resB.status).toBe(201);

    expect(resA.body.submissionId).not.toBe(resB.body.submissionId);
  });

  // 17. Request without Idempotency-Key -> normal submission
  it('17. should process submissions normally without Idempotency-Key, creating distinct records', async () => {
    const payload = {
      widgetId: widgetAId,
      data: { name: 'No Key User', email: 'nokey@example.com' },
    };

    const res1 = await request(app).post('/api/v1/public/submissions').send(payload);
    expect(res1.status).toBe(201);

    const res2 = await request(app).post('/api/v1/public/submissions').send(payload);
    expect(res2.status).toBe(201);

    expect(res1.body.submissionId).not.toBe(res2.body.submissionId);
  });

  // 18. Concurrent duplicate idempotency requests cannot create duplicate rows
  it('18. should handle concurrent duplicate idempotency requests safely without duplicating rows', async () => {
    const concurrentKey = `concurrent-key-${Date.now()}`;
    const payload = {
      widgetId: widgetAId,
      data: {
        name: 'Concurrent Runner',
        email: 'concurrent@example.com',
      },
    };

    // Fire 5 identical requests concurrently
    const responses = await Promise.all([
      request(app)
        .post('/api/v1/public/submissions')
        .set('Idempotency-Key', concurrentKey)
        .send(payload),
      request(app)
        .post('/api/v1/public/submissions')
        .set('Idempotency-Key', concurrentKey)
        .send(payload),
      request(app)
        .post('/api/v1/public/submissions')
        .set('Idempotency-Key', concurrentKey)
        .send(payload),
      request(app)
        .post('/api/v1/public/submissions')
        .set('Idempotency-Key', concurrentKey)
        .send(payload),
      request(app)
        .post('/api/v1/public/submissions')
        .set('Idempotency-Key', concurrentKey)
        .send(payload),
    ]);

    // All should succeed with 200 or 201
    for (const res of responses) {
      expect([200, 201]).toContain(res.status);
    }

    // All responses must share the exact same submissionId
    const firstSubmissionId = responses[0].body.submissionId;
    for (const res of responses) {
      expect(res.body.submissionId).toBe(firstSubmissionId);
    }

    // Verify directly in DB: strictly ONE row created
    const countRes = await query<{ count: string }>(
      'SELECT count(*) FROM submissions WHERE widget_id = $1 AND idempotency_key = $2;',
      [widgetAId, concurrentKey],
    );
    expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
  });

  // 19. Client cannot select another tenant's widget through tenant_id manipulation
  it('19. should associate submission with widget owner tenant regardless of client-supplied tenant_id', async () => {
    const res = await request(app)
      .post('/api/v1/public/submissions')
      .send({
        widgetId: widgetAId,
        tenant_id: tenantBId, // Attempted spoof of tenant B
        tenantId: tenantBId,
        data: {
          name: 'Spoof Attacker',
          email: 'attacker@evil.com',
        },
      });

    expect(res.status).toBe(201);
    const submissionId = res.body.submissionId;

    const dbRes = await query<{ tenant_id: string }>(
      'SELECT tenant_id FROM submissions WHERE id = $1;',
      [submissionId],
    );
    expect(dbRes.rows[0].tenant_id).toBe(tenantAId);
    expect(dbRes.rows[0].tenant_id).not.toBe(tenantBId);
  });

  // 20. Response does not expose sensitive/internal fields
  it('20. should not expose tenant_id, database internals, or client IP in the response payload', async () => {
    const res = await request(app)
      .post('/api/v1/public/submissions')
      .send({
        widgetId: widgetAId,
        data: {
          name: 'Privacy Check',
          email: 'privacy@example.com',
        },
      });

    expect(res.status).toBe(201);
    const body = res.body;

    expect(body.tenantId).toBeUndefined();
    expect(body.tenant_id).toBeUndefined();
    expect(body.ipAddress).toBeUndefined();
    expect(body.ip_address).toBeUndefined();
    expect(body.userAgent).toBeUndefined();
    expect(body.user_agent).toBeUndefined();
    expect(body.database).toBeUndefined();
    expect(body.sql).toBeUndefined();
  });
});
