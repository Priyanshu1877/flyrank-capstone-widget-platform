import type { PoolClient } from 'pg';
import { query } from '../../shared/db.js';
import type { User, SafeUser } from '../auth/auth.types.js';

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: Date;
  updated_at: Date;
}

const mapRowToUser = (row: UserRow): User => ({
  id: row.id,
  tenantId: row.tenant_id,
  email: row.email,
  passwordHash: row.password_hash,
  role: row.role,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const toSafeUser = (user: User): SafeUser => ({
  id: user.id,
  tenantId: user.tenantId,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
});

export class UserRepository {
  async create(
    tenantId: string,
    email: string,
    passwordHash: string,
    role = 'owner',
    client?: PoolClient,
  ): Promise<User> {
    const text = `
      INSERT INTO users (tenant_id, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, tenant_id, email, password_hash, role, created_at, updated_at;
    `;
    const params = [tenantId, email, passwordHash, role];
    const res = client
      ? await client.query<UserRow>(text, params)
      : await query<UserRow>(text, params);

    return mapRowToUser(res.rows[0]);
  }

  async findByEmail(email: string, client?: PoolClient): Promise<User | null> {
    const text = `
      SELECT id, tenant_id, email, password_hash, role, created_at, updated_at
      FROM users
      WHERE email = $1;
    `;
    const params = [email.toLowerCase().trim()];
    const res = client
      ? await client.query<UserRow>(text, params)
      : await query<UserRow>(text, params);

    if (res.rows.length === 0) return null;
    return mapRowToUser(res.rows[0]);
  }

  /**
   * Enforces strict tenant isolation: user MUST belong to the specified tenantId
   */
  async findByIdAndTenant(id: string, tenantId: string, client?: PoolClient): Promise<User | null> {
    const text = `
      SELECT id, tenant_id, email, password_hash, role, created_at, updated_at
      FROM users
      WHERE id = $1 AND tenant_id = $2;
    `;
    const params = [id, tenantId];
    const res = client
      ? await client.query<UserRow>(text, params)
      : await query<UserRow>(text, params);

    if (res.rows.length === 0) return null;
    return mapRowToUser(res.rows[0]);
  }

  async findById(id: string, client?: PoolClient): Promise<User | null> {
    const text = `
      SELECT id, tenant_id, email, password_hash, role, created_at, updated_at
      FROM users
      WHERE id = $1;
    `;
    const params = [id];
    const res = client
      ? await client.query<UserRow>(text, params)
      : await query<UserRow>(text, params);

    if (res.rows.length === 0) return null;
    return mapRowToUser(res.rows[0]);
  }
}

export const userRepository = new UserRepository();
