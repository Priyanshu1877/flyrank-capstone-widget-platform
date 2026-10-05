import { randomBytes } from 'node:crypto';
import { getClient } from '../../shared/db.js';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../shared/errors.js';
import { tenantRepository } from '../tenants/tenant.repository.js';
import { userRepository, toSafeUser } from '../users/user.repository.js';
import { registerSchema, loginSchema, type RegisterInput, type LoginInput } from './auth.schema.js';
import type { AuthResponse, SafeUser, Tenant } from './auth.types.js';
import { comparePassword, generateToken, hashPassword } from './auth.utils.js';

const generateSlug = (name: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);
  const suffix = randomBytes(4).toString('hex');
  return `${base || 'tenant'}-${suffix}`;
};

export class AuthService {
  async register(rawInput: unknown): Promise<AuthResponse> {
    const parseResult = registerSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      throw new ValidationError('Validation failed', issues);
    }

    const { name, email, password }: RegisterInput = parseResult.data;

    // Check email uniqueness before starting transaction
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      throw new ConflictError('Email is already registered');
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const slug = generateSlug(name);
      const tenant = await tenantRepository.create(name, slug, client);
      const passwordHash = await hashPassword(password);
      const user = await userRepository.create(tenant.id, email, passwordHash, 'owner', client);

      await client.query('COMMIT');

      const token = generateToken({
        sub: user.id,
        tenantId: tenant.id,
        role: user.role,
      });

      return {
        user: toSafeUser(user),
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
        },
        token,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async login(rawInput: unknown): Promise<AuthResponse> {
    const parseResult = loginSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      throw new ValidationError('Validation failed', issues);
    }

    const { email, password }: LoginInput = parseResult.data;

    const user = await userRepository.findByEmail(email);
    if (!user) {
      // Safe generic message to avoid email enumeration
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const tenant = await tenantRepository.findById(user.tenantId);
    if (!tenant) {
      throw new NotFoundError('Associated tenant not found');
    }

    const token = generateToken({
      sub: user.id,
      tenantId: tenant.id,
      role: user.role,
    });

    return {
      user: toSafeUser(user),
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
      token,
    };
  }

  async getMe(userId: string, tenantId: string): Promise<{ user: SafeUser; tenant: Tenant }> {
    // Strictly scoped to tenantId: cross-tenant access impossible
    const user = await userRepository.findByIdAndTenant(userId, tenantId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    return {
      user: toSafeUser(user),
      tenant,
    };
  }
}

export const authService = new AuthService();
