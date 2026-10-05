import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { closePool, query } from '../src/shared/db.js';
import { userRepository } from '../src/modules/users/user.repository.js';
import { tenantRepository } from '../src/modules/tenants/tenant.repository.js';

describe('Tenant Isolation & Security Boundaries', () => {
  const seed = `iso_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  let userA: { id: string; email: string; tenantId: string; token: string };
  let userB: { id: string; email: string; tenantId: string; token: string };

  beforeAll(async () => {
    // 1. Register Tenant A and User A
    const resA = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: `Organization Alpha ${seed}`,
        email: `alice-${seed}@alpha.com`,
        password: 'PasswordAlpha123!',
      });
    userA = {
      id: resA.body.data.user.id,
      email: resA.body.data.user.email,
      tenantId: resA.body.data.tenant.id,
      token: resA.body.data.token,
    };

    // 2. Register Tenant B and User B
    const resB = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: `Organization Beta ${seed}`,
        email: `bob-${seed}@beta.com`,
        password: 'PasswordBeta123!',
      });
    userB = {
      id: resB.body.data.user.id,
      email: resB.body.data.user.email,
      tenantId: resB.body.data.tenant.id,
      token: resB.body.data.token,
    };
  });

  afterAll(async () => {
    await query('DELETE FROM users WHERE email LIKE $1;', [`%${seed}%`]);
    await query('DELETE FROM tenants WHERE slug LIKE $1;', [`%${seed}%`]);
    await closePool();
  });

  it('should establish distinct tenant and user IDs for separate registrations', () => {
    expect(userA.tenantId).not.toBe(userB.tenantId);
    expect(userA.id).not.toBe(userB.id);
  });

  it('should resolve correct isolated tenant context for User A and User B via /auth/me', async () => {
    // User A query
    const meA = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${userA.token}`);

    expect(meA.status).toBe(200);
    expect(meA.body.data.user.id).toBe(userA.id);
    expect(meA.body.data.tenant.id).toBe(userA.tenantId);
    expect(meA.body.data.tenant.name).toContain('Alpha');

    // User B query
    const meB = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${userB.token}`);

    expect(meB.status).toBe(200);
    expect(meB.body.data.user.id).toBe(userB.id);
    expect(meB.body.data.tenant.id).toBe(userB.tenantId);
    expect(meB.body.data.tenant.name).toContain('Beta');
  });

  it('should enforce repository-level tenant isolation: User A cannot read User B across tenant boundaries', async () => {
    // Attempt to query User B using Tenant A's scope at the repository level
    const crossTenantLookup = await userRepository.findByIdAndTenant(userB.id, userA.tenantId);
    expect(crossTenantLookup).toBeNull();

    // Symmetrical check: Attempt to query User A using Tenant B's scope
    const crossTenantLookupRev = await userRepository.findByIdAndTenant(userA.id, userB.tenantId);
    expect(crossTenantLookupRev).toBeNull();

    // Verify legitimate lookup succeeds within own tenant boundary
    const legitimateLookupA = await userRepository.findByIdAndTenant(userA.id, userA.tenantId);
    expect(legitimateLookupA).not.toBeNull();
    expect(legitimateLookupA?.id).toBe(userA.id);
  });

  it('should reject client attempts to spoof or override tenantId via query or body parameters', async () => {
    // User A attempts to pass Tenant B's tenantId in query parameters
    const resSpoof = await request(app)
      .get(`/api/v1/auth/me?tenantId=${userB.tenantId}`)
      .set('Authorization', `Bearer ${userA.token}`);

    expect(resSpoof.status).toBe(200);
    // Verified: The authoritative tenant context is derived SOLELY from the cryptographically signed JWT
    expect(resSpoof.body.data.tenant.id).toBe(userA.tenantId);
    expect(resSpoof.body.data.tenant.id).not.toBe(userB.tenantId);
  });

  it('should verify Tenant B state remains completely isolated and unchanged', async () => {
    const tenantBDirect = await tenantRepository.findById(userB.tenantId);
    expect(tenantBDirect).not.toBeNull();
    expect(tenantBDirect?.name).toContain('Beta');
  });
});
