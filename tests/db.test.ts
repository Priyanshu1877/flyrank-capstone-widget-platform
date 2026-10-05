import { describe, it, expect, afterAll } from 'vitest';
import { query, closePool } from '../src/shared/db.js';

describe('Database Connection', () => {
  afterAll(async () => {
    await closePool();
  });

  it('should successfully connect to PostgreSQL and execute a query', async () => {
    const res = await query<{ connected: number }>('SELECT 1 AS connected;');
    expect(res.rows[0].connected).toBe(1);
  });

  it('should have access to the public schema and tables', async () => {
    const res = await query<{ table_name: string }>(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('tenants', 'users', 'schema_migrations');
    `);
    const tableNames = res.rows.map((r) => r.table_name);
    expect(tableNames).toContain('tenants');
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('schema_migrations');
  });
});
