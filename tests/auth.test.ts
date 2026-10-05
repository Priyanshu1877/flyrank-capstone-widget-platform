import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import { closePool, query } from '../src/shared/db.js';
import { userRepository } from '../src/modules/users/user.repository.js';

describe('Authentication & Identity Domain (/api/v1/auth)', () => {
  const uniqueId = `auth_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const testEmail = `${uniqueId}@example.com`;
  const testPassword = 'StrongPassword123!';
  let authToken = '';

  afterAll(async () => {
    // Cleanup created test records exclusively for this suite
    await query('DELETE FROM users WHERE email LIKE $1;', [`${uniqueId}%`]);
    await query('DELETE FROM tenants WHERE slug LIKE $1;', [`%${uniqueId}%`]);
    await closePool();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new tenant and user successfully (HTTP 201)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: `Acme Corp ${uniqueId}`,
          email: testEmail,
          password: testPassword,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.email).toBe(testEmail.toLowerCase());
      expect(res.body.data.user.role).toBe('owner');
      expect(res.body.data.tenant).toBeDefined();
      expect(res.body.data.tenant.name).toBe(`Acme Corp ${uniqueId}`);

      // Critical Security Check: password_hash must NEVER be returned in response
      expect(res.body.data.user.password_hash).toBeUndefined();
      expect(res.body.data.user.passwordHash).toBeUndefined();

      authToken = res.body.data.token;

      // Verify directly in database that password_hash is securely encrypted
      const dbUserRes = await query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE email = $1;',
        [testEmail.toLowerCase()],
      );
      expect(dbUserRes.rows.length).toBe(1);
      const hash = dbUserRes.rows[0].password_hash;
      expect(hash).not.toBe(testPassword);
      expect(hash.startsWith('$2a$') || hash.startsWith('$2b$')).toBe(true);
    });

    it('should reject registration with invalid email format (HTTP 400)', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        name: 'Invalid Email Tenant',
        email: 'not-an-email',
        password: testPassword,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject registration with short password (< 8 chars) (HTTP 400)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Short Password Tenant',
          email: `short-${uniqueId}@example.com`,
          password: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject duplicate email registration with 409 Conflict', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        name: 'Duplicate Tenant',
        email: testEmail,
        password: testPassword,
      });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.message).toContain('already registered');
    });

    it('should rollback tenant creation if user creation fails (transaction integrity)', async () => {
      const originalCreate = userRepository.create;
      const failingTenantName = `Rollback Test Tenant ${uniqueId}`;

      userRepository.create = async () => {
        throw new Error('Simulated database failure during user creation');
      };

      try {
        const res = await request(app)
          .post('/api/v1/auth/register')
          .send({
            name: failingTenantName,
            email: `rollback-test-${uniqueId}@example.com`,
            password: testPassword,
          });

        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');

        // Verify that NO orphan tenant exists in PostgreSQL
        const checkTenant = await query('SELECT * FROM tenants WHERE name = $1;', [
          failingTenantName,
        ]);
        expect(checkTenant.rows.length).toBe(0);
      } finally {
        userRepository.create = originalCreate;
      }
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should authenticate with valid credentials and return JWT (HTTP 200)', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: testEmail,
        password: testPassword,
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.email).toBe(testEmail.toLowerCase());
      expect(res.body.data.user.password_hash).toBeUndefined();
    });

    it('should reject login with incorrect password with safe generic 401', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: testEmail,
        password: 'WrongPassword999!',
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('should reject login with non-existent email with identical safe 401 (anti-enumeration)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: `nonexistent-${uniqueId}@example.com`,
          password: 'AnyPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Invalid email or password');
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return authenticated user and tenant profile when token is valid (HTTP 200)', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user.email).toBe(testEmail.toLowerCase());
      expect(res.body.data.tenant.id).toBe(res.body.data.user.tenantId);
      expect(res.body.data.user.password_hash).toBeUndefined();
    });

    it('should reject request when Authorization header is missing (HTTP 401)', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject request with malformed Authorization scheme (HTTP 401)', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Basic some-fake-base64`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject request with tampered/invalid JWT signature (HTTP 401)', async () => {
      const tamperedToken = authToken.slice(0, -6) + 'abcdef';
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tamperedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject request with expired JWT token (HTTP 401)', async () => {
      // Generate explicitly expired token
      const expiredToken = jwt.sign(
        { sub: 'test-user', tenantId: 'test-tenant', role: 'owner' },
        env.JWT_SECRET,
        { expiresIn: '0s' },
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
