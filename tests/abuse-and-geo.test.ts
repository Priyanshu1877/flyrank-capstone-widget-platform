import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { query } from '../src/shared/db.js';
import { tenantRepository } from '../src/modules/tenants/tenant.repository.js';
import { widgetRepository } from '../src/modules/widgets/widget.repository.js';
import { submissionRateLimiter } from '../src/modules/submissions/rate-limiter.js';
import { geoService } from '../src/providers/geo/geo.service.js';
import { mockGeoProviderA } from '../src/providers/geo/provider-a.js';
import { mockGeoProviderB } from '../src/providers/geo/provider-b.js';

describe('Phase 2C-2: Abuse Protection, Honeypot & Geo Enrichment', () => {
  const prefix = `geo_${Date.now()}`;
  let tenantId: string;
  let widgetId: string;
  let secondWidgetId: string;

  beforeAll(async () => {
    // 1. Create tenant and widgets for testing
    const tenant = await tenantRepository.create(`Geo Tenant ${prefix}`, `geo-tenant-${prefix}`);
    tenantId = tenant.id;

    const widget = await widgetRepository.create(tenantId, {
      name: 'Abuse Protection Test Form',
      isActive: true,
      allowedOrigins: ['http://localhost:5000', 'https://safe-origin.com'],
      fields: [
        { name: 'name', type: 'text', label: 'Full Name', required: true },
        { name: 'email', type: 'email', label: 'Work Email', required: true },
        { name: 'comments', type: 'textarea', label: 'Comments', required: false },
      ],
      theme: { primaryColor: '#2563eb', buttonText: 'Submit' },
    });
    widgetId = widget.id;

    const secondWidget = await widgetRepository.create(tenantId, {
      name: 'Second Test Widget',
      isActive: true,
      allowedOrigins: ['http://localhost:5000', 'https://safe-origin.com'],
      fields: [
        { name: 'name', type: 'text', label: 'Full Name', required: true },
        { name: 'email', type: 'email', label: 'Work Email', required: true },
      ],
      theme: { primaryColor: '#10b981', buttonText: 'Submit' },
    });
    secondWidgetId = secondWidget.id;
  });

  beforeEach(() => {
    // Reset rate limiter and geo service between tests to ensure test isolation
    submissionRateLimiter.reset();
    submissionRateLimiter.configure({ windowMs: 60_000, maxRequests: 60 });
    geoService.reset();
    geoService.setTimeoutMs(500);
  });

  afterAll(async () => {
    // Restore default rate limiter and geo settings
    submissionRateLimiter.reset();
    submissionRateLimiter.configure({ windowMs: 60_000, maxRequests: 60 });
    geoService.reset();

    // Clean up tenant
    await query("DELETE FROM tenants WHERE slug LIKE 'geo-tenant-' || $1;", [prefix]);
  });

  // ============================================================
  // 1. RATE LIMITING TESTS
  // ============================================================
  describe('Rate Limiting', () => {
    it('1. should allow requests below the configured threshold', async () => {
      // Configure a low threshold for deterministic testing
      submissionRateLimiter.configure({ windowMs: 60_000, maxRequests: 3 });
      const clientIp = '198.51.100.1';

      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post('/api/v1/public/submissions')
          .set('X-Forwarded-For', clientIp)
          .send({
            widgetId,
            data: { name: `User ${i}`, email: `user${i}@example.com` },
          });
        expect(res.status).toBe(201);
      }
    });

    it('2. should return HTTP 429 when threshold is exceeded, with Retry-After header', async () => {
      submissionRateLimiter.configure({ windowMs: 60_000, maxRequests: 2 });
      const clientIp = '198.51.100.2';

      // Request 1: OK
      const res1 = await request(app)
        .post('/api/v1/public/submissions')
        .set('X-Forwarded-For', clientIp)
        .send({
          widgetId,
          data: { name: 'User 1', email: 'user1@example.com' },
        });
      expect(res1.status).toBe(201);

      // Request 2: OK
      const res2 = await request(app)
        .post('/api/v1/public/submissions')
        .set('X-Forwarded-For', clientIp)
        .send({
          widgetId,
          data: { name: 'User 2', email: 'user2@example.com' },
        });
      expect(res2.status).toBe(201);

      // Request 3: Exceeded -> 429
      const res3 = await request(app)
        .post('/api/v1/public/submissions')
        .set('X-Forwarded-For', clientIp)
        .send({
          widgetId,
          data: { name: 'User 3', email: 'user3@example.com' },
        });

      expect(res3.status).toBe(429);
      expect(res3.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(res3.body.error.message).toBe('Too many requests');
      expect(res3.headers['retry-after']).toBeDefined();
    });

    it('3. should enforce rate limiting BEFORE expensive geo enrichment work', async () => {
      submissionRateLimiter.configure({ windowMs: 60_000, maxRequests: 1 });
      const clientIp = '198.51.100.3';

      // Request 1: succeeds
      await request(app)
        .post('/api/v1/public/submissions')
        .set('X-Forwarded-For', clientIp)
        .send({
          widgetId,
          data: { name: 'User 1', email: 'user1@example.com' },
        });

      // Spy on Provider A
      let providerACalled = false;
      const originalLookup = mockGeoProviderA.lookup.bind(mockGeoProviderA);
      mockGeoProviderA.lookup = async (ip: string) => {
        providerACalled = true;
        return originalLookup(ip);
      };

      try {
        // Request 2: blocked by rate limiter
        const res = await request(app)
          .post('/api/v1/public/submissions')
          .set('X-Forwarded-For', clientIp)
          .send({
            widgetId,
            data: { name: 'User 2', email: 'user2@example.com' },
          });

        expect(res.status).toBe(429);
        expect(providerACalled).toBe(false); // Geo provider was NEVER invoked
      } finally {
        mockGeoProviderA.lookup = originalLookup;
      }
    });

    it('4. should prevent bypassing IP rate limits by changing widget IDs', async () => {
      submissionRateLimiter.configure({ windowMs: 60_000, maxRequests: 2 });
      const clientIp = '198.51.100.4';

      // Hit Widget 1 twice
      await request(app)
        .post('/api/v1/public/submissions')
        .set('X-Forwarded-For', clientIp)
        .send({
          widgetId,
          data: { name: 'User 1', email: 'user1@example.com' },
        });
      await request(app)
        .post('/api/v1/public/submissions')
        .set('X-Forwarded-For', clientIp)
        .send({
          widgetId,
          data: { name: 'User 2', email: 'user2@example.com' },
        });

      // Attempt to hit Widget 2 with the same abusive client IP -> should be blocked!
      const res = await request(app)
        .post('/api/v1/public/submissions')
        .set('X-Forwarded-For', clientIp)
        .send({
          widgetId: secondWidgetId,
          data: { name: 'User 3', email: 'user3@example.com' },
        });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('5. should allow requests to resume after rate limiter reset / window expiration', async () => {
      submissionRateLimiter.configure({ windowMs: 60_000, maxRequests: 1 });
      const clientIp = '198.51.100.5';

      await request(app)
        .post('/api/v1/public/submissions')
        .set('X-Forwarded-For', clientIp)
        .send({
          widgetId,
          data: { name: 'User 1', email: 'user1@example.com' },
        });

      // Limit reached
      const blockedRes = await request(app)
        .post('/api/v1/public/submissions')
        .set('X-Forwarded-For', clientIp)
        .send({
          widgetId,
          data: { name: 'User 2', email: 'user2@example.com' },
        });
      expect(blockedRes.status).toBe(429);

      // Simulate window reset
      submissionRateLimiter.reset();

      // Should succeed now
      const recoveredRes = await request(app)
        .post('/api/v1/public/submissions')
        .set('X-Forwarded-For', clientIp)
        .send({
          widgetId,
          data: { name: 'User 2', email: 'user2@example.com' },
        });
      expect(recoveredRes.status).toBe(201);
    });
  });

  // ============================================================
  // 2. HONEYPOT SPAM PROTECTION TESTS
  // ============================================================
  describe('Honeypot Spam Protection', () => {
    it('1. should accept normal submission when honeypot field is missing or empty', async () => {
      // Empty string honeypot
      const res = await request(app)
        .post('/api/v1/public/submissions')
        .send({
          widgetId,
          _hp_title: '',
          data: { name: 'Clean User', email: 'clean@example.com' },
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
    });

    it('2. should reject bot submission when honeypot _hp_title is populated', async () => {
      const res = await request(app)
        .post('/api/v1/public/submissions')
        .send({
          widgetId,
          _hp_title: 'https://spam-seo-backlinks.ru',
          data: { name: 'Spam Bot', email: 'spambot@example.com' },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SPAM_DETECTED');
      expect(res.body.error.message).toBe('Submission rejected');
    });

    it('3. should reject bot submission when honeypot _website is populated', async () => {
      const res = await request(app)
        .post('/api/v1/public/submissions')
        .send({
          widgetId,
          _website: 'http://commercial-spam.com',
          data: { name: 'Spam Bot', email: 'spambot@example.com' },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SPAM_DETECTED');
    });

    it('4. should NOT persist spam submission into the database', async () => {
      const uniqueSpamEmail = `spam-${Date.now()}@spammer.org`;

      await request(app)
        .post('/api/v1/public/submissions')
        .send({
          widgetId,
          _hp_title: 'bot keyword fill',
          data: { name: 'Ghost Spammer', email: uniqueSpamEmail },
        });

      // Verify ZERO records created in database
      const dbRes = await query<{ id: string }>(
        "SELECT id FROM submissions WHERE payload->>'email' = $1;",
        [uniqueSpamEmail],
      );
      expect(dbRes.rows.length).toBe(0);
    });

    it('5. should NOT invoke geo enrichment for honeypot spam submissions', async () => {
      let geoCalled = false;
      const originalLookup = mockGeoProviderA.lookup.bind(mockGeoProviderA);
      mockGeoProviderA.lookup = async (ip: string) => {
        geoCalled = true;
        return originalLookup(ip);
      };

      try {
        await request(app)
          .post('/api/v1/public/submissions')
          .send({
            widgetId,
            _hp_title: 'http://seo-scam.xyz',
            data: { name: 'Bot', email: 'bot@scam.xyz' },
          });

        expect(geoCalled).toBe(false);
      } finally {
        mockGeoProviderA.lookup = originalLookup;
      }
    });

    it('6. should prevent honeypot fields from overwriting internal submission fields', async () => {
      const res = await request(app)
        .post('/api/v1/public/submissions')
        .send({
          widgetId,
          _website: '', // empty -> clean
          tenant_id: 'fake-tenant-override',
          geo_provider: 'fake-provider-override',
          data: { name: 'Innocent User', email: 'innocent@example.com' },
        });

      expect(res.status).toBe(201);
      const subId = res.body.submissionId;

      const dbRes = await query<{ tenant_id: string; geo_provider: string }>(
        'SELECT tenant_id, geo_provider FROM submissions WHERE id = $1;',
        [subId],
      );
      expect(dbRes.rows[0].tenant_id).toBe(tenantId);
      expect(dbRes.rows[0].geo_provider).not.toBe('fake-provider-override');
    });
  });

  // ============================================================
  // 3. GEO ENRICHMENT & FALLBACK MATRIX
  // ============================================================
  describe('Geo Enrichment & Fallback Matrix', () => {
    // CASE 1: Provider A succeeds
    it('CASE 1: should store Provider A geo data when Provider A succeeds (Provider B is not called)', async () => {
      geoService.setProviderAMode('success');
      geoService.setProviderBMode('success');

      let providerBCalled = false;
      const originalBLookup = mockGeoProviderB.lookup.bind(mockGeoProviderB);
      mockGeoProviderB.lookup = async (ip: string) => {
        providerBCalled = true;
        return originalBLookup(ip);
      };

      try {
        const res = await request(app)
          .post('/api/v1/public/submissions')
          .send({
            widgetId,
            data: { name: 'Case 1 User', email: 'case1@example.com' },
          });

        expect(res.status).toBe(201);
        const subId = res.body.submissionId;

        const dbRes = await query<{
          geo_country: string;
          geo_city: string;
          geo_provider: string;
        }>('SELECT geo_country, geo_city, geo_provider FROM submissions WHERE id = $1;', [subId]);

        expect(dbRes.rows[0].geo_provider).toBe('provider_a');
        expect(dbRes.rows[0].geo_country).toBe('US');
        expect(dbRes.rows[0].geo_city).toBe('San Francisco');
        expect(providerBCalled).toBe(false);
      } finally {
        mockGeoProviderB.lookup = originalBLookup;
      }
    });

    // CASE 2: Provider A fails, Provider B succeeds
    it('CASE 2: should fall back to Provider B when Provider A fails and store Provider B geo data', async () => {
      geoService.setProviderAMode('failure');
      geoService.setProviderBMode('success');

      const res = await request(app)
        .post('/api/v1/public/submissions')
        .send({
          widgetId,
          data: { name: 'Case 2 User', email: 'case2@example.com' },
        });

      expect(res.status).toBe(201);
      const subId = res.body.submissionId;

      const dbRes = await query<{
        geo_country: string;
        geo_city: string;
        geo_provider: string;
      }>('SELECT geo_country, geo_city, geo_provider FROM submissions WHERE id = $1;', [subId]);

      expect(dbRes.rows[0].geo_provider).toBe('provider_b');
      expect(dbRes.rows[0].geo_country).toBe('CA');
      expect(dbRes.rows[0].geo_city).toBe('Toronto');
    });

    // CASE 3: Provider A succeeds with data -> Provider A is authoritative
    it('CASE 3: should treat Provider A as authoritative when both are healthy', async () => {
      geoService.setProviderAMode('success');
      geoService.setProviderBMode('success');

      const res = await request(app)
        .post('/api/v1/public/submissions')
        .send({
          widgetId,
          data: { name: 'Case 3 User', email: 'case3@example.com' },
        });

      expect(res.status).toBe(201);
      const subId = res.body.submissionId;

      const dbRes = await query<{ geo_provider: string }>(
        'SELECT geo_provider FROM submissions WHERE id = $1;',
        [subId],
      );
      expect(dbRes.rows[0].geo_provider).toBe('provider_a');
    });

    // CASE 4: Provider A fails AND Provider B fails -> Graceful nil-degradation
    it('CASE 4: should continue submission with NULL geo fields when both providers fail (graceful degradation)', async () => {
      geoService.setProviderAMode('failure');
      geoService.setProviderBMode('failure');

      const res = await request(app)
        .post('/api/v1/public/submissions')
        .send({
          widgetId,
          data: { name: 'Degraded User', email: 'degraded@example.com' },
        });

      // Lead capture must STILL SUCCEED with HTTP 201!
      expect(res.status).toBe(201);
      const subId = res.body.submissionId;

      const dbRes = await query<{
        geo_country: string | null;
        geo_city: string | null;
        geo_provider: string | null;
      }>('SELECT geo_country, geo_city, geo_provider FROM submissions WHERE id = $1;', [subId]);

      expect(dbRes.rows[0].geo_country).toBeNull();
      expect(dbRes.rows[0].geo_city).toBeNull();
      expect(dbRes.rows[0].geo_provider).toBeNull();

      // Verify no provider error was exposed in the response
      expect(res.body.error).toBeUndefined();
      expect(res.body.status).toBe('success');
    });

    // CASE 5: Provider experiences a timeout -> timeout contained, fallback succeeds
    it('CASE 5: should contain provider timeout within configured threshold and fall back cleanly', async () => {
      geoService.setProviderAMode('timeout'); // Provider A simulated to delay 800ms
      geoService.setProviderBMode('success');
      geoService.setTimeoutMs(100); // 100ms timeout threshold for rapid test execution

      const start = Date.now();
      const res = await request(app)
        .post('/api/v1/public/submissions')
        .send({
          widgetId,
          data: { name: 'Timeout Test User', email: 'timeout@example.com' },
        });
      const duration = Date.now() - start;

      expect(res.status).toBe(201);
      // Timeout should be caught in ~100-250ms, not hanging for full provider latency
      expect(duration).toBeLessThan(700);

      const subId = res.body.submissionId;
      const dbRes = await query<{ geo_provider: string }>(
        'SELECT geo_provider FROM submissions WHERE id = $1;',
        [subId],
      );
      // Successfully fell back to Provider B after A timed out
      expect(dbRes.rows[0].geo_provider).toBe('provider_b');
    });

    // Idempotent replay does not invoke geo enrichment again
    it('should NOT re-invoke geo enrichment during an idempotent replay', async () => {
      const idempotencyKey = `geo-idem-replay-${Date.now()}`;
      geoService.setProviderAMode('success');

      // Request 1: Fresh submission -> uses Provider A
      const res1 = await request(app)
        .post('/api/v1/public/submissions')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          widgetId,
          data: { name: 'Idem Geo User', email: 'idemgeo@example.com' },
        });
      expect(res1.status).toBe(201);

      // Now switch Provider A to failure
      geoService.setProviderAMode('failure');
      geoService.setProviderBMode('failure');

      // Request 2: Idempotent replay
      const res2 = await request(app)
        .post('/api/v1/public/submissions')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          widgetId,
          data: { name: 'Idem Geo User', email: 'idemgeo@example.com' },
        });

      // Should succeed as replay with original submissionId and NOT be affected by provider failures
      expect([200, 201]).toContain(res2.status);
      expect(res2.body.submissionId).toBe(res1.body.submissionId);
      expect(res2.body.idempotentReplay).toBe(true);
    });
  });
});
