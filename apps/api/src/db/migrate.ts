import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';

export async function migrate(pool: Pool) {
  const migration = await readFile(new URL('../../migrations/0001_business_foundation.sql', import.meta.url), 'utf8');
  const hash = createHash('sha256').update(migration).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(762901)');
    await client.query('CREATE TABLE IF NOT EXISTS lab_migrations (name text PRIMARY KEY, hash text NOT NULL)');
    const previous = await client.query<{ hash: string }>('SELECT hash FROM lab_migrations WHERE name = $1', ['0001']);
    if (previous.rowCount) {
      if (previous.rows[0]?.hash !== hash) throw new Error('Applied migration changed; add a new migration instead.');
    } else {
      await client.query(migration);
      await client.query('INSERT INTO lab_migrations(name, hash) VALUES ($1, $2)', ['0001', hash]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
